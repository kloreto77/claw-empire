import {test} from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {AxiomLedger,localDay} from "../server/modules/axiom-ledger.ts";
test("orçamento diário cumulativo incluindo taxas, vendas não restauram, rollover local e idempotência",()=>{
 const db=new DatabaseSync(":memory:");try{
 const l=new AxiomLedger(db),t=Date.parse("2026-11-26T23:59:00-03:00"),next=t+60000;
 assert.notEqual(localDay(t),localDay(next));
 for(const [i,n] of [50000,80000,70000].entries()){l.reserve("r"+i,"BTCUSDT",n,t);const f={id:"f"+i,reservation:"r"+i,side:"buy" as const,symbol:"BTCUSDT",qty:1000,amount:n-50,fee:50};l.fill(f,t);l.fill(f,t);}
 assert.equal(l.status(t).remaining,0);assert.equal(l.status(t).cash,9800000);
 assert.throws(()=>l.reserve("extra","BTCUSDT",1,t),/orçamento/);
 l.fill({id:"sale",side:"sell",symbol:"BTCUSDT",qty:1000,amount:120000,fee:120},t);
 assert.equal(l.status(t).remaining,0);assert.throws(()=>l.fill({id:"oversell",side:"sell",symbol:"BTCUSDT",qty:2001,amount:1,fee:0},t),/posição/);
 assert.equal(l.status(next).remaining,200000);assert.equal(l.status(next).positions[0].qty,2000);
 assert.throws(()=>l.status(t),/relógio/);
 }finally{db.close();}
});
test("reserva parcial, cancelamento, bloqueio de fill vencido e persistência entre instâncias",()=>{
 const db=new DatabaseSync(":memory:");try{
 const l=new AxiomLedger(db),t=Date.parse("2026-11-26T23:59:00-03:00");
 l.reserve("a","ETHUSDT",150000,t);assert.throws(()=>l.reserve("b","ETHUSDT",50001,t),/orçamento/);
 l.fill({id:"part",reservation:"a",side:"buy",symbol:"ETHUSDT",qty:1,amount:49950,fee:50},t);
 l.release("a",t);assert.equal(l.status(t).remaining,150000);
 l.reserve("b","ETHUSDT",150000,t);
 const recovered=new AxiomLedger(db);assert.equal(recovered.status(t).reserved,150000);
 recovered.status(t+60000);
 assert.throws(()=>recovered.fill({id:"late",reservation:"b",side:"buy",symbol:"ETHUSDT",qty:1,amount:100,fee:1},t+60000),/vencida/);
 assert.equal(recovered.status(t+60000).remaining,200000);
 }finally{db.close();}
});
