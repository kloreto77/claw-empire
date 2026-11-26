import {test} from "node:test";
import assert from "node:assert/strict";
import {MinuteFeatures,groupedW1,robustZ,AdaptiveConformal,type Sample} from "../server/modules/axiom-features.ts";
const sample:Sample={mid:100,spread_bps:2,bids:[10,0,0,0],asks:[0,10,0,0],imbalance:0,entropy_bid:0,entropy_ask:0,flow:1};
test("W1 por bandas normaliza massa, distância em bps, rejeita ausência de massa",()=>{
 assert.equal(groupedW1([10,0,0,0],[0,0,0,10]),35);
 assert.equal(groupedW1([10,0,0,0],[20,0,0,0]),0);
 assert.equal(groupedW1([0,0,0,0],[1,0,0,0]),null);
 assert.equal(robustZ(2,Array(1440).fill(1)),null);
 assert.equal(robustZ(2,Array(1440).fill(1),.5),2);
});
test("agregação causal de 60 segundos e W1 em janelas disjuntas 5/60",()=>{
 const m=new MinuteFeatures();let output=null;
 for(let t=0;t<=65*60;t++){
  const s=t>=60*60?{...sample,bids:[0,0,0,20]}:sample;
  const r=m.push("BTCUSDT",t*1000,s);if(r)output=r;
 }
 assert.ok(output);assert.equal(output.minute.end,65*60000);
 assert.equal(output.minute.flow,60);assert.equal(output.minute.logReturn,0);
 assert.equal(output.liquidity?.w1Bid,35);assert.equal(output.liquidity?.massBid,20);
 assert.equal(output.liquidity?.referenceMassBid,10);
 m.reset();for(let t=1;t<=60;t++)assert.equal(m.push("BTCUSDT",t*1000,sample),null);
});
test("CQR exige 200 scores maduros, quantil conservador e atualização adaptativa causal",()=>{
 const c=new AdaptiveConformal();
 assert.equal(c.issue("early",0,5,0,1),null);
 for(let i=0;i<200;i++)c.calibrate(0,1,1.5,i,i);
 assert.throws(()=>c.issue("past",100,500,0,1),/inválida/);
 const p=c.issue("p",200,300,0,1);assert.ok(p);assert.equal(p.expandedLow,-.5);assert.equal(p.expandedHigh,1.5);
 assert.throws(()=>c.mature("p",2,299),/futuro/);
 const s=c.mature("p",2,300);assert.ok(Math.abs(s.alpha-.0955)<1e-10);assert.equal(s.coverage,0);assert.equal(s.coverageVeto,true);
 assert.throws(()=>c.mature("p",2,300),/ausente/);
 assert.throws(()=>c.calibrate(0,1,0,400,399),/causal/);
});
