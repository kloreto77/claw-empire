
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import express from "express";
import supertest from "supertest";
import { installDeskMarket, quote, INITIAL_CENTS } from "../server/modules/desk-market.ts";

test("simulated exchange: isolated wallets, permission, idempotency, funds and position checks", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON; CREATE TABLE agents(id TEXT PRIMARY KEY,name TEXT,role TEXT); INSERT INTO agents VALUES('a','Operador A','junior'),('b','Operador B','junior');");
  const app=express();app.use(express.json());installDeskMarket(app,db);
  const http=supertest(app), base="/api/desk/market/agents/";
  try {
    const initial=await http.get("/api/desk/market").expect(200);
    assert.equal(initial.body.simulated,true);
    assert.equal(initial.body.assets.length,6);
    assert.ok(initial.body.total_assets>400);
    const catalog=await http.get("/api/desk/market/catalog").expect(200);
    assert.equal(catalog.body.assets.length,initial.body.total_assets);
    assert.ok(catalog.body.assets.some((a:{symbol:string})=>a.symbol==="BTC"));
    const filtered=await http.get("/api/desk/market/quotes?category=Criptomoedas&limit=5").expect(200);
    assert.equal(filtered.body.assets.length,5);assert.ok(filtered.body.total>50);
    const btc=await http.get("/api/desk/market/quote/BTC").expect(200);assert.equal(btc.body.candles.length,36);
    await http.get("/api/desk/market/quote/INVALID").expect(404);
    assert.equal(initial.body.accounts.length,2);
    assert.ok(initial.body.accounts.every((a:{cash:number;enabled:boolean})=>a.cash===INITIAL_CENTS&&!a.enabled));
    const buy={symbol:"AUR",side:"buy",quantity:2,order_id:"test-buy-001"};
    await http.post(base+"a/orders").send(buy).expect(403);
    await http.put(base+"a/permission").send({enabled:true}).expect(200);
    const trade=await http.post(base+"a/orders").send(buy).expect(201);
    assert.equal(trade.body.account.cash,INITIAL_CENTS-trade.body.trade.price*2-trade.body.trade.fee);
    await http.post(base+"a/orders").send(buy).expect(200);
    await http.post(base+"a/orders").send({...buy,quantity:3}).expect(409);
    const after=await http.get(base+"a").expect(200);
    assert.equal(after.body.history.length,1);assert.equal(after.body.positions[0].quantity,2);
    const b=await http.get(base+"b").expect(200);assert.equal(b.body.cash,INITIAL_CENTS);assert.equal(b.body.history.length,0);
    await http.post(base+"a/orders").send({symbol:"AUR",side:"sell",quantity:3,order_id:"test-sell-001"}).expect(409);
    await http.post(base+"a/orders").send({symbol:"AUR",side:"sell",quantity:2,order_id:"test-sell-002"}).expect(201);
    const closed=await http.get(base+"a").expect(200);assert.equal(closed.body.positions.length,0);assert.equal(closed.body.history.length,2);
    await http.put(base+"a/permission").send({enabled:false}).expect(200);
    await http.post(base+"a/orders").send({...buy,order_id:"test-buy-002"}).expect(403);
    assert.deepEqual(quote("AUR",123),quote("AUR",123));
    assert.ok(quote("AUR",123).ask>quote("AUR",123).bid);
  } finally {db.close();}
});

test("eight concurrent simulated operators can trade any registered asset independently",async()=>{
 const db=new DatabaseSync(":memory:");db.exec("CREATE TABLE agents(id TEXT PRIMARY KEY,name TEXT,role TEXT)");
 const ids=Array.from({length:8},(_,i)=>"agent-"+i);for(const id of ids)db.prepare("INSERT INTO agents VALUES(?,?,'junior')").run(id,id);
 const app=express();app.use(express.json());installDeskMarket(app,db);const http=supertest(app);
 try{
  await http.post("/api/desk/market/catalog").send({symbol:"CUSTOM-X",name:"Novo ativo",category:"Personalizados",base_cents:10000,volatility:1}).expect(201);
  await http.post("/api/desk/market/catalog").send({symbol:"CUSTOM-X",name:"Duplicado",category:"Personalizados",base_cents:10000,volatility:1}).expect(409);
  await http.get("/api/desk/market/quote/CUSTOM-X").expect(200);
  await Promise.all(ids.map(id=>http.put("/api/desk/market/agents/"+id+"/permission").send({enabled:true}).expect(200)));
  await Promise.all(ids.map(id=>http.post("/api/desk/market/agents/"+id+"/orders").send({symbol:"CUSTOM-X",side:"buy",quantity:1,order_id:"custom-"+id}).expect(201)));
  const market=await http.get("/api/desk/market").expect(200);assert.equal(market.body.accounts.length,8);assert.ok(market.body.accounts.every((a:{trades:number;positions:{symbol:string;quantity:number}[]})=>a.trades===1&&a.positions[0].symbol==="CUSTOM-X"&&a.positions[0].quantity===1));
 }finally{db.close();}
});
