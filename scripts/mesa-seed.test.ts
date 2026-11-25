import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { applyBaseSchema } from "../server/modules/bootstrap/schema/base-schema.ts";
import { applyDefaultSeeds } from "../server/modules/bootstrap/schema/seeds.ts";

function database() {
  const db = new DatabaseSync(":memory:");
  applyBaseSchema(db);
  return db;
}

test("fresh desk has eight distinct unconfigured agents and no tasks", () => {
  const db = database();
  try {
    applyDefaultSeeds(db);
    const agents = db.prepare("SELECT * FROM agents ORDER BY name").all();
    assert.equal(agents.length, 8);
    for (let i = 0; i < agents.length; i++) {
      const agent = agents[i];
      assert.equal(agent.name, "Agente " + String(i + 1).padStart(2, "0"));
      assert.equal(agent.sprite_number, i + 1);
      assert.equal(agent.department_id, "operations");
      for (const field of [
        "cli_provider",
        "api_provider_id",
        "api_model",
        "cli_model",
        "personality",
        "current_task_id",
      ]) {
        assert.equal(agent[field], null, field);
      }
      assert.equal(agent.status, "idle");
    }
    assert.equal(new Set(agents.map((a) => a.id)).size, 8);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM tasks").get()?.n, 0);
    assert.equal(db.prepare("SELECT value FROM settings WHERE key = 'autoAssign'").get()?.value, "false");
  } finally {
    db.close();
  }
});

test("reinitialization preserves edits and deletions, even an empty roster", () => {
  const db = database();
  try {
    applyDefaultSeeds(db);
    db.prepare("UPDATE agents SET name = ?, personality = ? WHERE name = ?").run(
      "Custom",
      "Custom instructions",
      "Agente 01",
    );
    db.prepare("DELETE FROM agents WHERE name = ?").run("Agente 02");
    applyDefaultSeeds(db);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agents").get()?.n, 7);
    assert.equal(
      db.prepare("SELECT personality FROM agents WHERE name = 'Custom'").get()?.personality,
      "Custom instructions",
    );
    db.exec("DELETE FROM agents");
    applyDefaultSeeds(db);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM agents").get()?.n, 0);
  } finally {
    db.close();
  }
});
