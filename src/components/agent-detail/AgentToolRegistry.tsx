import { useEffect, useState } from "react";
import { request, post, del } from "../../api/core";

type Tool = {
  id: string;
  name: string;
  kind: "api" | "mcp" | "local";
  reference: string;
  requested_access: "read" | "write";
};
type Catalog = { runtime_connected: boolean; tools: Tool[] };

export default function AgentToolRegistry({ agentId }: { agentId: string }) {
  const url = "/api/desk/agents/" + encodeURIComponent(agentId) + "/tools";
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [name, setName] = useState("");
  const [reference, setReference] = useState("");
  const [kind, setKind] = useState<Tool["kind"]>("api");
  const [access, setAccess] = useState<Tool["requested_access"]>("read");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    request<Catalog>(url)
      .then((value) => {
        if (!cancelled) setCatalog(value);
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível carregar o catálogo.");
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  const refresh = async () => setCatalog(await request<Catalog>(url));
  const add = async () => {
    setBusy(true);
    setError("");
    try {
      await post(url, { name: name.trim(), reference: reference.trim(), kind, requested_access: access });
      await refresh();
      setName("");
      setReference("");
    } catch {
      setError("Não foi possível cadastrar. Confira os dados e se o nome já existe.");
    } finally {
      setBusy(false);
    }
  };
  const remove = async (id: string) => {
    if (!window.confirm("Remover esta referência do catálogo do agente?")) return;
    setBusy(true);
    setError("");
    try {
      await del(url + "/" + encodeURIComponent(id));
      await refresh();
    } catch {
      setError("Não foi possível remover a referência.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Ferramentas individuais" className="space-y-3 rounded-lg border border-slate-600 p-3 text-xs">
      <h3 className="font-semibold text-slate-200">Ferramentas individuais</h3>
      <p className="text-amber-300">
        Catálogo de preparação. Nenhuma ferramenta cadastrada aqui está conectada ou autorizada a executar.
      </p>
      {catalog && catalog.tools.length === 0 && <p className="text-slate-400">Nenhuma ferramenta cadastrada.</p>}
      {catalog?.tools.map((tool) => (
        <div key={tool.id} className="flex items-start justify-between gap-2 rounded border border-slate-600 p-2">
          <div className="min-w-0">
            <p className="break-words font-medium">
              {tool.name} · {tool.kind.toUpperCase()}
            </p>
            <p className="break-words text-slate-400">
              {tool.reference} · acesso solicitado: {tool.requested_access === "read" ? "leitura" : "escrita"}
            </p>
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={() => void remove(tool.id)}
            className="rounded bg-slate-700 px-2 py-1"
          >
            Remover
          </button>
        </div>
      ))}
      <label className="block">
        Nome
        <input
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded bg-slate-700 p-2"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label>
          Tipo
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as Tool["kind"])}
            className="mt-1 w-full rounded bg-slate-700 p-2"
          >
            <option value="api">API</option>
            <option value="mcp">MCP</option>
            <option value="local">Local</option>
          </select>
        </label>
        <label>
          Acesso solicitado
          <select
            value={access}
            onChange={(e) => setAccess(e.target.value as Tool["requested_access"])}
            className="mt-1 w-full rounded bg-slate-700 p-2"
          >
            <option value="read">Leitura</option>
            <option value="write">Escrita</option>
          </select>
        </label>
      </div>
      <label className="block">
        Identificador da ferramenta
        <input
          value={reference}
          maxLength={80}
          placeholder="ex.: market-data"
          onChange={(e) => setReference(e.target.value)}
          className="mt-1 w-full rounded bg-slate-700 p-2"
        />
      </label>
      <p className="text-slate-400">Use somente um identificador, nunca tokens, senhas, comandos ou URLs.</p>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy || !catalog || !name.trim() || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,79}$/.test(reference.trim())}
        onClick={() => void add()}
        className="rounded bg-slate-600 px-3 py-2 disabled:opacity-40"
      >
        Cadastrar referência
      </button>
    </section>
  );
}
