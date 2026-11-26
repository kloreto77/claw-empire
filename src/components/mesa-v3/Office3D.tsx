import { useEffect, useMemo, useRef, useState, type ComponentProps } from "react";
import Office, { statusName } from "./Office";
import type { Agent } from "../../types";

type Props = ComponentProps<typeof Office> & {
  connected: boolean;
  inlineCreate: boolean;
  onCreateAgent: (name: string, role: string) => Promise<Agent>;
  onTeam: () => void;
  onRanking: () => void;
  onConnections: () => void;
};
const roles: Record<string, string> = { "Operador": "junior", "Operador sênior": "senior", "Supervisor": "team_leader", "Estagiário": "intern" };
const roleLabels: Record<string, string> = { junior: "Operador", senior: "Operador sênior", team_leader: "Supervisor", intern: "Estagiário" };

export default function Office3D(props: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [fallback, setFallback] = useState(false);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const busy = useRef(false);
  const roster = useMemo(() => [...props.agents].sort((a,b)=>Number(a.created_at)-Number(b.created_at)||a.id.localeCompare(b.id)), [props.agents]);
  const seated = roster.slice(0,12);
  const rosterKey = JSON.stringify(seated.map(a=>a.id));
  const payload = {type:"mesa:snapshot", connected:props.connected, inlineCreate:props.inlineCreate,
    agents:seated.map((a,i)=>{
      const account=props.market?.accounts.find(row=>row.agent_id===a.id);
      const traded=Boolean(account && account.trades>0);
      return {id:i+1,name:a.name,role:roleLabels[a.role]??a.role,operational:statusName(a),working:a.status==="working",
        pnl:traded && account && props.market ? (account.equity-props.market.initial_cents)/100 : null,
        score:traded && account ? account.return_pct-account.drawdown_pct*.5 : null};
    })};
  const latest = useRef({props,seated,payload}); latest.current={props,seated,payload};
  const send = ()=>frame.current?.contentWindow?.postMessage(latest.current.payload,location.origin);
  useEffect(()=>{send();},[props.agents,props.market,props.connected,props.inlineCreate,rosterKey]);
  useEffect(()=>{
    setReady(false);setFailed(false);
    if(fallback)return;
    const timer=window.setTimeout(()=>setFailed(true),25000);
    const listener=(event:MessageEvent)=>{
      if(event.origin!==location.origin||event.source!==frame.current?.contentWindow||!event.data||typeof event.data!=="object")return;
      const m=event.data,p=latest.current.props;
      if(m.type==="mesa:ready")send();
      if(m.type==="mesa:rendered"){setReady(true);setFailed(false);window.clearTimeout(timer);}
      if(m.type==="mesa:error"){setFailed(true);window.clearTimeout(timer);}
      if(m.type==="mesa:configure"&&Number.isInteger(m.id)&&m.id>=1&&m.id<=12){
        const a=latest.current.seated[m.id-1];if(a)p.onSelect(a);
      }
      if(m.type==="mesa:team")p.onTeam();
      if(m.type==="mesa:area"){
        if(m.id==="server")p.onConnections();
        if(m.id==="ranking")p.onRanking();
        if(m.id==="meeting")p.onMeeting();
        if(m.id==="ops")p.onMarket();
      }
      if(m.type==="mesa:create"&&!busy.current&&p.connected&&p.inlineCreate&&typeof m.name==="string"&&typeof m.role==="string"){
        const name=m.name.trim().slice(0,30),role=roles[m.role];
        const source=frame.current?.contentWindow;
        const reply=(ok:boolean,error?:string)=>source?.postMessage({type:"mesa:create-result",ok,error},location.origin);
        if(!name||!role||latest.current.seated.length>=12){reply(false,"Preencha nome e cargo. Verifique as estações disponíveis.");return;}
        busy.current=true;
        void p.onCreateAgent(name,role).then(()=>reply(true)).catch((err:unknown)=>reply(false,err instanceof Error?err.message:"Não foi possível criar o agente.")).finally(()=>{busy.current=false;});
      }
    };
    window.addEventListener("message",listener);
    send();
    return()=>{window.clearTimeout(timer);window.removeEventListener("message",listener);};
  },[rosterKey,fallback]);
  useEffect(()=>{if(fallback||(!props.deliveries.length&&!props.calls.length))return;const timer=window.setTimeout(()=>{props.deliveries.forEach(v=>props.onDeliveryDone(v.id));props.calls.forEach(v=>props.onCallDone(v.id));},4500);return()=>window.clearTimeout(timer);},[fallback,props.deliveries,props.calls,props.onDeliveryDone,props.onCallDone]);
  if(fallback)return <div style={{height:"100%",display:"flex",flexDirection:"column"}}><button onClick={()=>setFallback(false)}>Voltar ao escritório 3D</button><div style={{flex:1,minHeight:0}}><Office {...props}/></div></div>;
  return <div style={{height:"100%",minHeight:0,display:"flex",flexDirection:"column",background:"#252c2d"}}>
    {failed&&<div role="alert" style={{padding:10,background:"#f4e7d0",color:"#333"}}>Não foi possível iniciar o 3D. <button onClick={()=>setFallback(true)}>Usar escritório 2D temporariamente</button></div>}
    {roster.length>12&&<div style={{padding:6,background:"#f4e7d0"}}>{roster.length-12} agentes adicionais sem estação visual. {roster.slice(12).map(a=><button key={a.id} onClick={()=>props.onSelect(a)}>{a.name}</button>)}</div>}
    <iframe key={rosterKey} ref={frame} title="Escritório 3D · Imersão Nitidez" src="/mesa-3d.html" onLoad={()=>send()} style={{width:"100%",flex:1,minHeight:0,border:0,display:"block",background:"#252c2d"}}/>
    {!ready&&!failed&&<span style={{padding:4,color:"#fff",fontSize:11}}>Iniciando escritório 3D local…</span>}
  </div>;
}
