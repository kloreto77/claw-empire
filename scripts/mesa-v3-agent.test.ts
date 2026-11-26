
import {test} from "node:test";
import assert from "node:assert/strict";
import express from "express";
import supertest from "supertest";
import {DatabaseSync} from "node:sqlite";
import {installDeskAgentSkills,buildDeskAgentSkills} from "../server/modules/desk-agent-skills.ts";
import {runDeskMarketAgent} from "../server/modules/desk-market-agent.ts";
test("skills belong to the selected agent and enter only that agent's prompt",async()=>{
  const db=new DatabaseSync(":memory:");db.exec("CREATE TABLE agents(id TEXT PRIMARY KEY); INSERT INTO agents VALUES('a'),('b');");
  const app=express();app.use(express.json());installDeskAgentSkills(app,db);const http=supertest(app);
  try{
    const url="/api/desk/agents/";
    const result=await http.post(url+"a/skills").send({name:"Análise",content:"Leia as velas."}).expect(201);
    assert.match(buildDeskAgentSkills(db,"a"),/Leia as velas/);assert.equal(buildDeskAgentSkills(db,"b"),"");
    await http.put(url+"b/skills/"+result.body.id).send({content:"Não autorizado"}).expect(404);
    await http.put(url+"a/skills/"+result.body.id).send({content:"Avalie o risco."}).expect(200);
    assert.match(buildDeskAgentSkills(db,"a"),/Avalie o risco/);
    await http.delete(url+"a/skills/"+result.body.id).expect(200);assert.equal(buildDeskAgentSkills(db,"a"),"");
  }finally{db.close();}
});
test("market tool loop uses task owner's wallet, deterministic id and returns tool result",async()=>{
  const calls:{url:string;body:Record<string,unknown>|null}[]=[];let remote=0;const usage:Record<string,number>={};
  const mock:typeof fetch=async(input,init)=>{
    const url=String(input),body=init?.body?JSON.parse(String(init.body)):null;calls.push({url,body});
    if(url==="https://model.invalid/chat"){
      remote++;
      return Response.json(remote===1?{choices:[{message:{role:"assistant",content:null,tool_calls:[{id:"call-1",type:"function",function:{name:"ordem_simulada",arguments:JSON.stringify({symbol:"AUR",side:"buy",quantity:1,agent_id:"other"})}}]}}],usage:{total_tokens:12}}:{choices:[{message:{role:"assistant",content:"Ordem confirmada."}}],usage:{total_tokens:8}});
    }
    return Response.json({simulated:true,trade:{id:"test"}},{status:201});
  };
  const out:string[]=[];
  await runDeskMarketAgent({request:{url:"https://model.invalid/chat",headers:{},body:JSON.stringify({model:"mock",messages:[{role:"user",content:"Teste"}]})},agentId:"owner",taskId:"task-1",signal:new AbortController().signal,stillAllowed:()=>true,write:s=>out.push(s),usage,fetcher:mock});
  assert.equal(calls.length,3);assert.match(calls[1].url,/\/agents\/owner\/orders$/);
  assert.equal(calls[1].body?.task_id,"task-1");assert.equal(calls[1].body?.quantity,1);assert.equal(calls[1].body?.agent_id,undefined);
  assert.match(String(calls[1].body?.order_id),/^[a-f0-9]{64}$/);
  assert.equal(usage.total_tokens,20);assert.ok(out.some(s=>s.includes("Ordem confirmada.")));
});
test("revoked permission stops before provider call",async()=>{
  let called=false;
  await assert.rejects(runDeskMarketAgent({request:{url:"https://model.invalid/chat",headers:{},body:'{"messages":[]}'},agentId:"a",taskId:"t",signal:new AbortController().signal,stillAllowed:()=>false,write:()=>{},usage:{},fetcher:async()=>{called=true;return Response.json({});}}),/revogada/);
  assert.equal(called,false);
});
