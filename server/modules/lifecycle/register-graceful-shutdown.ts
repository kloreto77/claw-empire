import type { ChildProcess } from "node:child_process";
import type { DatabaseSync } from "node:sqlite";
import type { WebSocket as WsSocket, WebSocketServer } from "ws";
import { recoverLocalDeskTasks } from "./local-desk-recovery.ts";

interface RegisterGracefulShutdownHandlersOptions {
  activeProcesses: Map<string, ChildProcess>;
  stopRequestedTasks: Set<string>;
  killPidTree: (pid: number) => void;
  rollbackTaskWorktree: (taskId: string, reason: string) => void;
  db: DatabaseSync;
  nowMs: () => number;
  endTaskExecutionSession: (taskId: string, reason: string) => void;
  wsClients: Set<WsSocket>;
  wss: WebSocketServer;
  server: { close: (callback: () => void) => void; closeAllConnections?: () => void };
  onBeforeClose?: () => void;
}

export function registerGracefulShutdownHandlers({
  activeProcesses,
  stopRequestedTasks,
  killPidTree,
  rollbackTaskWorktree,
  db,
  nowMs,
  endTaskExecutionSession,
  wsClients,
  wss,
  server,
  onBeforeClose,
}: RegisterGracefulShutdownHandlersOptions): void {
  let stopping = false;
  function gracefulShutdown(signal: string): void {
    if (stopping) return;
    stopping = true;
    const local = process.env.MESA_LOCAL_MODE === "true";
    console.log(`\n[Claw-Empire] ${signal} received. Shutting down gracefully...`);

    try {
      onBeforeClose?.();
    } catch {
      // ignore pre-close cleanup failures
    }

    if (local) {
      recoverLocalDeskTasks(db, nowMs(), "shutdown");
    }

    for (const [taskId, child] of activeProcesses) {
      console.log(`[Claw-Empire] Stopping process for task ${taskId} (pid: ${child.pid})`);
      stopRequestedTasks.add(taskId);
      if (child.pid) {
        killPidTree(child.pid);
      }
      activeProcesses.delete(taskId);

      rollbackTaskWorktree(taskId, "server_shutdown");

      const task = db.prepare("SELECT assigned_agent_id FROM tasks WHERE id = ?").get(taskId) as
        | {
            assigned_agent_id: string | null;
          }
        | undefined;
      if (task?.assigned_agent_id) {
        db.prepare("UPDATE agents SET status = 'idle', current_task_id = NULL WHERE id = ?").run(
          task.assigned_agent_id,
        );
      }
      db.prepare("UPDATE tasks SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'in_progress'").run(
        nowMs(),
        taskId,
      );
      endTaskExecutionSession(taskId, "server_shutdown");
    }

    for (const ws of wsClients) {
      ws.close(1001, "Server shutting down");
    }
    wsClients.clear();

    // In desktop mode no other users share the loopback server. Release
    // WebSocket and HTTP connections explicitly instead of waiting for keep-alive.
    if (local) {
      for (const ws of wss.clients) ws.terminate();
    }
    wss.close(() => {
      server.close(() => {
        try {
          db.close();
        } catch (error) {
          if (local) {
            console.error("[Claw-Empire] Database close failed:", error);
            process.exit(1);
          }
        }
        console.log("[Claw-Empire] Shutdown complete.");
        process.exit(0);
      });
      if (local) server.closeAllConnections?.();
    });

    setTimeout(() => {
      console.error("[Claw-Empire] Forced exit after timeout.");
      process.exit(1);
    }, 5000).unref();
  }

  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

  process.once("SIGUSR2", () => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
    process.kill(process.pid, "SIGUSR2");
  });
}
