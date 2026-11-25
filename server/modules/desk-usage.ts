import type { DatabaseSync } from "node:sqlite";
import type { Express } from "express";

export function installDeskUsage(app: Express, db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS desk_model_usage (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      task_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      total_tokens INTEGER,
      cost_usd REAL,
      duration_ms INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_desk_usage_agent ON desk_model_usage(agent_id, created_at);
  `);
  app.get("/api/desk/agents/:agentId/usage", (req, res) => {
    const agentId = String(req.params.agentId);
    if (!db.prepare("SELECT 1 FROM agents WHERE id = ?").get(agentId)) {
      return res.status(404).json({ error: "agent_not_found" });
    }
    const totals = db
      .prepare(
        `
      SELECT COUNT(*) AS requests, COUNT(total_tokens) AS metered_requests,
        COUNT(cost_usd) AS priced_requests, SUM(input_tokens) AS input_tokens,
        SUM(output_tokens) AS output_tokens, SUM(total_tokens) AS total_tokens,
        SUM(cost_usd) AS cost_usd, SUM(duration_ms) AS duration_ms
      FROM desk_model_usage WHERE agent_id = ?
    `,
      )
      .get(agentId);
    const recent = db
      .prepare("SELECT * FROM desk_model_usage WHERE agent_id = ? ORDER BY created_at DESC LIMIT 20")
      .all(agentId);
    return res.json({ scope: "direct_openrouter", totals, recent });
  });
}
