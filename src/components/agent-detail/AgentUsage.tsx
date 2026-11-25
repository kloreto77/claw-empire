import { useEffect, useState } from "react";
import { request } from "../../api/core";

type Usage = {
  totals: {
    requests: number;
    metered_requests: number;
    priced_requests: number;
    input_tokens: number | null;
    output_tokens: number | null;
    total_tokens: number | null;
    cost_usd: number | null;
    duration_ms: number | null;
  };
};

const number = (value: number | null) => value === null ? "Indisponível" : value.toLocaleString("pt-BR");
export default function AgentUsage({ agentId }: { agentId: string }) {
  const [data, setData] = useState<Usage | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let loading = false;
    const refresh = async () => {
      if (loading) return;
      loading = true;
      try {
        const result = await request<Usage>("/api/desk/agents/" + encodeURIComponent(agentId) + "/usage");
        if (!cancelled) { setData(result); setError(false); }
      } catch { if (!cancelled) setError(true); }
      finally { loading = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [agentId]);
  const totals = data?.totals;
  return (
    <section aria-label="Consumo de recursos" className="space-y-2 rounded-lg border border-slate-600 p-3 text-xs">
      <h3 className="font-semibold text-slate-200">Consumo de recursos</h3>
      <p className="text-slate-400">OpenRouter direto · acumulado desde a implantação da coleta.</p>
      {error && <p role="alert" className="text-amber-300">Não foi possível atualizar o consumo.</p>}
      {!totals ? <p>Sem dados carregados.</p> : totals.requests === 0 ? <p>Nenhuma chamada registrada.</p> : (
        <>
          <dl className="grid grid-cols-2 gap-2">
            <div><dt>Chamadas registradas</dt><dd>{number(totals.requests)}</dd></div>
            <div><dt>Tokens de entrada</dt><dd>{number(totals.input_tokens)}</dd></div>
            <div><dt>Tokens de saída</dt><dd>{number(totals.output_tokens)}</dd></div>
            <div><dt>Total de tokens informados</dt><dd>{number(totals.total_tokens)}</dd></div>
            <div><dt>Custo informado (USD)</dt><dd>{totals.cost_usd === null ? "Indisponível" : totals.cost_usd.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 })}</dd></div>
            <div><dt>Duração acumulada das chamadas</dt><dd>{totals.duration_ms === null ? "Indisponível" : number(Math.round(totals.duration_ms / 1000)) + " s"}</dd></div>
          </dl>
          <p className="text-slate-400">Cobertura: tokens em {totals.metered_requests}/{totals.requests} chamadas; custo em {totals.priced_requests}/{totals.requests}. Dados ausentes não significam custo zero.</p>
        </>
      )}
      <p className="text-slate-400">Não inclui OpenCode, outros provedores nem uso externo à mesa. Ainda não há teto monetário aplicado.</p>
    </section>
  );
}
