import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { constants, setPriority } from "node:os";
import { fileURLToPath } from "node:url";

type Job = { id: string; state: string };
type Experiment = { status?: string; jobs?: Job[] };
type Result = {
  as_of_ms: number;
  source_files: number;
  minute_days: number;
  symbols: string[];
  invalid_records: number;
  records: Record<string, number>;
  evidence_id: string;
  paper_authorized: false;
  supervisor_configured?: boolean;
  jobs?: Job[];
  retention?: Record<string, unknown>;
  experiment?: Experiment;
};

export function createAxiomWorker(dataDir: string, stateDir: string, onComplete = () => {}) {
  const executable = fileURLToPath(new URL("../../axiom-worker/axiom-worker.exe", import.meta.url));
  const children = new Map<"maintenance" | "experiment", ChildProcess>();
  let last: Result | null = null;
  let experiment: Experiment | undefined;
  let error = "", experimentError = "", started = 0, finished = 0, lastExperiment = 0;
  let closing = false;

  function status() {
    return {
      available: existsSync(executable), running: children.has("maintenance"),
      experimenting: children.has("experiment"), experimentError,
      last: last && { ...last, experiment: { ...experiment, ...last.experiment } },
      error, started, finished,
    };
  }

  function run(command: "scan" | "tick" | "experiment") {
    const scientific = command === "experiment";
    const slot = scientific ? "experiment" : "maintenance";
    if (closing || children.has(slot)) return status();
    if (!existsSync(executable)) {
      error = "Worker Python empacotado indisponível.";
      return status();
    }
    mkdirSync(stateDir, { recursive: true });
    if (scientific) {
      experimentError = "";
      lastExperiment = Date.now();
    } else {
      error = "";
      started = Date.now();
    }

    const env: NodeJS.ProcessEnv = {};
    for (const key of ["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "PROGRAMDATA", "COMSPEC", "TZ"]) {
      if (process.env[key]) env[key] = process.env[key];
    }
    if (command === "tick" && process.env.OPENROUTER_API_KEY) env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    env.PYTHONUTF8 = "1";
    env.OMP_NUM_THREADS = env.OPENBLAS_NUM_THREADS = scientific ? "1" : "2";

    const child = spawn(executable, ["--data", dataDir, "--state", stateDir, command], {
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env,
    });
    children.set(slot, child);
    if (scientific && child.pid) {
      try { setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* best effort */ }
    }
    let buffer = "", failure = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      if (buffer.length + chunk.length > 1024 * 1024) {
        failure = "Resposta do worker excedeu limite.";
        child.kill();
      } else buffer += chunk;
    });
    child.stderr?.resume();
    child.on("error", () => { failure = "Não foi possível iniciar o worker."; });
    const deadline = setTimeout(() => {
      failure = "Tempo limite do worker excedido.";
      child.kill();
    }, scientific ? 60 * 60_000 : command === "tick" ? 15 * 60_000 : 180_000);
    deadline.unref();

    child.on("close", code => {
      clearTimeout(deadline);
      children.delete(slot);
      if (!scientific) {
        finished = Date.now();
        try { onComplete(); } catch { error = "Não foi possível atualizar o uso de disco."; }
      }
      if (closing) return;
      try {
        if (failure || code !== 0) throw new Error(failure || `Worker retornou código ${code}.`);
        const result = JSON.parse(buffer) as Result;
        if (result.paper_authorized !== false || !Number.isFinite(result.as_of_ms) ||
            !Array.isArray(result.symbols) || typeof result.evidence_id !== "string" ||
            !Number.isInteger(result.minute_days)) throw new Error("Resposta inválida do worker.");
        if (scientific) {
          experiment = result.experiment;
          if (last) last.experiment = result.experiment;
        } else {
          last = { ...last, ...result };
          if (command === "tick" && result.minute_days >= 44 && Date.now() - lastExperiment >= 60 * 60_000) {
            run("experiment");
          }
        }
      } catch (cause) {
        const message = cause instanceof SyntaxError ? "Resposta inválida do worker." : String((cause as Error).message);
        if (scientific) experimentError = message;
        else error = message;
      }
    });
    return status();
  }

  function stop() {
    closing = true;
    for (const child of children.values()) child.kill();
  }
  return { status, scan: () => run("scan"), tick: () => run("tick"), stop };
}
