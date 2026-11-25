import { DatabaseSync } from "node:sqlite";
import "./server/index.ts";

let stopping = false;
function idleForUpdate() {
  let db;
  try {
    db = new DatabaseSync(process.env.DB_PATH, { readOnly: true });
    const active = db
      .prepare("SELECT 1 FROM tasks WHERE status IN ('in_progress','collaborating','review') LIMIT 1")
      .get();
    const working = db.prepare("SELECT 1 FROM agents WHERE status = 'working' LIMIT 1").get();
    const dispatch = db.prepare("SELECT 1 FROM desk_agent_schedules WHERE in_flight = 1 LIMIT 1").get();
    return !active && !working && !dispatch;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}
function stop() {
  if (stopping) return;
  stopping = true;
  const idle = idleForUpdate();
  if (process.connected) process.send({ type: "mesa-shutdown-status", idle });
  process.emit("SIGTERM");
}
process.on("message", (message) => {
  if (message?.type === "mesa-shutdown") stop();
});
process.on("disconnect", stop);
