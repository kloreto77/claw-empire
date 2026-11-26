
import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { encryptSecret,decryptSecret } from "../oauth/helpers.ts";
import { PORT } from "../config/runtime.ts";
type Row={id:string;agent_id:string;name:string;kind:"api"|"mcp";url:string;secret:string|null;enabled:number;allowed:string;tested_at:number|null};
type McpTool={name:string;description?:string;inputSchema?:Record<string,unknown>;annotations?:{readOnlyHint?:boolean}};
type Db={prepare:(sql:string)=>{get:(...args:any[])=>unknown}};
export type ExternalTool={definition:{type:"function";function:{name:string;description:string;parameters:Record<string,unknown>}};call:(args:Record<string,unknown>,signal:AbortSignal)=>Promise<unknown>};
function checkedUrl(input:string){
  const u=new URL(input);
  const loop=["localhost","127.0.0.1","[::1]"].includes(u.hostname);
  if(u.username||u.password||u.hash||u.search||(!loop&&u.protocol!=="https:")||(loop&&!["http:","https:"].includes(u.protocol))||(loop&&Number(u.port|| (u.protocol==="https:"?443:80))===Number(PORT)))throw Error("Use HTTPS ou servidor local em outra porta, sem credenciais na URL.");
  return u.toString();
}
async function readResponse(r:Response,signal:AbortSignal){
  if(!r.ok)throw Error("Servidor externo retornou HTTP "+r.status);
  if(!r.body||r.status===202||r.status===204)return null;
  const reader=r.body.getReader(),decoder=new TextDecoder();let text="",bytes=0;
  const sse=(r.headers.get("content-type")??"").includes("text/event-stream");
  try{while(true){signal.throwIfAborted();const n=await reader.read();if(n.done)break;bytes+=n.value.byteLength;if(bytes>256000)throw Error("Resposta externa excede o limite.");text+=decoder.decode(n.value,{stream:true});
    if(sse){const blocks=text.split(/\r?\n\r?\n/);text=blocks.pop()??"";for(const b of blocks){const d=b.split(/\r?\n/).filter(l=>l.startsWith("data:")).map(l=>l.slice(5).trim()).join("\n");if(d){const v=JSON.parse(d);if(v.id!==undefined)return v;}}}
  }text+=decoder.decode();return text?JSON.parse(text):null;}finally{void reader.cancel().catch(()=>{});}
}
function headers(row:Row){const h:Record<string,string>={accept:"application/json, text/event-stream","content-type":"application/json"};if(row.secret)h.authorization="Bearer "+decryptSecret(row.secret);return h;}
async function apiGet(row:Row,signal:AbortSignal){const r=await fetch(checkedUrl(row.url),{headers:headers(row),redirect:"error",signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});return readResponse(r,signal);}
async function mcpSession(row:Row,signal:AbortSignal,fn:(rpc:(method:string,params?:Record<string,unknown>)=>Promise<any>)=>Promise<unknown>){
  const h=headers(row);let seq=0;
  const rpc=async(method:string,params:Record<string,unknown>={})=>{
    const notification=method.startsWith("notifications/");
    const timeout=AbortSignal.any([signal,AbortSignal.timeout(15000)]);
    const r=await fetch(checkedUrl(row.url),{method:"POST",headers:h,redirect:"error",signal:timeout,body:JSON.stringify({jsonrpc:"2.0",...(notification?{}:{id:++seq}),method,params})});
    const session=r.headers.get("mcp-session-id");if(session)h["mcp-session-id"]=session;
    const reply=await readResponse(r,timeout) as any;
    if(notification)return null;
    if(reply?.error||reply?.id!==seq)throw Error("Resposta MCP inválida ou erro do servidor.");
    return reply.result;
  };
  try{
    const info=await rpc("initialize",{protocolVersion:"2025-03-26",capabilities:{},clientInfo:{name:"Mesa de Operações",version:"3.0.0"}});
    if(typeof info?.protocolVersion!=="string")throw Error("Negociação MCP inválida.");
    h["mcp-protocol-version"]=info.protocolVersion;await rpc("notifications/initialized");
    return await fn(rpc);
  }finally{if(h["mcp-session-id"])void fetch(checkedUrl(row.url),{method:"DELETE",headers:h,redirect:"error",signal:AbortSignal.timeout(3000)}).then(r=>r.body?.cancel()).catch(()=>{});}
}
async function discover(row:Row,signal:AbortSignal){
  return await mcpSession(row,signal,async rpc=>{
    const all:McpTool[]=[];let cursor:unknown=undefined;
    for(let i=0;i<5;i++){const r=await rpc("tools/list",typeof cursor==="string"?{cursor}:{});if(!Array.isArray(r?.tools))throw Error("Catálogo MCP inválido.");all.push(...r.tools);cursor=r.nextCursor;if(!cursor)break;}
    return all.filter(t=>typeof t.name==="string"&&t.name.length<=120&&t.annotations?.readOnlyHint===true).map(t=>({name:t.name,description:String(t.description??"").slice(0,500)}));
  }) as {name:string;description:string}[];
}
export function installDeskConnections(app:Express,db:DatabaseSync){
  db.exec(`CREATE TABLE IF NOT EXISTS desk_connections(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,name TEXT NOT NULL,kind TEXT NOT NULL,url TEXT NOT NULL,secret TEXT,enabled INTEGER NOT NULL DEFAULT 0,allowed TEXT NOT NULL DEFAULT '[]',tested_at INTEGER,UNIQUE(agent_id,name));`);
  const row=(agent:string,id:string)=>db.prepare("SELECT * FROM desk_connections WHERE agent_id=? AND id=?").get(agent,id) as unknown as Row|undefined;
  const exists=(id:string)=>Boolean(db.prepare("SELECT 1 FROM agents WHERE id=?").get(id));
  app.get("/api/desk/agents/:id/connections",(req,res)=>{const id=String(req.params.id);if(!exists(id))return res.status(404).json({error:"Agente não encontrado"});return res.json({connections:db.prepare("SELECT id,name,kind,url,enabled,allowed,tested_at FROM desk_connections WHERE agent_id=? ORDER BY name").all(id)});});
  app.post("/api/desk/agents/:id/connections",(req,res)=>{
    const agent=String(req.params.id),b=req.body??{};if(!exists(agent))return res.status(404).json({error:"Agente não encontrado"});
    if(typeof b.name!=="string"||!b.name.trim()||b.name.length>80||!["api","mcp"].includes(b.kind)||typeof b.url!=="string"||b.url.length>1000||(b.token!==undefined&&(typeof b.token!=="string"||b.token.length>4000)))return res.status(400).json({error:"Dados inválidos"});
    try{const url=checkedUrl(b.url),id=randomUUID();if(db.prepare("SELECT 1 FROM desk_connections WHERE agent_id=? AND name=?").get(agent,b.name.trim()))return res.status(409).json({error:"Nome já utilizado"});db.prepare("INSERT INTO desk_connections(id,agent_id,name,kind,url,secret) VALUES(?,?,?,?,?,?)").run(id,agent,b.name.trim(),b.kind,url,b.token?encryptSecret(b.token):null);return res.status(201).json({id});}catch{return res.status(400).json({error:"URL ou credencial inválida"});}
  });
  app.post("/api/desk/agents/:id/connections/:connection/test",async(req,res)=>{
    const r=row(String(req.params.id),String(req.params.connection));if(!r)return res.status(404).json({error:"Conexão não encontrada"});
    try{const signal=AbortSignal.timeout(35000),tools=r.kind==="mcp"?await discover(r,signal):(await apiGet(r,signal),[{name:"get",description:"Consultar endpoint JSON cadastrado"}]);db.prepare("UPDATE desk_connections SET tested_at=?,enabled=0,allowed='[]' WHERE id=?").run(Date.now(),r.id);return res.json({ok:true,tools});}catch{return res.status(502).json({error:"Teste falhou: verifique endpoint, autenticação e suporte MCP Streamable HTTP/JSON."});}
  });
  app.put("/api/desk/agents/:id/connections/:connection",(req,res)=>{
    const r=row(String(req.params.id),String(req.params.connection));if(!r)return res.status(404).json({error:"Conexão não encontrada"});
    const b=req.body??{};if(typeof b.enabled!=="boolean"||!Array.isArray(b.allowed)||b.allowed.length>12||b.allowed.some((s:unknown)=>typeof s!=="string"||s.length>120)|| (b.enabled&&(!r.tested_at||!b.allowed.length)))return res.status(400).json({error:"Teste a conexão e selecione ferramentas de leitura."});
    db.prepare("UPDATE desk_connections SET enabled=?,allowed=? WHERE id=?").run(Number(b.enabled),JSON.stringify(b.allowed),r.id);return res.json({ok:true});
  });
  app.delete("/api/desk/agents/:id/connections/:connection",(req,res)=>{const r=row(String(req.params.id),String(req.params.connection));if(!r)return res.status(404).json({error:"Conexão não encontrada"});db.prepare("DELETE FROM desk_connections WHERE id=?").run(r.id);return res.json({ok:true});});
}
export async function loadDeskExternalTools(db:Db,agentId:string,signal:AbortSignal):Promise<ExternalTool[]>{
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='desk_connections'").get())return [];
  const query=db.prepare("SELECT * FROM desk_connections WHERE agent_id=? AND enabled=1 ORDER BY id LIMIT 8") as unknown as {all:(id:string)=>Row[]};
  const result:ExternalTool[]=[];
  for(const r of query.all(agentId)){
    const allowed=JSON.parse(r.allowed) as string[];
    const current=()=>{const v=db.prepare("SELECT * FROM desk_connections WHERE id=? AND agent_id=? AND enabled=1").get(r.id,agentId) as Row|undefined;if(!v)throw Error("Conexão revogada.");return v;};
    if(r.kind==="api"&&allowed.includes("get")){
      result.push({definition:{type:"function",function:{name:"ext_"+r.id.replace(/-/g,"").slice(0,20),description:"Consultar API JSON de leitura: "+r.name,parameters:{type:"object",properties:{},additionalProperties:false}}},call:async(_,s)=>{const v=current();if(!(JSON.parse(v.allowed) as string[]).includes("get"))throw Error("Ferramenta revogada.");return apiGet(v,s);}});
    }else if(r.kind==="mcp"){
      const tools=await mcpSession(r,signal,async rpc=>{const v=await rpc("tools/list");return (v?.tools??[]) as McpTool[];}) as McpTool[];
      for(const t of tools.filter(t=>allowed.includes(t.name)&&t.annotations?.readOnlyHint===true).slice(0,12)){
        const name="ext_"+r.id.replace(/-/g,"").slice(0,16)+"_"+result.length;
        result.push({definition:{type:"function",function:{name,description:(r.name+": "+t.name+" — "+String(t.description??"")).slice(0,700),parameters:t.inputSchema??{type:"object",properties:{}}}},call:async(args,s)=>{const v=current();if(!(JSON.parse(v.allowed) as string[]).includes(t.name))throw Error("Ferramenta revogada.");return mcpSession(v,s,async rpc=>{const l=await rpc("tools/list");if(!l?.tools?.some((x:McpTool)=>x.name===t.name&&x.annotations?.readOnlyHint===true))throw Error("Ferramenta não é mais anunciada como leitura.");return rpc("tools/call",{name:t.name,arguments:args});});}});
      }
    }
  }
  return result.slice(0,24);
}
