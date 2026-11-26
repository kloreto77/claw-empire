import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import WebSocket from "ws";
import {MinuteFeatures} from "./axiom-features.ts";
import {AxiomLedger} from "./axiom-ledger.ts";
import {createAxiomWorker} from "./axiom-worker.ts";

export const AXIOM_ID = "axiom-01";
const REST="https://data-api.binance.vision/api/v3";
const STREAM="wss://data-stream.binance.vision/stream?streams=";
const CAP=2*1024*1024*1024;
const BANDS=[5,10,25,50];
type Level=[string,string];
type Diff={U:number;u:number;E:number;b:Level[];a:Level[]};
type Snapshot={lastUpdateId:number;bids:Level[];asks:Level[]};
type Book={seq:number;bid:Map<number,number>;ask:Map<number,number>;received:number;event:number;flow:number;tradeId:number};
export function makeBook(s:Snapshot):Book{
  if(!Number.isSafeInteger(s.lastUpdateId)||s.lastUpdateId<0)throw Error("snapshot inválido");
  const b:Book={seq:s.lastUpdateId,bid:new Map(),ask:new Map(),received:0,event:0,flow:0,tradeId:-1};
  levels(b.bid,s.bids);levels(b.ask,s.asks);return b;
}
function levels(target:Map<number,number>,rows:Level[]){
  if(!Array.isArray(rows))throw Error("níveis inválidos");
  for(const [p,q] of rows){const price=Number(p),qty=Number(q);if(!Number.isFinite(price)||price<=0||!Number.isFinite(qty)||qty<0)throw Error("nível inválido");if(qty===0)target.delete(price);else target.set(price,qty);}
}
export function applyDepth(b:Book,d:Diff,now:number){
  if(!Number.isSafeInteger(d.U)||!Number.isSafeInteger(d.u)||d.U>d.u||!Number.isFinite(d.E))throw Error("sequência inválida");
  if(d.u<=b.seq)return false;
  if(d.U>b.seq+1)throw Error("MARKET_GAP");
  if(d.E>now+2000||now-d.E>3000)throw Error("relógio ou evento atrasado");
  levels(b.bid,d.b);levels(b.ask,d.a);
  if(b.bid.size>30000||b.ask.size>30000)throw Error("limite de níveis");
  b.seq=d.u;b.event=d.E;b.received=now;return true;
}
export function features(b:Book,now:number){
  if(!b.received||now-b.received>3000||now-b.event>3000)return null;
  let bid=0,ask=Infinity,low=Infinity,high=0;
  for(const p of b.bid.keys()){bid=Math.max(bid,p);low=Math.min(low,p);}
  for(const p of b.ask.keys()){ask=Math.min(ask,p);high=Math.max(high,p);}
  if(!bid||!Number.isFinite(ask)||bid>=ask)return null;
  const mid=(bid+ask)/2;
  if(low>mid*(1-.005)||high<mid*(1+.005))return null;
  const side=(m:Map<number,number>)=>BANDS.map((max,i)=>{let sum=0;const min=BANDS[i-1]??0;for(const [p,q] of m){const d=Math.abs(p/mid-1)*10000;if(d<=max&&(i===0||d>min))sum+=p*q;}return sum;});
  const bids=side(b.bid),asks=side(b.ask);
  const mass=[...bids,...asks].reduce((a,v)=>a+v,0);
  if(!Number.isFinite(mass)||mass<=0)return null;
  const entropy=(a:number[])=>{const sum=a.reduce((x,y)=>x+y,0);return sum?-a.reduce((x,y)=>y>0?x+(y/sum)*Math.log(y/sum):x,0)/Math.log(a.length):null;};
  return {seq:b.seq,event:b.event,received:b.received,bid,ask,mid,spread_bps:(ask-bid)/mid*10000,bids,asks,imbalance:(bids.reduce((a,v)=>a+v,0)-asks.reduce((a,v)=>a+v,0))/mass,entropy_bid:entropy(bids),entropy_ask:entropy(asks),flow:b.flow};
}
type Info={symbol:string;status:string;baseAsset:string;quoteAsset:string;isSpotTradingAllowed:boolean};
type Ticker={symbol:string;quoteVolume:string};
export function universe(info:Info[],tickers:Ticker[]){
 const stable=new Set(["USDT","USDC","FDUSD","TUSD","DAI","USDP","USD1","USDS","BUSD","PYUSD","EUR","BRL","GBP","TRY","EURI","AEUR","XUSD","USDE"]);
 const volume=new Map(tickers.map(t=>[t.symbol,Number(t.quoteVolume)]));
 const eligible=info.filter(s=>s.status==="TRADING"&&s.isSpotTradingAllowed===true&&s.quoteAsset==="USDT"&&!stable.has(s.baseAsset)&&!/(UP|DOWN|BULL|BEAR)$/.test(s.baseAsset)&&Number.isFinite(volume.get(s.symbol))&&(volume.get(s.symbol)??0)>0);
 const ranked=eligible.sort((a,b)=>(volume.get(b.symbol)??0)-(volume.get(a.symbol)??0)||a.symbol.localeCompare(b.symbol));
 return [...new Set([...["BTCUSDT","ETHUSDT"].filter(x=>ranked.some(s=>s.symbol===x)),...ranked.map(s=>s.symbol)])].slice(0,20);
}
export function installAxiom(app:Express,db:DatabaseSync,logsDir:string){
  const root=join(logsDir,"axiom-01");mkdirSync(root,{recursive:true});
  db.exec("CREATE TABLE IF NOT EXISTS axiom_events(id TEXT PRIMARY KEY,ts INTEGER NOT NULL,kind TEXT NOT NULL,detail TEXT NOT NULL); CREATE INDEX IF NOT EXISTS axiom_event_ts ON axiom_events(ts);");
  const minuteFeatures=new MinuteFeatures(),ledger=new AxiomLedger(db),worker=createAxiomWorker(root,join(root,"science"));
  const scanTimer=setInterval(()=>{if(desired&&worker.status().available)worker.scan();},30*60*1000);scanTimer.unref();
  let minutes=0,liquidityMinutes=0;
  let desired=false,stage="STOPPED",error="",symbols:string[]=[],lastSample=0,valid=0,samples=0,fx:{symbol:string;bid:number;ask:number;ts:number}|null=null;
  let ws:WebSocket|null=null,retry:ReturnType<typeof setTimeout>|null=null,sampler:ReturnType<typeof setInterval>|null=null,abort:AbortController|null=null,epoch=0,backoff=10000,runId="";
  let disk=readdirSync(root).filter(f=>f.endsWith(".ndjson")).reduce((n,f)=>n+statSync(join(root,f)).size,0);
  let queue:string[]=[],queueBytes=0; const books=new Map<string,Book>(),buffers=new Map<string,Diff[]>();
  const event=(kind:string,detail:string)=>db.prepare("INSERT INTO axiom_events VALUES(?,?,?,?)").run(randomUUID(),Date.now(),kind,detail.slice(0,2000));
  function record(kind:string,data:unknown,ts=Date.now()){
    const line=JSON.stringify({schema_version:1,operator_id:AXIOM_ID,run_id:runId,strategy_version:"1.0.0-draft",ts_receive_utc:ts,kind,data})+"\n";
    const size=Buffer.byteLength(line);if(disk+queueBytes+size>CAP||queueBytes+size>16*1024*1024)throw Error("limite de armazenamento; preservar histórico e interromper coleta");
    queue.push(line);queueBytes+=size;
  }
  function flush(){
    if(!queue.length)return;
    // File per receive day; no automatic deletion or replacement of evidence.
    appendFileSync(join(root,new Date().toISOString().slice(0,10)+".ndjson"),queue.join(""),"utf8");
    disk+=queueBytes;queue=[];queueBytes=0;
  }
  function clear(){epoch++;abort?.abort();abort=null;if(retry)clearTimeout(retry);retry=null;if(sampler)clearInterval(sampler);sampler=null;if(ws){ws.removeAllListeners();ws.on("error",()=>{});ws.terminate();ws=null;}books.clear();buffers.clear();minuteFeatures.reset();valid=0;fx=null;}
  function stop(reason:string){desired=false;clear();try{flush();}catch(e){error=String(e);}stage="STOPPED";event("STOP",reason);}
  function fault(e:unknown,delay?:number){
    error=e instanceof Error?e.message:String(e);clear();
    try{flush();event("MARKET_GAP",error);}catch{desired=false;}
    if(!desired||/armazenamento|ENOSPC|EDQUOT/.test(error)){desired=false;stage="BLOCKED";return;}
    stage="RECONNECTING";const wait=Math.max(delay??0,backoff)+Math.floor(Math.random()*2000);backoff=Math.min(300000,backoff*2);
    retry=setTimeout(()=>{if(desired)void connect();},wait);retry.unref();
  }
  async function get<T>(path:string,signal:AbortSignal):Promise<T>{
    const resp=await fetch(REST+path,{signal:AbortSignal.any([signal,AbortSignal.timeout(20000)]),redirect:"error"});
    if(!resp.ok){const e=new Error("Binance HTTP "+resp.status);if(resp.status===429||resp.status===418){const delay=Number(resp.headers.get("retry-after"));Object.assign(e,{wait:Number.isFinite(delay)&&delay>0?delay*1000:300000});}throw e;}
    return await resp.json() as T;
  }
  async function connect(){
    clear();const gen=epoch;abort=new AbortController();const signal=abort.signal;stage="CONNECTING";error="";runId=randomUUID();
    try{
      const before=Date.now(),time=await get<{serverTime:number}>("/time",signal),after=Date.now();
      if(!Number.isFinite(time.serverTime)||Math.abs(time.serverTime-(before+after)/2)>2000||after-before>3000)throw Error("relógio fora de tolerância");
      const info=await get<{symbols:Info[]}>("/exchangeInfo",signal),tickers=await get<Ticker[]>("/ticker/24hr",signal);
      if(gen!==epoch||!desired)return;
      symbols=universe(info.symbols,tickers);
      if(symbols.length<12)throw Error("menos de 12 pares elegíveis");
      const fxSymbol=info.symbols.find(s=>s.symbol==="USDTBRL"&&s.status==="TRADING"&&s.isSpotTradingAllowed===true&&s.baseAsset==="USDT"&&s.quoteAsset==="BRL")?.symbol;
      record("UNIVERSE",{symbols,selection:"provisória por volume; filtro de spread/profundidade e histórico ainda pendentes",fxSymbol:fxSymbol??null});
      const channels=symbols.flatMap(s=>[s.toLowerCase()+"@depth@100ms",s.toLowerCase()+"@aggTrade"]);
      if(fxSymbol)channels.push(fxSymbol.toLowerCase()+"@bookTicker");
      for(const s of symbols)buffers.set(s,[]);
      const socket=new WebSocket(STREAM+channels.join("/"),{handshakeTimeout:20000,maxPayload:4*1024*1024});ws=socket;
      let started=Date.now(),lastMessage=Date.now(),syncing=false;
      socket.on("error",e=>{if(gen===epoch)fault(e);});socket.on("close",()=>{if(gen===epoch)fault(Error("stream encerrado"));});
      socket.on("message",raw=>{
        if(gen!==epoch||!desired)return;
        try{
          const msg=JSON.parse(raw.toString()),d=msg.data,now=Date.now();if(!d||typeof d.s!=="string")return;
          lastMessage=now;record("WS",d,now);
          if(fxSymbol&&d.s===fxSymbol&&msg.stream.endsWith("@bookTicker")){
            const bid=Number(d.b),ask=Number(d.a);fx=bid>0&&ask>=bid&&Number.isFinite(ask)?{symbol:fxSymbol,bid,ask,ts:now}:null;return;
          }
          if(!buffers.has(d.s))return;
          if(d.e==="depthUpdate"){
            const book=books.get(d.s);if(book)applyDepth(book,d as Diff,now);
            else{const buf=buffers.get(d.s)!;buf.push(d);if(buf.length>10000)throw Error("buffer de livro excedido");}
          }else if(d.e==="aggTrade"){
            const book=books.get(d.s);if(!book)return;
            if(!Number.isSafeInteger(d.a)||!Number.isFinite(Number(d.p)*Number(d.q))||typeof d.m!=="boolean")throw Error("trade inválido");
            if(d.a<=book.tradeId)return;
            if(book.tradeId>=0&&d.a>book.tradeId+1)throw Error("gap de aggTrades");
            book.tradeId=d.a;book.flow+=(d.m?-1:1)*Number(d.p)*Number(d.q);
          }
        }catch(e){fault(e);}
      });
      socket.on("open",()=>{
        if(gen!==epoch||syncing)return;syncing=true;stage="SYNCING";
        void (async()=>{
          try{
            for(const symbol of symbols){
              let applied=false;
              for(let attempt=0;attempt<4&&!applied;attempt++){
                if(gen!==epoch||!desired)return;
                const snap=await get<Snapshot>("/depth?symbol="+symbol+"&limit=1000",signal);
                if(gen!==epoch||!desired)return;
                const buf=buffers.get(symbol)!;
                if(!buf.length||snap.lastUpdateId<buf[0].U-1){await new Promise(r=>setTimeout(r,500));continue;}
                const b=makeBook(snap);record("SNAPSHOT",{symbol,snapshot:snap});
                // Buffered updates can be old while snapshots are downloaded. Replay the sequence
                // with event-time checks, then require fresh updates before emitting features.
                for(const d of buf)applyDepth(b,d,d.E);
                b.received=Date.now();books.set(symbol,b);buf.length=0;applied=true;
              }
              if(!applied)throw Error("snapshot sem ponte de sequência: "+symbol);
            }
            if(gen!==epoch||!desired)return;stage="COLLECT_ONLY";backoff=10000;event("COLLECT_ONLY","Feed sincronizado; entradas bloqueadas até validação científica.");
          }catch(e){if(gen===epoch)fault(e,(e as {wait?:number})?.wait);}
        })();
      });
      sampler=setInterval(()=>{
        if(gen!==epoch||!desired)return;
        try{
          const now=Date.now();
          if(now-lastMessage>30000)throw Error("stream sem mensagens");
          if(now-started>23*3600000+50*60000)throw Error("rotação preventiva do stream");
          let n=0;if(stage==="COLLECT_ONLY"){
            for(const [symbol,b] of books){const f=features(b,now);b.flow=0;if(f){record("FEATURE_1S",{symbol,...f,fx:fx&&now-fx.ts<=60000?fx:null},now);n++;samples++;const result=minuteFeatures.push(symbol,now,f);if(result){record("FEATURE_1M",{symbol,...result.minute},now);minutes++;if(result.liquidity){record("LIQUIDITY_W1",{symbol,minute_end:result.minute.end,...result.liquidity,method:"grouped_band_midpoints"},now);liquidityMinutes++;}}}}
            valid=n;if(n)lastSample=now;
          }
          flush();
        }catch(e){fault(e);}
      },1000);sampler.unref();
    }catch(e){if(gen===epoch)fault(e,(e as {wait?:number})?.wait);}
  }
  const status=()=>({installed:Boolean(db.prepare("SELECT 1 FROM agents WHERE id=?").get(AXIOM_ID)),stage,desired,error,symbols,valid,samples,lastSample,minutes,liquidityMinutes,worker:worker.status(),ledger:db.prepare("SELECT 1 FROM agents WHERE id=?").get(AXIOM_ID)?ledger.status(Date.now()):null,fx:fx&&Date.now()-fx.ts<=60000?fx:null,disk_bytes:disk+queueBytes,disk_limit:CAP,paper_enabled:false,blockers:["Histórico L2 e filtros de universo não validados","Motores completos e calibração pendentes","Ledger fracionário implementado; simulador IOC e FX de execução pendentes","Supervisor Qwen e laboratório pendentes"],events:db.prepare("SELECT id,ts,kind,detail FROM axiom_events ORDER BY ts DESC LIMIT 30").all()});
  app.get("/api/desk/axiom/status",(_req,res)=>res.json(status()));
  app.post("/api/desk/axiom/scan",(_req,res)=>{if(!db.prepare("SELECT 1 FROM agents WHERE id=?").get(AXIOM_ID))return res.status(409).json({error:"Cadastre AXIOM primeiro."});worker.scan();return res.json(status());});
  app.post("/api/desk/axiom/start",(_req,res)=>{
    if(!db.prepare("SELECT 1 FROM agents WHERE id=?").get(AXIOM_ID)){
      const duplicate=db.prepare("SELECT id FROM agents WHERE lower(name)='axiom'").get();if(duplicate)return res.status(409).json({error:"Já existe AXIOM com outro ID; não sobrescrevemos agentes."});
      const count=db.prepare("SELECT COUNT(*) n FROM agents WHERE workflow_pack_key='development'").get() as {n:number};if(count.n>=12)return res.status(409).json({error:"Libere uma estação antes de cadastrar AXIOM."});
      const department=db.prepare("SELECT id FROM departments WHERE id='operations'").get()?"operations":null;
      db.prepare("INSERT INTO agents(id,name,name_ko,name_ja,name_zh,department_id,workflow_pack_key,role,personality) VALUES(?,?,?,?,?,?,?,?,?)").run(AXIOM_ID,"AXIOM","AXIOM","AXIOM","AXIOM",department,"development","junior","AXIOM V1: operador quantitativo em COLLECT_ONLY. Dados reais, execução exclusivamente simulada; IA não autoriza ordens. Método completo exige treinamento, calibração, ledger e aprovação humana.");
      event("REGISTERED","Operador registrado sem modelo ou autorização de ordens.");
    }
    if(!desired){desired=true;event("START","Coleta pública solicitada; nenhuma ordem autorizada.");void connect();if(worker.status().available)worker.scan();}
    return res.json(status());
  });
  app.post("/api/desk/axiom/stop",(_req,res)=>{stop("Coleta interrompida pelo operador.");return res.json(status());});
  const close=()=>{desired=false;clearInterval(scanTimer);worker.stop();clear();try{flush();}catch(e){console.error("[AXIOM] flush",e);}};
  process.once("SIGTERM",close);process.once("SIGINT",close);
}
