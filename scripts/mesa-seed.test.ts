import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { applyBaseSchema } from "../server/modules/bootstrap/schema/base-schema.ts";
import { applyDefaultSeeds } from "../server/modules/bootstrap/schema/seeds.ts";
import { recoverLocalDeskTasks } from "../server/modules/lifecycle/local-desk-recovery.ts";

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

test("local recovery preserves interrupted tasks and suspends only affected schedules", () => {
  const db = database();
  try {
    applyDefaultSeeds(db);
    const agents = db.prepare("SELECT id FROM agents ORDER BY name").all();
    const insert = db.prepare("INSERT INTO tasks (id, title, status, assigned_agent_id) VALUES (?, ?, ?, ?)");
    insert.run("interrupted", "Analysis", "in_progress", agents[0].id);
    insert.run("collaboration", "Collaboration", "collaborating", agents[1].id);
    insert.run("review", "Review", "review", agents[2].id);
    insert.run("done", "Completed", "done", agents[3].id);
    db.prepare("UPDATE agents SET status = 'working', current_task_id = ? WHERE id = ?").run(
      "interrupted",
      agents[0].id,
    );
    db.exec(`CREATE TABLE desk_agent_schedules (
      agent_id TEXT PRIMARY KEY, enabled INTEGER, in_flight INTEGER,
      interval_minutes INTEGER, next_run_at INTEGER, last_error TEXT
    )`);
    const schedule = db.prepare("INSERT INTO desk_agent_schedules VALUES (?, 1, ?, 5, 100, NULL)");
    schedule.run(agents[0].id, 0);
    schedule.run(agents[3].id, 0);
    schedule.run(agents[4].id, 1);

    assert.equal(recoverLocalDeskTasks(db, 1000, "startup"), 3);
    for (const id of ["interrupted", "collaboration", "review"]) {
      assert.equal(db.prepare("SELECT status FROM tasks WHERE id = ?").get(id)?.status, "pending");
    }
    assert.equal(db.prepare("SELECT status FROM tasks WHERE id = 'done'").get()?.status, "done");
    assert.equal(db.prepare("SELECT status FROM agents WHERE id = ?").get(agents[0].id)?.status, "idle");
    assert.equal(
      db.prepare("SELECT enabled FROM desk_agent_schedules WHERE agent_id = ?").get(agents[0].id)?.enabled,
      0,
    );
    assert.equal(
      db.prepare("SELECT enabled FROM desk_agent_schedules WHERE agent_id = ?").get(agents[4].id)?.enabled,
      0,
    );
    assert.equal(
      db.prepare("SELECT next_run_at FROM desk_agent_schedules WHERE agent_id = ?").get(agents[3].id)?.next_run_at,
      301000,
    );
    assert.equal(recoverLocalDeskTasks(db, 1001, "startup"), 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM task_logs").get()?.n, 3);
    insert.run("shutdown", "Shutdown", "in_progress", agents[5].id);
    assert.equal(recoverLocalDeskTasks(db, 1002, "shutdown"), 1);
    assert.equal(db.prepare("SELECT status FROM tasks WHERE id = 'shutdown'").get()?.status, "pending");
  } finally {
    db.close();
  }
});

test("local recovery works before the schedule table exists", () => {
  const db = database();
  try {
    applyDefaultSeeds(db);
    db.exec("INSERT INTO tasks (id, title, status) VALUES ('first', 'First', 'in_progress')");
    assert.equal(recoverLocalDeskTasks(db, 1000, "startup"), 1);
    assert.equal(db.prepare("SELECT status FROM tasks WHERE id = 'first'").get()?.status, "pending");
  } finally {
    db.close();
  }
});
