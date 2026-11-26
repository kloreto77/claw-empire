
import { useEffect, useState } from "react";
import { request, post, put } from "../../api/core";

export type Holding={symbol:string;quantity:number;basis:number};
export type Account={agent_id:string;name:string;role:string;cash:number;equity:number;enabled:boolean;positions:Holding[];return_pct:number;drawdown_pct:number;trades:number;win_pct:number|null;realized:number};
type Candle={time:number;open:number;high:number;low:number;close:number};
export type Asset={symbol:string;last:number;bid:number;ask:number;liquidity:number;change_pct:number;candles:Candle[]};
export type Market={updated_at:number;initial_cents:number;assets:Asset[];accounts:Account[]};
export const money=(cents:number)=>(cents/100).toLocaleString("pt-BR",{style:"currency",currency:"BRL"});
export const pct=(n:number)=>n.toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2})+"%";
export function useMarket(){
  const [market,setMarket]=useState<Market|null>(null),[error,setError]=useState(false);
  useEffect(()=>{let alive=true,busy=false;async function poll(){if(busy)return;busy=true;try{const data=await request<Market>("/api/desk/market");if(alive){setMarket(data);setError(false);}}catch{if(alive)setError(true);}finally{busy=false;}}void poll();const timer=window.setInterval(()=>void poll(),2000);return()=>{alive=false;window.clearInterval(timer);};},[]);
  return {market,error};
}
export function Ranking({market,compact=false,onSelect}:{market:Market|null;compact?:boolean;onSelect?:(id:string)=>void}){
  const rows=[...(market?.accounts??[])].sort((a,b)=>Number(b.trades>0)-Number(a.trades>0)||(b.return_pct-b.drawdown_pct*.5)-(a.return_pct-a.drawdown_pct*.5));
  return <div className="mv3-ranking"><h3>Ranking dos operadores</h3><p className="mv3-muted">Pontuação: retorno − 0,5 × perda máxima observada. Sem operações, sem classificação.</p><table><thead><tr><th>Agente</th><th>Retorno</th>{!compact&&<><th>Perda máx.</th><th>Acerto</th><th>Ordens</th><th>Patrimônio</th></>}</tr></thead><tbody>{rows.slice(0,compact?5:rows.length).map((a,i)=><tr key={a.agent_id}><td><button className="mv3-link" onClick={()=>onSelect?.(a.agent_id)}>{a.trades?i+1:"—"} · {a.name}</button></td><td className={a.return_pct<0?"mv3-loss":"mv3-gain"}>{pct(a.return_pct)}</td>{!compact&&<><td>{pct(a.drawdown_pct)}</td><td>{a.win_pct===null?"—":pct(a.win_pct)}</td><td>{a.trades}</td><td>{money(a.equity)}</td></>}</tr>)}</tbody></table>{!rows.length&&<p>Carregando carteiras…</p>}</div>;
}
function Chart({asset}:{asset:Asset}){
  const lo=Math.min(...asset.candles.map(c=>c.low)),hi=Math.max(...asset.candles.map(c=>c.high));
  const y=(v:number)=>190-(v-lo)/Math.max(1,hi-lo)*160;
  return <svg className="mv3-chart" viewBox="0 0 720 220" role="img" aria-label={"Velas de "+asset.symbol}><rect width="720" height="220" fill="#f3f0e9"/>{[30,70,110,150,190].map(v=><line key={v} x1="8" x2="710" y1={v} y2={v} stroke="#d6d1c7"/>)}{asset.candles.map((c,i)=>{const x=14+i*19,color=c.close>=c.open?"#327a5e":"#ad5148";return <g key={c.time}><line x1={x} x2={x} y1={y(c.high)} y2={y(c.low)} stroke={color}/><rect x={x-5} y={Math.min(y(c.open),y(c.close))} width="10" height={Math.max(2,Math.abs(y(c.open)-y(c.close)))} fill={color}/></g>;})}<text x="10" y="213" fill="#655f56" fontSize="11">6 minutos · velas sintéticas</text></svg>;
}
export function MarketScreen({market,error,onSelect}:{market:Market|null;error:boolean;onSelect:(id:string)=>void}){
  const [symbol,setSymbol]=useState("AUR");
  const a=market?.assets.find(v=>v.symbol===symbol);
  return <div className="mv3-page"><h2>Bolsa simulada</h2><p>Mercado fictício compartilhado, atualizado a cada dois segundos. Não há corretora, blockchain pública nem dinheiro real.</p>{error&&<p role="alert">Conexão com o simulador indisponível. Cotações anteriores não são atuais.</p>}<div className="mv3-marketgrid"><section><table><thead><tr><th>Ativo</th><th>Último</th><th>1 min</th></tr></thead><tbody>{market?.assets.map(v=><tr key={v.symbol}><td><button className="mv3-link" onClick={()=>setSymbol(v.symbol)} aria-pressed={symbol===v.symbol}>{v.symbol}</button></td><td>{money(v.last)}</td><td className={v.change_pct<0?"mv3-loss":"mv3-gain"}>{pct(v.change_pct)}</td></tr>)}</tbody></table>{a&&<><h3>{a.symbol} · {money(a.last)}</h3><Chart asset={a}/><p>Compra: {money(a.ask)} · Venda: {money(a.bid)} · Liquidez por ordem: {a.liquidity} · Taxa: 0,1%</p></>}</section><Ranking market={market} onSelect={onSelect}/></div></div>;
}
export function AgentMarket({id}:{id:string}){
  const [data,setData]=useState<(Account&{history:{id:string;symbol:string;side:string;quantity:number;price:number;fee:number}[]})|null>(null);
  const [symbol,setSymbol]=useState("AUR"),[qty,setQty]=useState(1),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
  const url="/api/desk/market/agents/"+encodeURIComponent(id);
  const refresh=async()=>setData(await request<NonNullable<typeof data>>(url));
  useEffect(()=>{let alive=true;const poll=async()=>{try{const v=await request<NonNullable<typeof data>>(url);if(alive)setData(v);}catch{if(alive)setMessage("Carteira indisponível.");}};void poll();const t=window.setInterval(()=>void poll(),4000);return()=>{alive=false;window.clearInterval(t);};},[url]);
  async function permission(enabled:boolean){setBusy(true);try{await put(url+"/permission",{enabled});await refresh();setMessage(enabled?"Permissão simulada ativada. Nenhuma estratégia iniciada.":"Operações bloqueadas.");}catch{setMessage("Não foi possível salvar a permissão.");}finally{setBusy(false);}}
  async function order(side:string){setBusy(true);setMessage("");try{await post(url+"/orders",{symbol,side,quantity:qty,order_id:crypto.randomUUID()});await refresh();setMessage("Ordem simulada confirmada.");}catch(e){setMessage(e instanceof Error?e.message:"Ordem recusada.");}finally{setBusy(false);}}
  return <section><h3>Carteira e permissão de simulação</h3><p>Saldo inicial: R$ 100.000 fictícios. Nenhuma ordem automática nesta etapa.</p>{data&&<><p>Patrimônio <strong>{money(data.equity)}</strong> · Saldo {money(data.cash)} · Retorno {pct(data.return_pct)}</p><button disabled={busy} onClick={()=>void permission(!data.enabled)}>{data.enabled?"Bloquear operações simuladas":"Autorizar operações simuladas"}</button><p>Teste manual da carteira:</p><div className="mv3-row"><select aria-label="Ativo" value={symbol} onChange={e=>setSymbol(e.target.value)}>{["AUR","NEX","VLT","ORB","SOLX","BRV"].map(s=><option key={s}>{s}</option>)}</select><input aria-label="Quantidade" type="number" min="1" value={qty} onChange={e=>setQty(Number(e.target.value))}/><button disabled={!data.enabled||busy||!Number.isInteger(qty)||qty<1} onClick={()=>void order("buy")}>Comprar</button><button disabled={!data.enabled||busy||!Number.isInteger(qty)||qty<1} onClick={()=>void order("sell")}>Vender</button></div><p>Posições: {data.positions.map(p=>p.symbol+" "+p.quantity).join(" · ")||"Nenhuma"}</p><h4>Ordens recentes</h4>{data.history.slice(0,8).map(t=><p key={t.id}>{t.side==="buy"?"Compra":"Venda"} · {t.quantity} {t.symbol} · {money(t.price)} · taxa {money(t.fee)}</p>)}</>}{message&&<p role="status">{message}</p>}</section>;
}
