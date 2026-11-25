import type { DatabaseSync } from "node:sqlite";

export function recoverLocalDeskTasks(db: DatabaseSync, now: number, reason: "startup" | "shutdown"): number {
  db.exec("BEGIN IMMEDIATE");
  try {
    const active = "('in_progress','collaborating','review')";
    const schedulesExist = db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'desk_agent_schedules'")
      .get();
    if (schedulesExist) {
      db.prepare(
        `UPDATE desk_agent_schedules SET enabled = 0, last_error = ?
         WHERE in_flight = 1 OR agent_id IN
           (SELECT assigned_agent_id FROM tasks WHERE status IN ${active})`,
      ).run("Interrupted operation: review task history before enabling again");
      if (reason === "startup") {
        db.prepare(
          "UPDATE desk_agent_schedules SET next_run_at = ? + interval_minutes * 60000 WHERE enabled = 1 AND next_run_at <= ?",
        ).run(now, now);
      }
    }

    db.prepare(
      `INSERT INTO task_logs (task_id, kind, message, created_at)
       SELECT id, 'system', ?, ? FROM tasks WHERE status IN ${active}`,
    ).run("Local recovery (" + reason + "): interrupted; review external effects before running again.", now);

    db.prepare(
      `UPDATE agents SET status = CASE WHEN status = 'working' THEN 'idle' ELSE status END, current_task_id = NULL
       WHERE current_task_id IN (SELECT id FROM tasks WHERE status IN ${active})`,
    ).run();
    const moved = db.prepare(`UPDATE tasks SET status = 'pending', updated_at = ? WHERE status IN ${active}`).run(now);
    db.exec("COMMIT");
    return Number(moved.changes);
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
