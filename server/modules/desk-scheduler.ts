import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";
import { PORT, SESSION_AUTH_TOKEN } from "../config/runtime.ts";

type Schedule = {
  agent_id: string;
  template_task_id: string;
  enabled: number;
  interval_minutes: number;
  max_runs: number;
  runs: number;
  next_run_at: number;
  last_task_id: string | null;
  last_error: string | null;
  in_flight: number;
};

export function installAgentScheduler(app: Express, db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS desk_agent_schedules (
      agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE,
      template_task_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      interval_minutes INTEGER NOT NULL CHECK(interval_minutes BETWEEN 5 AND 10080),
      max_runs INTEGER NOT NULL CHECK(max_runs BETWEEN 1 AND 100),
      runs INTEGER NOT NULL DEFAULT 0,
      next_run_at INTEGER NOT NULL,
      last_task_id TEXT,
      last_error TEXT,
      in_flight INTEGER NOT NULL DEFAULT 0
    );
    UPDATE desk_agent_schedules
      SET enabled = 0, in_flight = 0, last_error = 'Interrupted dispatch; inspect task history before enabling again'
      WHERE in_flight = 1;
  `);
  const globallyEnabled = process.env.MESA_SCHEDULER_ENABLED === "true";
  const agent = (id: string) => db.prepare("SELECT * FROM agents WHERE id = ?").get(id);
  const configured = (a: ReturnType<typeof agent>) =>
    Boolean(
      a &&
      ((a.cli_provider === "api" && a.api_provider_id && a.api_model) ||
        (a.cli_provider === "opencode" && a.cli_model)),
    );
  const template = (id: string, agentId: string) =>
    db
      .prepare(
        "SELECT * FROM tasks WHERE id = ? AND assigned_agent_id = ? AND workflow_pack_key = 'development' AND project_id IS NULL",
      )
      .get(id, agentId);
  app.get("/api/desk/schedules/:agentId", (req, res) => {
    const id = String(req.params.agentId);
    if (!agent(id)) return res.status(404).json({ error: "agent_not_found" });
    return res.json({
      globally_enabled: globallyEnabled,
      schedule: db.prepare("SELECT * FROM desk_agent_schedules WHERE agent_id = ?").get(id) ?? null,
    });
  });
  app.put("/api/desk/schedules/:agentId", (req, res) => {
    const id = String(req.params.agentId);
    const a = agent(id);
    if (!a) return res.status(404).json({ error: "agent_not_found" });
    const body = req.body ?? {};
    const current = db.prepare("SELECT * FROM desk_agent_schedules WHERE agent_id = ?").get(id) as Schedule | undefined;
    if (body.enabled === false && current && body.template_task_id === undefined) {
      db.prepare("UPDATE desk_agent_schedules SET enabled = 0 WHERE agent_id = ?").run(id);
      return res.json({ ok: true });
    }
    if (current?.in_flight) return res.status(409).json({ error: "dispatch_in_progress" });
    const { enabled, interval_minutes, max_runs, template_task_id } = body;
    if (
      typeof enabled !== "boolean" ||
      !Number.isInteger(interval_minutes) ||
      interval_minutes < 5 ||
      interval_minutes > 10080 ||
      !Number.isInteger(max_runs) ||
      max_runs < 1 ||
      max_runs > 100 ||
      typeof template_task_id !== "string" ||
      !template(template_task_id, id)
    ) {
      return res.status(400).json({ error: "invalid_schedule_or_template" });
    }
    if (enabled && (!globallyEnabled || !configured(a)))
      return res.status(409).json({ error: "scheduler_disabled_or_agent_not_configured" });
    db.prepare(
      `
      INSERT INTO desk_agent_schedules (agent_id, template_task_id, enabled, interval_minutes, max_runs, next_run_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(agent_id) DO UPDATE SET template_task_id=excluded.template_task_id, enabled=excluded.enabled,
        interval_minutes=excluded.interval_minutes, max_runs=excluded.max_runs, runs=0,
        next_run_at=excluded.next_run_at, last_task_id=NULL, last_error=NULL
    `,
    ).run(id, template_task_id, Number(enabled), interval_minutes, max_runs, Date.now() + interval_minutes * 60000);
    return res.json({ ok: true });
  });
  if (!globallyEnabled) return;

  const post = async (route: string, body: object) => {
    const response = await fetch("http://127.0.0.1:" + PORT + route, {
      method: "POST",
      headers: { authorization: "Bearer " + SESSION_AUTH_TOKEN, "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error("Dispatch rejected: HTTP " + response.status);
    const payload: unknown = await response.json();
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      throw new Error("Invalid dispatch response");
    }
    const result = payload as Record<string, unknown>;
    if (result.ok === false || result.error) throw new Error("Dispatch rejected by API");
    return result;
  };
  let ticking = false;
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const now = Date.now();
      const due = db
        .prepare(
          "SELECT * FROM desk_agent_schedules WHERE enabled = 1 AND in_flight = 0 AND next_run_at <= ? AND runs < max_runs",
        )
        .all(now) as unknown as Schedule[];
      await Promise.all(
        due.map(async (s) => {
          const a = agent(s.agent_id);
          const t = template(s.template_task_id, s.agent_id);
          if (!configured(a) || !t) {
            db.prepare("UPDATE desk_agent_schedules SET enabled=0,last_error=? WHERE agent_id=?").run(
              "Missing configuration or template",
              s.agent_id,
            );
            return;
          }
          if (
            a?.status !== "idle" ||
            db
              .prepare(
                "SELECT 1 FROM tasks WHERE assigned_agent_id = ? AND status IN ('in_progress','collaborating') LIMIT 1",
              )
              .get(s.agent_id)
          )
            return;
          const claim = db
            .prepare(
              "UPDATE desk_agent_schedules SET in_flight=1,runs=runs+1,next_run_at=? WHERE agent_id=? AND enabled=1 AND in_flight=0 AND runs<max_runs AND next_run_at<=?",
            )
            .run(now + s.interval_minutes * 60000, s.agent_id, now);
          if (!claim.changes) return;
          try {
            const created = await post("/api/tasks", {
              title: t.title,
              description: t.description,
              department_id: a?.department_id,
              assigned_agent_id: s.agent_id,
              task_type: t.task_type,
              workflow_pack_key: "development",
              project_path: t.project_path,
            });
            if (typeof created.id !== "string") throw new Error("No task ID returned");
            db.prepare("UPDATE desk_agent_schedules SET last_task_id=? WHERE agent_id=?").run(created.id, s.agent_id);
            const stillEnabled = db
              .prepare("SELECT enabled FROM desk_agent_schedules WHERE agent_id=?")
              .get(s.agent_id)?.enabled;
            if (stillEnabled !== 1) throw new Error("Schedule disabled before execution");
            await post("/api/tasks/" + encodeURIComponent(created.id) + "/run", {});
            db.prepare("UPDATE desk_agent_schedules SET last_error=NULL WHERE agent_id=?").run(s.agent_id);
          } catch (error) {
            db.prepare("UPDATE desk_agent_schedules SET enabled=0,last_error=? WHERE agent_id=?").run(
              error instanceof Error ? error.message : "Dispatch failed",
              s.agent_id,
            );
          } finally {
            db.prepare(
              "UPDATE desk_agent_schedules SET in_flight=0, enabled=CASE WHEN runs>=max_runs THEN 0 ELSE enabled END WHERE agent_id=?",
            ).run(s.agent_id);
          }
        }),
      );
    } catch (error) {
      console.error("[Mesa scheduler] tick failed", error);
    } finally {
      ticking = false;
    }
  };
  setInterval(() => void tick(), 10000).unref();
}
