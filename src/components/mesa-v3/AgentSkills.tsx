
import { useEffect,useState } from "react";
import { request,post,put,del } from "../../api/core";
type Skill={id:string;name:string;content:string};
export default function AgentSkills({id,onLibrary}:{id:string;onLibrary:()=>void}){
  const url="/api/desk/agents/"+encodeURIComponent(id)+"/skills";
  const [skills,setSkills]=useState<Skill[]>([]),[name,setName]=useState(""),[content,setContent]=useState(""),[editing,setEditing]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const refresh=async()=>setSkills((await request<{skills:Skill[]}>(url)).skills);
  useEffect(()=>{void refresh().catch(()=>setError("Não foi possível carregar as skills."));},[url]);
  async function perform(fn:()=>Promise<unknown>){setBusy(true);setError("");try{await fn();await refresh();setName("");setContent("");setEditing(null);}catch(e){setError(e instanceof Error?e.message:"Operação não confirmada.");}finally{setBusy(false);}}
  return <section><h3>Skills individuais</h3><p>Importe um arquivo Markdown ou escreva uma habilidade. O conteúdo entra nas instruções das tarefas e conversas deste agente. Não instala executáveis.</p>
  {skills.map(s=><div className="mv3-task" key={s.id}><strong>{s.name}</strong><p>{s.content.slice(0,100)}{s.content.length>100?"…":""}</p><div className="mv3-row"><button onClick={()=>{setEditing(s.id);setName(s.name);setContent(s.content);}}>Editar</button><button disabled={busy} onClick={()=>{if(window.confirm("Remover esta habilidade deste agente?"))void perform(()=>del(url+"/"+s.id));}}>Remover</button></div></div>)}
  <label>Nome da habilidade<input disabled={!!editing} value={name} maxLength={80} onChange={e=>setName(e.target.value)}/></label><label>Importar SKILL.md<input type="file" accept=".md,.txt,text/plain,text/markdown" onChange={async e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>24000){setError("Arquivo grande demais.");return;}const txt=await f.text();if(txt.length>6000){setError("Limite de 6.000 caracteres.");return;}setContent(txt);if(!name)setName(f.name.replace(/\.[^.]+$/,"").slice(0,80));}}/></label><label>Instruções da habilidade<textarea rows={9} maxLength={6000} value={content} onChange={e=>setContent(e.target.value)}/></label><button disabled={busy||!name.trim()||!content.trim()} onClick={()=>void perform(()=>editing?put(url+"/"+editing,{content}):post(url,{name,content}))}>{editing?"Salvar alterações":"Adicionar skill ao agente"}</button>{editing&&<button onClick={()=>{setEditing(null);setName("");setContent("");}}>Cancelar</button>}
  {error&&<p role="alert">{error}</p>}<hr/><p>Ferramentas instaláveis compartilhadas pelo provedor ficam na biblioteca avançada.</p><button onClick={onLibrary}>Biblioteca de skills</button></section>;
}
