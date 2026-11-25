import { randomUUID } from "node:crypto";
import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";

const kinds = new Set(["api", "mcp", "local"]);
const modes = new Set(["read", "write"]);

export function installDeskToolRegistry(app: Express, db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS desk_agent_tools (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('api','mcp','local')),
      reference TEXT NOT NULL,
      requested_access TEXT NOT NULL CHECK(requested_access IN ('read','write')),
      created_at INTEGER NOT NULL,
      UNIQUE(agent_id, name)
    );
  `);
  const exists = (agentId: string) => Boolean(db.prepare("SELECT 1 FROM agents WHERE id = ?").get(agentId));
  app.get("/api/desk/agents/:agentId/tools", (req, res) => {
    const agentId = String(req.params.agentId);
    if (!exists(agentId)) return res.status(404).json({ error: "agent_not_found" });
    return res.json({
      runtime_connected: false,
      tools: db.prepare("SELECT * FROM desk_agent_tools WHERE agent_id = ? ORDER BY name").all(agentId),
    });
  });
  app.post("/api/desk/agents/:agentId/tools", (req, res) => {
    const agentId = String(req.params.agentId);
    if (!exists(agentId)) return res.status(404).json({ error: "agent_not_found" });
    const body = req.body ?? {};
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const reference = typeof body.reference === "string" ? body.reference.trim() : "";
    if (
      !name ||
      name.length > 80 ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/.test(reference) ||
      !kinds.has(body.kind) ||
      !modes.has(body.requested_access)
    ) {
      return res.status(400).json({ error: "invalid_tool_metadata" });
    }
    if (db.prepare("SELECT 1 FROM desk_agent_tools WHERE agent_id = ? AND name = ?").get(agentId, name)) {
      return res.status(409).json({ error: "duplicate_tool_name" });
    }
    const id = randomUUID();
    db.prepare(
      "INSERT INTO desk_agent_tools (id,agent_id,name,kind,reference,requested_access,created_at) VALUES (?,?,?,?,?,?,?)",
    ).run(id, agentId, name, body.kind, reference, body.requested_access, Date.now());
    return res.status(201).json({ id, runtime_connected: false });
  });
  app.delete("/api/desk/agents/:agentId/tools/:toolId", (req, res) => {
    const result = db
      .prepare("DELETE FROM desk_agent_tools WHERE agent_id = ? AND id = ?")
      .run(String(req.params.agentId), String(req.params.toolId));
    if (!result.changes) return res.status(404).json({ error: "tool_not_found" });
    return res.json({ ok: true });
  });
}
