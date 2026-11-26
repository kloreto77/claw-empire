
import { useEffect, useState } from "react";
import type { Agent, Task, MeetingPresence, CrossDeptDelivery, CeoOfficeCall } from "../../types";
import { buildSpriteMap } from "../AgentAvatar";
import { money,pct,Ranking,type Market } from "./market";

export const statusName=(a:Agent)=>!a.cli_provider||(a.cli_provider==="api"&&(!a.api_provider_id||!a.api_model))?"Sem modelo":({idle:"Disponível",working:"Trabalhando",break:"Em pausa",offline:"Desconectado"}[a.status]??a.status);
type Props={agents:Agent[];tasks:Task[];meetings:MeetingPresence[];deliveries:CrossDeptDelivery[];calls:CeoOfficeCall[];market:Market|null;onSelect:(a:Agent)=>void;onMeeting:()=>void;onDeliveryDone:(id:string)=>void;onCallDone:(id:string)=>void;onMarket:()=>void};
function Desk({x,y,executive=false}:{x:number;y:number;executive?:boolean}){return <g transform={"translate("+x+" "+y+")"}><path d="M-66 -20 L66 -20 78 3 -54 3Z" fill={executive?"#584238":"#b28a60"} stroke="#665444" strokeWidth="2"/><path d="M-54 3H78V13H-54Z" fill="#76563e"/><path d="M-48 13v29m117-29v29" stroke="#55483e" strokeWidth="6"/><path d="M-20 -25h42v21h-42z" fill="#303632" stroke="#151c1b" strokeWidth="3"/><path d="M-16 -21h34v13h-34z" fill="#75948b"/><path d="M0 -4v5m-10 1h20" stroke="#383b38" strokeWidth="3"/><path d="M-15 7h34" stroke="#d5c9b2" strokeWidth="3"/><rect x="37" y="-11" width="12" height="8" fill="#ded7c8"/></g>}
export default function Office({agents,tasks,meetings,deliveries,calls,market,onSelect,onMeeting,onDeliveryDone,onCallDone,onMarket}:Props){
  const [zoom,setZoom]=useState(1);
  const leaders=agents.filter(a=>a.role==="team_leader"),workers=agents.filter(a=>a.role!=="team_leader");
  const sprite=buildSpriteMap(agents);
  const slot=(a:Agent)=>a.role==="team_leader"?{x:230+leaders.indexOf(a)*145,y:180}:{x:155+(workers.indexOf(a)%4)*155,y:370+Math.floor(workers.indexOf(a)/4)*155};
  const height=Math.max(720,500+Math.ceil(workers.length/4)*155),width=Math.max(1130,390+leaders.length*145);
  useEffect(()=>{if(!deliveries.length&&!calls.length)return;const t=window.setTimeout(()=>{deliveries.forEach(v=>onDeliveryDone(v.id));calls.forEach(v=>onCallDone(v.id));},4500);return()=>window.clearTimeout(t);},[deliveries,calls,onDeliveryDone,onCallDone]);
  return <div className="mv3-office"><div className="mv3-toolbar"><span>Andar de operações</span><small>{agents.filter(a=>a.status==="working").length} em atividade · {agents.length} agentes · clique em um personagem para configurar</small><div><button onClick={()=>setZoom(z=>Math.max(.8,z-.15))}>−</button><button onClick={()=>setZoom(1)}>Ajustar</button><button onClick={()=>setZoom(z=>Math.min(2,z+.15))}>+</button><button onClick={()=>{if(document.fullscreenElement)void document.exitFullscreen();else void document.documentElement.requestFullscreen().catch(()=>{});}}>Tela cheia</button></div></div>
  <div className="mv3-scroller"><div className="mv3-floor" style={{width:zoom*100+"%",minWidth:Math.round(860*zoom),aspectRatio:width+"/"+height}}>
    <svg viewBox={"0 0 "+width+" "+height} className="mv3-floorplan" aria-label="Planta do escritório">
      <defs><pattern id="mv3-wood" width="80" height="24" patternUnits="userSpaceOnUse"><rect width="80" height="24" fill="#d8c6aa"/><path d="M0 0H80M0 24H80M40 0V24" stroke="#bfa888" strokeWidth="1"/></pattern><pattern id="mv3-tile" width="32" height="32" patternUnits="userSpaceOnUse"><rect width="32" height="32" fill="#c2c6bd"/><path d="M0 0H32V32" fill="none" stroke="#aeb4aa"/></pattern></defs>
      <rect x="22" y="22" width={width-44} height={height-44} rx="7" fill="url(#mv3-wood)" stroke="#454942" strokeWidth="12"/>
      <rect x="44" y="48" width={width-88} height="228" fill="#ece7d8" stroke="#777367" strokeWidth="3"/>
      <rect x="55" y="53" width={width-110} height="23" fill="#77928f"/><path d={"M60 76H"+(width-60)} stroke="#454b48" strokeWidth="4"/>
      {Array.from({length:9},(_,i)=><line key={i} x1={60+i*(width-120)/8} x2={60+i*(width-120)/8} y1="53" y2="76" stroke="#454b48" strokeWidth="3"/>)}
      <text x="75" y="107" className="mv3-roomlabel">SUPERVISÃO E DIRETORIA</text><Desk x={95} y={180} executive/><text x="95" y="239" textAnchor="middle" className="mv3-roomlabel">Diretor</text>
      {leaders.map(a=><Desk key={a.id} {...slot(a)} executive/>)}{!leaders.length&&<text x="230" y="185" className="mv3-roomlabel">Defina um supervisor no cargo do agente</text>}
      <rect x="48" y="290" width="690" height={height-328} fill="url(#mv3-wood)" stroke="#8e816a" strokeWidth="3"/>
      <text x="74" y="319" className="mv3-roomlabel">MESA DE OPERAÇÕES</text>{workers.map(a=><Desk key={a.id} {...slot(a)}/>)}
      <rect x="762" y="290" width={width-810} height="244" fill="url(#mv3-tile)" stroke="#747a70" strokeWidth="3"/>
      <text x="784" y="319" className="mv3-roomlabel">SALA DE REUNIÕES</text><rect x="805" y="378" width="250" height="87" rx="32" fill="#8d684a" stroke="#624b39" strokeWidth="5"/>
      {[830,900,970,1030].map(x=><g key={x}><rect x={x-15} y="350" width="30" height="22" rx="5" fill="#4e5750"/><rect x={x-15} y="472" width="30" height="22" rx="5" fill="#4e5750"/></g>)}
      <g role="button" tabIndex={0} onClick={onMeeting} onKeyDown={e=>{if(e.key==="Enter")onMeeting();}} style={{cursor:"pointer"}}><rect x="866" y="403" width="128" height="34" rx="4" fill="#d9cbb6"/><text x="930" y="425" textAnchor="middle" className="mv3-roomlabel">Reuniões</text></g>
      <rect x="762" y="551" width={width-810} height={height-590} fill="#ded8ca" stroke="#8d8171" strokeWidth="3"/>
      <text x="783" y="578" className="mv3-roomlabel">PAINEL DE MERCADO</text><g role="button" tabIndex={0} onClick={onMarket} onKeyDown={e=>{if(e.key==="Enter")onMarket();}} style={{cursor:"pointer"}}><rect x="784" y="590" width={width-855} height="89" rx="4" fill="#303b35"/>{market?.assets.slice(0,3).map((q,i)=><text key={q.symbol} x="798" y={613+i*23} fill="#d4dfd6" fontSize="14">{q.symbol}   {money(q.last)}   {pct(q.change_pct)}</text>)}</g>
      {[[34,270],[744,270],[width-35,270],[750,height-45]].map(([x,y],i)=><g key={i}><circle cx={x} cy={y} r="15" fill="#827260"/><circle cx={x} cy={y-7} r="18" fill="#5d7c55"/><circle cx={x-7} cy={y-12} r="9" fill="#789565"/></g>)}
    </svg>
    {agents.map(a=>{const home=slot(a),meet=meetings.find(m=>m.agent_id===a.id&&m.until>Date.now()),delivery=deliveries.find(d=>d.fromAgentId===a.id),target=delivery&&agents.find(v=>v.id===delivery.toAgentId),call=calls.find(c=>c.fromAgentId===a.id&&c.action!=="dismiss"),task=tasks.find(t=>t.id===a.current_task_id);
      const dest=meet?{x:830+(meet.seat_index%4)*65,y:meet.seat_index%8<4?363:491}:call?{x:95+call.seatIndex*24,y:207}:target?{x:slot(target).x+44,y:slot(target).y+40}:{x:home.x,y:home.y+39};
      const state=meet?"Em reunião":call?"Reportando":target?"Colaborando":statusName(a);
      return <button key={a.id} className={"mv3-person "+(a.status==="working"?"mv3-working":"")} style={{left:dest.x/width*100+"%",top:dest.y/height*100+"%"}} onClick={()=>onSelect(a)} title={a.name+" · "+state+(task?" · "+task.title:"")}><img src={"/sprites/"+(sprite.get(a.id)??1)+"-D-1.png"} alt=""/><span>{a.name}</span><small>{state}</small></button>;
    })}
  </div></div><div className="mv3-floorfooter"><span>● Simulação local · sem dinheiro real</span><span>Movimentos de trabalho vinculados às atividades registradas.</span></div></div>;
}
