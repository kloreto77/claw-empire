
import {test} from "node:test";
import assert from "node:assert/strict";
import express from "express";
import supertest from "supertest";
import {DatabaseSync} from "node:sqlite";
import {installDeskConnections,loadDeskExternalTools} from "../server/modules/desk-connections.ts";
test("MCP discovery, per-agent authorization and actual call against a local mock",async()=>{
 const remote=express();remote.use(express.json());let called=0;
 remote.post("/mcp",(req,res)=>{const b=req.body;if(b.method==="notifications/initialized")return res.sendStatus(202);let result:unknown;
 if(b.method==="initialize")result={protocolVersion:"2025-03-26",capabilities:{tools:{}},serverInfo:{name:"mock",version:"1"}};
 else if(b.method==="tools/list")result={tools:[{name:"read_test",inputSchema:{type:"object",properties:{}},annotations:{readOnlyHint:true}},{name:"write_test",inputSchema:{type:"object"},annotations:{readOnlyHint:false}}]};
 else if(b.method==="tools/call"){called++;assert.equal(b.params.name,"read_test");result={content:[{type:"text",text:"resultado"}]};}
 return res.json({jsonrpc:"2.0",id:b.id,result});});
 const server=remote.listen(0,"127.0.0.1");await new Promise<void>(r=>server.once("listening",r));
 const address=server.address();assert.ok(address&&typeof address!=="string");
 const db=new DatabaseSync(":memory:");db.exec("CREATE TABLE agents(id TEXT PRIMARY KEY);INSERT INTO agents VALUES('a'),('b')");
 const app=express();app.use(express.json());installDeskConnections(app,db);const http=supertest(app),base="/api/desk/agents/a/connections";
 try{
 const created=await http.post(base).send({name:"Teste MCP",kind:"mcp",url:"http://127.0.0.1:"+address.port+"/mcp"}).expect(201);
 const id=created.body.id;const tested=await http.post(base+"/"+id+"/test").expect(200);assert.deepEqual(tested.body.tools.map((t:{name:string})=>t.name),["read_test"]);
 await http.put(base+"/"+id).send({enabled:true,allowed:["read_test","write_test"]}).expect(200);
 const signal=new AbortController().signal;const tools=await loadDeskExternalTools(db,"a",signal);assert.equal(tools.length,1);assert.deepEqual(await loadDeskExternalTools(db,"b",signal),[]);
 const result=await tools[0].call({},signal);assert.match(JSON.stringify(result),/resultado/);assert.equal(called,1);
 await http.put(base+"/"+id).send({enabled:false,allowed:[]}).expect(200);await assert.rejects(tools[0].call({},signal),/revogada/);
 }finally{db.close();await new Promise<void>(r=>server.close(()=>r()));}
});
