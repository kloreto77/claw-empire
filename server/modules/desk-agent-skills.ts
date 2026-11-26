
import type { Express } from "express";
import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
type Skill = {id:string;name:string;content:string};
export function buildDeskAgentSkills(db:DatabaseSync, id:string):string {
  // Older tests or isolated runtimes may not yet have the V3 table.
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='desk_agent_skills'").get()) return "";
  const rows=db.prepare("SELECT id,name,content FROM desk_agent_skills WHERE agent_id=? ORDER BY name").all(id) as unknown as Skill[];
  return rows.length? "[Habilidades específicas deste agente — instruções do operador]\n"+rows.map(s=>"### "+s.name+"\n"+s.content).join("\n\n"):"";
}
export function installDeskAgentSkills(app:Express,db:DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS desk_agent_skills(id TEXT PRIMARY KEY,agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,name TEXT NOT NULL,content TEXT NOT NULL,UNIQUE(agent_id,name));`);
  const exists=(id:string)=>Boolean(db.prepare("SELECT 1 FROM agents WHERE id=?").get(id));
  app.get("/api/desk/agents/:id/skills",(req,res)=>{
    const id=String(req.params.id);if(!exists(id))return res.status(404).json({error:"Agente não encontrado"});
    return res.json({skills:db.prepare("SELECT id,name,content FROM desk_agent_skills WHERE agent_id=? ORDER BY name").all(id)});
  });
  app.post("/api/desk/agents/:id/skills",(req,res)=>{
    const id=String(req.params.id);if(!exists(id))return res.status(404).json({error:"Agente não encontrado"});
    const name=typeof req.body?.name==="string"?req.body.name.trim():"",content=typeof req.body?.content==="string"?req.body.content.trim():"";
    if(!name||name.length>80||!content||content.length>6000)return res.status(400).json({error:"Informe um nome e até 6.000 caracteres de instruções"});
    if(db.prepare("SELECT 1 FROM desk_agent_skills WHERE agent_id=? AND name=?").get(id,name))return res.status(409).json({error:"Já existe uma skill com este nome"});
    const count=db.prepare("SELECT COUNT(*) AS n FROM desk_agent_skills WHERE agent_id=?").get(id) as {n:number};
    if(count.n>=8)return res.status(409).json({error:"Limite de oito skills individuais por agente"});
    const key=randomUUID();db.prepare("INSERT INTO desk_agent_skills VALUES(?,?,?,?)").run(key,id,name,content);
    return res.status(201).json({id:key});
  });
  app.put("/api/desk/agents/:id/skills/:skill",(req,res)=>{
    const id=String(req.params.id),key=String(req.params.skill),content=typeof req.body?.content==="string"?req.body.content.trim():"";
    if(!content||content.length>6000)return res.status(400).json({error:"Informe até 6.000 caracteres de instruções"});
    const result=db.prepare("UPDATE desk_agent_skills SET content=? WHERE agent_id=? AND id=?").run(content,id,key);
    return result.changes?res.json({ok:true}):res.status(404).json({error:"Skill não encontrada"});
  });
  app.delete("/api/desk/agents/:id/skills/:skill",(req,res)=>{
    const result=db.prepare("DELETE FROM desk_agent_skills WHERE agent_id=? AND id=?").run(String(req.params.id),String(req.params.skill));
    return result.changes?res.json({ok:true}):res.status(404).json({error:"Skill não encontrada"});
  });
}
