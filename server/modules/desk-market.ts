
import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";

export const INITIAL_CENTS = 10_000_000;
export const SYMBOLS = ["AUR", "NEX", "VLT", "ORB", "SOLX", "BRV"] as const;
type SymbolName = typeof SYMBOLS[number];
const BASE = [12500, 7400, 3800, 21300, 9500, 5200];
const TICK_MS = 2000;
export function quote(symbol: SymbolName, tick: number) {
  const i = SYMBOLS.indexOf(symbol);
  const phase = tick + i * 137;
  const trend = 0.10 * Math.sin(phase / 240) + 0.045 * Math.sin(phase / 41);
  const noise = 0.012 * Math.sin(phase * 1.73) + 0.006 * Math.cos(phase * 2.39);
  const shock = 0.045 * Math.sin(phase / 11) * Math.pow(Math.max(0, Math.sin(phase / 73)), 12);
  const last = Math.max(100, Math.round(BASE[i] * (1 + trend + noise + shock)));
  const spread = Math.max(2, Math.round(last * 0.001));
  return { symbol, last, bid: last - spread, ask: last + spread, liquidity: 100 + Math.floor(50 * (1 + Math.sin(phase / 8))) };
}
const tickNow = () => Math.floor(Date.now() / TICK_MS);
type Account = { agent_id: string; cash: number; peak: number; drawdown: number; enabled: number };
type Position = { symbol: SymbolName; quantity: number; basis: number };
type Trade = { id: string; agent_id: string; symbol: SymbolName; side: string; quantity: number; price: number; fee: number; realized: number; created_at: number };
export function installDeskMarket(app: Express, db: DatabaseSync) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS desk_market_accounts(agent_id TEXT PRIMARY KEY REFERENCES agents(id) ON DELETE CASCADE, cash INTEGER NOT NULL, peak INTEGER NOT NULL, drawdown REAL NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS desk_market_positions(agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, symbol TEXT NOT NULL, quantity INTEGER NOT NULL, basis INTEGER NOT NULL, PRIMARY KEY(agent_id,symbol));
    CREATE TABLE IF NOT EXISTS desk_market_trades(id TEXT PRIMARY KEY, agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE, symbol TEXT NOT NULL, side TEXT NOT NULL, quantity INTEGER NOT NULL, price INTEGER NOT NULL, fee INTEGER NOT NULL, realized INTEGER NOT NULL, created_at INTEGER NOT NULL);
  `);
  const agentExists = (id:string) => Boolean(db.prepare("SELECT 1 FROM agents WHERE id=?").get(id));
  const ensure = (id:string) => {
    db.prepare("INSERT OR IGNORE INTO desk_market_accounts(agent_id,cash,peak) VALUES(?,?,?)").run(id,INITIAL_CENTS,INITIAL_CENTS);
    return db.prepare("SELECT * FROM desk_market_accounts WHERE agent_id=?").get(id) as unknown as Account;
  };
  const positions = (id:string) => db.prepare("SELECT symbol,quantity,basis FROM desk_market_positions WHERE agent_id=? AND quantity>0").all(id) as unknown as Position[];
  const account = (id:string,tick:number) => {
    const a=ensure(id), holdings=positions(id);
    const equity=a.cash+holdings.reduce((n,p)=>n+p.quantity*quote(p.symbol,tick).bid,0);
    const peak=Math.max(a.peak,equity), drawdown=Math.max(a.drawdown,(peak-equity)/peak*100);
    if(peak!==a.peak || drawdown!==a.drawdown) db.prepare("UPDATE desk_market_accounts SET peak=?,drawdown=? WHERE agent_id=?").run(peak,drawdown,id);
    const stats=db.prepare("SELECT COUNT(*) AS trades, SUM(CASE WHEN side='sell' THEN 1 ELSE 0 END) AS closed, SUM(CASE WHEN side='sell' AND realized>0 THEN 1 ELSE 0 END) AS wins, COALESCE(SUM(realized),0) AS realized FROM desk_market_trades WHERE agent_id=?").get(id) as {trades:number;closed:number|null;wins:number|null;realized:number};
    return {agent_id:id,cash:a.cash,equity,enabled:Boolean(a.enabled),positions:holdings,return_pct:(equity/INITIAL_CENTS-1)*100,drawdown_pct:drawdown,trades:stats.trades,win_pct:stats.closed?Number(stats.wins)/stats.closed*100:null,realized:stats.realized};
  };
  // The price path is shared, reproducible, and advances by wall clock; no external exchange.
  app.get("/api/desk/market",(_req,res)=>{
    const tick=tickNow();
    const assets=SYMBOLS.map(symbol=>{
      const candles=Array.from({length:36},(_,i)=>{
        const t=tick-(35-i)*5;
        const prices=Array.from({length:5},(_,k)=>quote(symbol,t-4+k).last);
        return {time:t*TICK_MS,open:prices[0],high:Math.max(...prices),low:Math.min(...prices),close:prices[4]};
      });
      return {...quote(symbol,tick),candles,change_pct:(quote(symbol,tick).last/quote(symbol,tick-30).last-1)*100};
    });
    const agents=db.prepare("SELECT id,name,role FROM agents ORDER BY id").all() as unknown as {id:string;name:string;role:string}[];
    const accounts=agents.map(a=>({...account(a.id,tick),name:a.name,role:a.role})).sort((a,b)=>(b.return_pct-b.drawdown_pct*.5)-(a.return_pct-a.drawdown_pct*.5));
    res.json({simulated:true,updated_at:tick*TICK_MS,initial_cents:INITIAL_CENTS,assets,accounts});
  });
  app.get("/api/desk/market/agents/:id",(req,res)=>{
    const id=String(req.params.id);
    if(!agentExists(id)) return res.status(404).json({error:"Agente não encontrado"});
    return res.json({...account(id,tickNow()),history:db.prepare("SELECT * FROM desk_market_trades WHERE agent_id=? ORDER BY created_at DESC,id DESC LIMIT 100").all(id)});
  });
  app.put("/api/desk/market/agents/:id/permission",(req,res)=>{
    const id=String(req.params.id);
    if(!agentExists(id)) return res.status(404).json({error:"Agente não encontrado"});
    if(typeof req.body?.enabled!=="boolean") return res.status(400).json({error:"Permissão inválida"});
    ensure(id); db.prepare("UPDATE desk_market_accounts SET enabled=? WHERE agent_id=?").run(Number(req.body.enabled),id);
    return res.json({ok:true,simulated:true});
  });
  app.post("/api/desk/market/agents/:id/orders",(req,res)=>{
    const id=String(req.params.id), body=req.body??{};
    if(!agentExists(id)) return res.status(404).json({error:"Agente não encontrado"});
    const {symbol,side,quantity,order_id}=body;
    if(!SYMBOLS.includes(symbol)||!["buy","sell"].includes(side)||!Number.isSafeInteger(quantity)||quantity<1||quantity>10000||typeof order_id!=="string"||!/^[a-zA-Z0-9_-]{8,100}$/.test(order_id))
      return res.status(400).json({error:"Ordem inválida"});
    const existing=db.prepare("SELECT * FROM desk_market_trades WHERE id=?").get(order_id) as unknown as Trade|undefined;
    if(existing) {
      if(existing.agent_id!==id||existing.symbol!==symbol||existing.side!==side||existing.quantity!==quantity) return res.status(409).json({error:"Identificador de ordem já utilizado"});
      return res.json({simulated:true,trade:existing,replayed:true});
    }
    if(body.task_id!==undefined && (typeof body.task_id!=="string" || !db.prepare("SELECT 1 FROM tasks WHERE id=? AND assigned_agent_id=? AND status='in_progress'").get(body.task_id,id))) return res.status(403).json({error:"Tarefa não está ativa para este agente"});
    const a=ensure(id);
    if(!a.enabled) return res.status(403).json({error:"Operações simuladas desativadas para este agente"});
    const tick=tickNow(), q=quote(symbol,tick);
    if(quantity>q.liquidity) return res.status(409).json({error:"Quantidade excede a liquidez desta cotação"});
    const price=side==="buy"?q.ask:q.bid, gross=price*quantity, fee=Math.max(1,Math.ceil(gross*.001));
    const pos=positions(id).find(p=>p.symbol===symbol);
    if(side==="buy" && a.cash<gross+fee) return res.status(409).json({error:"Saldo fictício insuficiente"});
    if(side==="sell" && (!pos||pos.quantity<quantity)) return res.status(409).json({error:"Posição insuficiente; venda descoberta proibida"});
    const oldQty=pos?.quantity??0, oldBasis=pos?.basis??0;
    const soldBasis=side==="sell"?Math.round(oldBasis*quantity/oldQty):0;
    const newQty=oldQty+(side==="buy"?quantity:-quantity), newBasis=side==="buy"?oldBasis+gross+fee:oldBasis-soldBasis;
    const realized=side==="sell"?gross-fee-soldBasis:0, cash=a.cash+(side==="buy"?-gross-fee:gross-fee);
    account(id,tick);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("UPDATE desk_market_accounts SET cash=? WHERE agent_id=?").run(cash,id);
      db.prepare("INSERT INTO desk_market_positions(agent_id,symbol,quantity,basis) VALUES(?,?,?,?) ON CONFLICT(agent_id,symbol) DO UPDATE SET quantity=excluded.quantity,basis=excluded.basis").run(id,symbol,newQty,newBasis);
      db.prepare("INSERT INTO desk_market_trades VALUES(?,?,?,?,?,?,?,?,?)").run(order_id,id,symbol,side,quantity,price,fee,realized,Date.now());
      db.exec("COMMIT");
    } catch(e) { db.exec("ROLLBACK"); throw e; }
    return res.status(201).json({simulated:true,trade:db.prepare("SELECT * FROM desk_market_trades WHERE id=?").get(order_id),account:account(id,tick)});
  });
}
