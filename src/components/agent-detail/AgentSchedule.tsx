import { useEffect, useState } from "react";
import type { Agent, Task } from "../../types";
import { request, put } from "../../api/core";

interface Schedule {
  template_task_id: string;
  enabled: number;
  interval_minutes: number;
  max_runs: number;
  runs: number;
  next_run_at: number;
  last_error: string | null;
}
type ScheduleWindow={days:number[];start:string;end:string;timezone:string};
interface ScheduleResponse {
  window?:ScheduleWindow;
  globally_enabled: boolean;
  schedule: Schedule | null;
}
export default function AgentSchedule({ agent, tasks }: { agent: Agent; tasks: Task[] }) {
  const [data, setData] = useState<ScheduleResponse | null>(null);
  const [template, setTemplate] = useState("");
  const [interval, setIntervalMinutes] = useState(60);
  const [maxRuns, setMaxRuns] = useState(1);
  const [windowConfig,setWindowConfig]=useState<ScheduleWindow>({days:[0,1,2,3,4,5,6],start:"00:00",end:"24:00",timezone:"America/Sao_Paulo"});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const url = "/api/desk/schedules/" + encodeURIComponent(agent.id);
  const templates = tasks.filter(
    (task) =>
      task.assigned_agent_id === agent.id &&
      (!task.workflow_pack_key || task.workflow_pack_key === "development") &&
      !task.project_id,
  );
  const configured = Boolean(
    (agent.cli_provider === "api" && agent.api_provider_id && agent.api_model) ||
    (agent.cli_provider === "opencode" && agent.cli_model),
  );
  useEffect(() => {
    let cancelled = false;
    setData(null);
    setMessage("");
    request<ScheduleResponse>(url)
      .then((result) => {
        if (cancelled) return;
        setData(result);
        if(result.window)setWindowConfig(result.window);
        setTemplate(result.schedule?.template_task_id ?? "");
        setIntervalMinutes(result.schedule?.interval_minutes ?? 60);
        setMaxRuns(result.schedule?.max_runs ?? 1);
      })
      .catch(() => {
        if (!cancelled) setMessage("Agenda indisponível.");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  async function save(enabled: boolean, stopOnly = false) {
    setBusy(true);
    setMessage("");
    try {
      await put(
        url,
        stopOnly
          ? { enabled: false }
          : { enabled, template_task_id: template, interval_minutes: interval, max_runs: maxRuns, window:windowConfig },
      );
      setData(await request<ScheduleResponse>(url));
      setMessage(
        enabled
          ? "Agenda ativada."
          : stopOnly
            ? "Novos disparos desativados. Tarefas existentes não foram interrompidas."
            : "Agenda salva, desativada.",
      );
    } catch {
      setMessage("Não foi possível salvar a agenda. Confira a tarefa e o modelo.");
    } finally {
      setBusy(false);
    }
  }
  const valid =
    windowConfig.days.length>0 && windowConfig.start<windowConfig.end &&
    templates.some((t) => t.id === template) &&
    Number.isInteger(interval) &&
    interval >= 5 &&
    interval <= 10080 &&
    Number.isInteger(maxRuns) &&
    maxRuns >= 1 &&
    maxRuns <= 100;
  return (
    <section aria-label="Autonomia" className="space-y-3 rounded-lg border border-slate-600 p-3 text-xs">
      <h3 className="font-semibold text-slate-200">Autonomia · execução programada</h3>
      <p className="text-slate-400">
        {data?.schedule?.enabled ? "Agenda ativa" : "Agenda desativada"} · {data?.schedule?.runs ?? 0} disparos
        registrados
      </p>
      {data?.globally_enabled === false && (
        <p className="text-amber-300">
          Motor global desativado. Ative em Configurações → Autonomia. Você pode preparar a agenda sem iniciar execuções.
        </p>
      )}
      {!configured && (
        <p className="text-amber-300">Defina explicitamente um modelo OpenRouter/API ou OpenCode para ativar.</p>
      )}
      <label className="block text-slate-300">
        Tarefa de referência
        <select
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          className="mt-1 w-full rounded bg-slate-700 p-2"
        >
          <option value="">Selecione uma tarefa atribuída</option>
          {templates.map((task) => (
            <option key={task.id} value={task.id}>
              {task.title}
            </option>
          ))}
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="text-slate-300">
          Intervalo (minutos)
          <input
            type="number"
            min={5}
            max={10080}
            value={interval}
            onChange={(e) => setIntervalMinutes(Number(e.target.value))}
            className="mt-1 w-full rounded bg-slate-700 p-2"
          />
        </label>
        <label className="text-slate-300">
          Limite de disparos
          <input
            type="number"
            min={1}
            max={100}
            value={maxRuns}
            onChange={(e) => setMaxRuns(Number(e.target.value))}
            className="mt-1 w-full rounded bg-slate-700 p-2"
          />
        </label>
      </div>
      <div><p>Dias permitidos</p><div className="mv3-row">{["Dom","Seg","Ter","Qua","Qui","Sex","Sáb"].map((d,i)=><button key={d} type="button" aria-pressed={windowConfig.days.includes(i)} onClick={()=>setWindowConfig(w=>({...w,days:w.days.includes(i)?w.days.filter(v=>v!==i):[...w.days,i]}))}>{d}</button>)}</div><label>Início da janela<input type="time" value={windowConfig.start} onChange={e=>setWindowConfig(w=>({...w,start:e.target.value}))}/></label><label>Fim da janela (24:00 = fim do dia)<input value={windowConfig.end} placeholder="24:00" pattern="([01][0-9]|2[0-3]):[0-5][0-9]|24:00" onChange={e=>setWindowConfig(w=>({...w,end:e.target.value}))}/></label><label>Fuso horário IANA<input value={windowConfig.timezone} onChange={e=>setWindowConfig(w=>({...w,timezone:e.target.value}))}/></label><p>Fora da janela não são disparadas novas tarefas. Não é um calendário de pregão real.</p></div>
      {data?.schedule?.enabled === 1 && (
        <p>Próxima tentativa: {new Date(data.schedule.next_run_at).toLocaleString("pt-BR")}</p>
      )}
      {data?.schedule?.last_error && (
        <p role="alert" className="text-amber-300">
          {data.schedule.last_error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !data || !valid}
          onClick={() => void save(false)}
          className="rounded bg-slate-600 px-3 py-2 disabled:opacity-40"
        >
          Salvar desativada
        </button>
        <button
          type="button"
          disabled={busy || !valid || !configured || !data?.globally_enabled}
          onClick={() => {
            if (window.confirm("Ativar novas execuções programadas? Podem consumir créditos do provedor."))
              void save(true);
          }}
          className="rounded bg-emerald-700 px-3 py-2 disabled:opacity-40"
        >
          Ativar agenda
        </button>
        {data?.schedule?.enabled === 1 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void save(false, true)}
            className="rounded bg-red-800 px-3 py-2"
          >
            Desativar agenda
          </button>
        )}
      </div>
      <p className="text-slate-400">
        Cada disparo gera uma nova tarefa. Desativar a agenda impede novos disparos; para parar uma tarefa em andamento,
        use os controles de execução.
      </p>
    </section>
  );
}
