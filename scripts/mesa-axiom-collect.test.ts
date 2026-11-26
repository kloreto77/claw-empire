import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {mkdtempSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import express from "express";
import supertest from "supertest";
import {makeBook,applyDepth,features,universe,installAxiom} from "../server/modules/desk-axiom.ts";
import {installDeskMarket} from "../server/modules/desk-market.ts";
const snapshot={lastUpdateId:100,bids:[["99.99","2"],["99.40","1"]],asks:[["100.01","3"],["100.60","1"]]} as Parameters<typeof makeBook>[0];
test("sequência L2: ponte, duplicata, remoção e gap",()=>{
 const b=makeBook(snapshot);
 assert.equal(applyDepth(b,{U:100,u:102,E:1000,b:[["99.99","0"],["99.98","5"]],a:[]},1000),true);
 assert.equal(b.bid.has(99.99),false);assert.equal(b.bid.get(99.98),5);
 assert.equal(applyDepth(b,{U:101,u:102,E:1000,b:[],a:[]},1000),false);
 assert.throws(()=>applyDepth(b,{U:104,u:105,E:1001,b:[],a:[]},1001),/MARKET_GAP/);
 assert.throws(()=>applyDepth(b,{U:103,u:103,E:9000,b:[],a:[]},1001),/relógio/);
});
test("features rejeitam livros vencidos, cruzados ou sem cobertura das bandas",()=>{
 const b=makeBook(snapshot);assert.equal(features(b,1000),null);
 applyDepth(b,{U:101,u:101,E:1000,b:[],a:[]},1000);
 const f=features(b,1000);assert.ok(f);assert.ok(Math.abs(f.mid-100)<1e-8);assert.ok(f.spread_bps>0);assert.equal(f.bids[0],199.98);
 assert.equal(features(b,4001),null);
 applyDepth(b,{U:102,u:102,E:2000,b:[["101","3"]],a:[]},2000);assert.equal(features(b,2000),null);
 const shallow=makeBook({lastUpdateId:1,bids:[["99.99","1"]],asks:[["100.01","1"]]});applyDepth(shallow,{U:2,u:2,E:2000,b:[],a:[]},2000);assert.equal(features(shallow,2000),null);
});
test("universo provisório inclui BTC/ETH elegíveis e exclui stablecoin/alavancados",()=>{
 const info=["BTC","ETH","SOL","USDC","BTCUP","XYZ"].map(baseAsset=>({symbol:baseAsset+"USDT",status:baseAsset==="XYZ"?"BREAK":"TRADING",baseAsset,quoteAsset:"USDT",isSpotTradingAllowed:true}));
 assert.deepEqual(universe(info,info.map(s=>({symbol:s.symbol,quoteVolume:"1000"}))),["BTCUSDT","ETHUSDT","SOLUSDT"]);
});
test("AXIOM não nasce ativo e não pode usar a carteira de preços sintéticos",async()=>{
 const db=new DatabaseSync(":memory:");
 const dir=mkdtempSync(join(tmpdir(),"mesa-axiom-"));
 db.exec("CREATE TABLE agents(id TEXT PRIMARY KEY,name TEXT,role TEXT); INSERT INTO agents VALUES('axiom-01','AXIOM','junior');");
 const app=express();app.use(express.json());installDeskMarket(app,db);installAxiom(app,db,dir);const http=supertest(app);
 try{
  const s=await http.get("/api/desk/axiom/status").expect(200);
  assert.equal(s.body.installed,true);assert.equal(s.body.desired,false);assert.equal(s.body.stage,"STOPPED");assert.equal(s.body.paper_enabled,false);
  await http.put("/api/desk/market/agents/axiom-01/permission").send({enabled:true}).expect(403);
  await http.post("/api/desk/market/agents/axiom-01/orders").send({symbol:"BTC",side:"buy",quantity:1,order_id:"axiom-test-001"}).expect(403);
  await http.post("/api/desk/axiom/stop").send({}).expect(200);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
