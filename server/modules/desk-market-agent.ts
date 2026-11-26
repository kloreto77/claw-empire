
import { createHash } from "node:crypto";
import { PORT, SESSION_AUTH_TOKEN } from "../config/runtime.ts";

const definitions=[
  {type:"function",function:{name:"mercado_simulado",description:"Pesquisar qualquer ativo do catálogo simulado por nome, código, categoria ou região. Lista paginada; para velas informe symbol. Nenhuma cotação é real.",parameters:{type:"object",properties:{symbol:{type:"string"},search:{type:"string"},category:{type:"string"},offset:{type:"integer",minimum:0}},additionalProperties:false}}},
  {type:"function",function:{name:"minha_carteira_simulada",description:"Consultar exclusivamente sua carteira fictícia, saldo, posições e histórico.",parameters:{type:"object",properties:{},additionalProperties:false}}},
  {type:"function",function:{name:"ordem_simulada",description:"Executar uma compra ou venda à vista no simulador, somente com capital fictício. A ordem pode ser recusada pelo servidor.",parameters:{type:"object",properties:{symbol:{type:"string",description:"Código exato do catálogo do simulador"},side:{type:"string",enum:["buy","sell"]},quantity:{type:"integer",minimum:1,maximum:10000}},required:["symbol","side","quantity"],additionalProperties:false}}}
];
type RequestData={url:string;headers:Record<string,string>;body:string};
type ToolCall={id:string;type:"function";function:{name:string;arguments:string}};
type Message={role:string;content?:string|null;tool_calls?:ToolCall[];tool_call_id?:string};
type Usage=Record<string,number>;
type MarketAgentOptions={request:RequestData;agentId:string;taskId:string;signal:AbortSignal;stillAllowed:()=>boolean;write:(text:string)=>void;usage:Usage;fetcher?:typeof fetch};
export async function runDeskMarketAgent(o:MarketAgentOptions):Promise<void>{
  const send=o.fetcher??fetch,body=JSON.parse(o.request.body) as {messages:Message[];[k:string]:unknown};
  const messages=[...body.messages,{role:"user",content:"Ferramentas autorizadas exclusivamente para esta tarefa: bolsa fictícia. Consulte a cotação e carteira; só envie ordens se forem necessárias às instruções do operador. Não há acesso a mercado real."}];
  const localBase="http://127.0.0.1:"+PORT+"/api/desk/market";
  const localHeaders={authorization:"Bearer "+SESSION_AUTH_TOKEN,"content-type":"application/json"};
  let used=0;
  for(let round=0;round<6;round++){
    o.signal.throwIfAborted();
    if(!o.stillAllowed())throw new Error("Permissão da carteira ou tarefa revogada.");
    const resp=await send(o.request.url,{method:"POST",headers:o.request.headers,body:JSON.stringify({...body,messages,stream:false,tools:definitions,tool_choice:round===5||used>=5?"none":"auto",parallel_tool_calls:false}),signal:o.signal});
    if(!resp.ok)throw new Error("Modelo recusou execução com ferramentas: HTTP "+resp.status);
    const data=await resp.json() as {choices?:{message?:Message}[];usage?:Usage};
    for(const k of ["prompt_tokens","completion_tokens","total_tokens","cost"]){const n=data.usage?.[k];if(typeof n==="number"&&Number.isFinite(n)&&n>=0)o.usage[k]=(o.usage[k]??0)+n;}
    const msg=data.choices?.[0]?.message;
    if(!msg)throw new Error("Modelo não retornou mensagem.");
    if(msg.content)o.write(msg.content+"\n");
    if(!msg.tool_calls?.length)return;
    if(round===5||used+msg.tool_calls.length>5)throw new Error("Limite de ferramentas desta tarefa atingido.");
    messages.push({role:"assistant",content:msg.content??null,tool_calls:msg.tool_calls});
    for(const tool of msg.tool_calls){
      o.signal.throwIfAborted();
      if(!o.stillAllowed())throw new Error("Permissão da carteira ou tarefa revogada.");
      used++;
      let result:unknown;
      try{
        if(!tool.id||typeof tool.function?.name!=="string")throw new Error("Chamada inválida");
        const name=tool.function.name;
        const args=JSON.parse(tool.function.arguments||"{}") as Record<string,unknown>;
        if(name==="mercado_simulado"||name==="minha_carteira_simulada"){
          const query=new URLSearchParams({limit:"30"});for(const k of ["search","category","offset"])if(args[k]!==undefined)query.set(k,String(args[k]));
          const url=name==="mercado_simulado"?(typeof args.symbol==="string"?localBase+"/quote/"+encodeURIComponent(args.symbol):localBase+"/quotes?"+query):localBase+"/agents/"+encodeURIComponent(o.agentId);
          const r=await send(url,{headers:localHeaders,redirect:"error",signal:o.signal});
          if(!r.ok)throw new Error("Consulta indisponível: "+r.status);
          const payload=await r.json() as Record<string,unknown>;
          result=payload;
        }else if(name==="ordem_simulada"){
          const key=createHash("sha256").update(o.taskId+"\0"+tool.id).digest("hex");
          const r=await send(localBase+"/agents/"+encodeURIComponent(o.agentId)+"/orders",{method:"POST",headers:localHeaders,redirect:"error",signal:o.signal,body:JSON.stringify({symbol:args.symbol,side:args.side,quantity:args.quantity,order_id:key,task_id:o.taskId})});
          result={status:r.status,...await r.json() as Record<string,unknown>};
        }else{throw new Error("Ferramenta não autorizada");}
      }catch(e){if(o.signal.aborted)throw e;result={error:e instanceof Error?e.message:"Falha na ferramenta"};}
      const text=JSON.stringify(result);
      o.write("[Simulador · "+tool.function.name+"] "+text.slice(0,800)+"\n");
      messages.push({role:"tool",tool_call_id:tool.id,content:text});
    }
  }
  throw new Error("Limite de rodadas do simulador atingido.");
}
