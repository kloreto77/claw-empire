
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
