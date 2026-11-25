import { useMemo, useState } from "react";
import type { Agent, Task } from "../types";
import AgentAvatar from "./AgentAvatar";

interface OperationsMonitorProps {
  agents: Agent[];
  tasks: Task[];
  connected: boolean;
  onSelectAgent: (agent: Agent) => void;
  onOpenTerminal: (taskId: string) => void;
  onOpenTasks: () => void;
}

const statusLabels: Record<Agent["status"], string> = {
  idle: "Disponível",
  working: "Em execução",
  break: "Em intervalo",
  offline: "Offline",
};
const statusColors: Record<Agent["status"], string> = {
  idle: "#7da8c9",
  working: "#38b995",
  break: "#d4aa67",
  offline: "#8996a3",
};

function isConfigured(agent: Agent): boolean {
  return Boolean(agent.cli_provider && (agent.cli_provider !== "api" || (agent.api_provider_id && agent.api_model)));
}

export default function OperationsMonitor({
  agents,
  tasks,
  connected,
  onSelectAgent,
  onOpenTerminal,
  onOpenTasks,
}: OperationsMonitorProps) {
  const [filter, setFilter] = useState<"all" | "working" | "unconfigured">("all");
  const ordered = useMemo(
    () => [...agents].sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { numeric: true })),
    [agents],
  );
  const tasksByAgent = useMemo(() => {
    const map = new Map<string, Task[]>();
    for (const task of tasks) {
      if (!task.assigned_agent_id) continue;
      const rows = map.get(task.assigned_agent_id) ?? [];
      rows.push(task);
      map.set(task.assigned_agent_id, rows);
    }
    return map;
  }, [tasks]);
  const visible = ordered.filter(
    (agent) => filter === "all" || (filter === "working" ? agent.status === "working" : !isConfigured(agent)),
  );
  const active = agents.filter((agent) => agent.status === "working").length;
  const configured = agents.filter(isConfigured).length;
  const metrics = [
    ["Agentes", agents.length],
    ["Em execução", active],
    ["Sem configuração", agents.length - configured],
    ["Tarefas em execução", tasks.filter((task) => task.status === "in_progress").length],
    ["Tarefas pendentes", tasks.filter((task) => task.status === "pending").length],
    ["Tarefas concluídas", tasks.filter((task) => task.status === "done").length],
  ] as const;
  return (
    <section aria-label="Monitoramento dos agentes" className="space-y-4" style={{ color: "var(--th-text-primary)" }}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold" style={{ color: "var(--th-text-heading)" }}>
            Central de monitoramento
          </h2>
          <p className="mt-1 text-xs" style={{ color: "var(--th-text-muted)" }} role="status">
            {connected
              ? "Servidor conectado · monitoramento ativo"
              : "Servidor desconectado · dados podem estar desatualizados"}
          </p>
        </div>
        <button type="button" className="header-action-btn header-action-btn-secondary" onClick={onOpenTasks}>
          Ver operações
        </button>
      </header>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {metrics.map(([label, value]) => (
          <div
            key={label}
            className="rounded-lg border p-3"
            style={{ borderColor: "var(--th-border)", background: "var(--th-bg-surface)" }}
          >
            <dt className="text-xs" style={{ color: "var(--th-text-muted)" }}>
              {label}
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">Estações individuais</h3>
        <div className="flex flex-wrap gap-1" aria-label="Filtro de agentes">
          {(
            [
              ["all", "Todos"],
              ["working", "Em execução"],
              ["unconfigured", "Sem configuração"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
              className="rounded-md border px-3 py-1.5 text-xs"
              style={{
                borderColor: "var(--th-border)",
                background: filter === key ? "var(--th-bg-surface)" : "transparent",
                fontWeight: filter === key ? 600 : 400,
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {visible.length === 0 && (
        <p className="text-sm" style={{ color: "var(--th-text-muted)" }}>
          Nenhum agente neste filtro.
        </p>
      )}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {visible.map((agent) => {
          const assigned = tasksByAgent.get(agent.id) ?? [];
          const current =
            assigned.find((task) => task.id === agent.current_task_id) ??
            assigned.find((task) => task.status === "in_progress");
          const provider =
            agent.cli_provider === "api" ? "API" : agent.cli_provider === "opencode" ? "OpenCode" : agent.cli_provider;
          const model = agent.cli_provider === "api" ? agent.api_model : agent.cli_model;
          return (
            <article
              key={agent.id}
              className="min-w-0 rounded-lg border p-3"
              style={{ borderColor: "var(--th-border)", background: "var(--th-bg-surface)" }}
            >
              <div className="flex items-center gap-2">
                <AgentAvatar agent={agent} size={36} rounded="xl" />
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-sm font-semibold">{agent.name}</h4>
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="h-2 w-2 rounded-full" style={{ background: statusColors[agent.status] }} />
                    {statusLabels[agent.status] ?? agent.status}
                  </div>
                </div>
              </div>
              <dl className="mt-3 space-y-2 text-xs">
                <div>
                  <dt style={{ color: "var(--th-text-muted)" }}>Modelo</dt>
                  <dd className="break-words">
                    {isConfigured(agent)
                      ? [provider, model || "Modelo padrão"].filter(Boolean).join(" · ")
                      : "Não configurado"}
                  </dd>
                </div>
                <div>
                  <dt style={{ color: "var(--th-text-muted)" }}>Tarefa atual</dt>
                  <dd className="break-words">{current?.title ?? "Nenhuma tarefa em execução"}</dd>
                </div>
                <div>
                  <dt style={{ color: "var(--th-text-muted)" }}>Concluídas / registradas</dt>
                  <dd className="tabular-nums">
                    {assigned.filter((task) => task.status === "done").length} / {assigned.length}
                  </dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => onSelectAgent(agent)}
                  className="header-action-btn header-action-btn-secondary"
                >
                  Abrir agente
                </button>
                {current?.status === "in_progress" && (
                  <button
                    type="button"
                    onClick={() => onOpenTerminal(current.id)}
                    className="header-action-btn header-action-btn-secondary"
                  >
                    Terminal
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <p className="text-xs" style={{ color: "var(--th-text-muted)" }}>
        Indicadores de execução, não resultados financeiros. Nenhum dado de mercado é simulado.
      </p>
    </section>
  );
}
