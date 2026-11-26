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

test("liquidação oficial IOC reverte conflitos e encerra o residual no mesmo commit",()=>{
 const db=new DatabaseSync(":memory:");
 try{
  const t=Date.parse("2026-11-26T20:00:00-03:00");
  const ledger=new AxiomLedger(db);
  const part = {
   id:"b1",fingerprint:"decision1",symbol:"BTCUSDT",sequence:100,runId:"run1",fxSnapshotId:"fx1",
   side:"buy",reservation:90000,qty:30,amount:79000,fee:1000,result:"PARTIAL_CANCELLED",reason:"IOC",averagePrice:"9800",
  } as const;
  ledger.settleIoc(part,t);
  assert.deepEqual(ledger.status(t).positions.map(p=>({...p})),[{symbol:"BTCUSDT",qty:30,basis:80000}]);
  assert.equal(ledger.status(t).reserved,0);
  assert.equal(ledger.status(t).remaining,120000);
  const reopened=new AxiomLedger(db);
  assert.equal(reopened.iocReceipt(part.id, part.fingerprint)?.fill?.qty,30);
  assert.equal(reopened.settleIoc(part,t+1).ts,t);
  assert.throws(()=>reopened.settleIoc({...part,fingerprint:"modificado"},t+1),/conflitante/);
  assert.throws(()=>reopened.settleIoc({...part,id:"b2",runId:"reconnect"},t+1),/consumido/);
  assert.throws(()=>reopened.settleIoc({...part,id:"b2",sequence:99},t+1),/retrocedeu/);
  assert.throws(()=>reopened.settleIoc({...part,id:"b3",sequence:101,reservation:100},t+1),/insuficiente/);
  assert.equal(reopened.status(t).reserved,0);
  assert.equal(reopened.status(t).remaining,120000);
  const exit=reopened.settleIoc({...part,id:"s1",side:"sell",reservation:0,qty:30,result:"FILLED",amount:81000},t+1);
  assert.equal(exit.fill?.realized,0);
  assert.equal(reopened.status(t).remaining,120000);
  assert.equal(reopened.status(t).cash,10000000);
 }finally{db.close();}
});

test("a Mesa só executa IOC de entrada com gates e aprovação, e mantém saídas durante pausa", async () => {
 const {createAxiomPaperExecution}=await import("../server/modules/axiom-paper.ts");
 const db=new DatabaseSync(":memory:");
 try{
  let now=Date.parse("2026-11-26T20:00:00-03:00"),approved=false,gates=false,calls=0;
  const ledger=new AxiomLedger(db);
  const market={run_id:"run",book:{symbol:"BTCUSDT",seq:100,event_ms:now,receive_ms:now,bids:[],asks:[]},
    fx:{bid:"5.10",ask:"5.11",snapshot_id:"fx1",receive_ms:now},
    rules:{qty_step:"0.001",min_qty:"0.001",min_notional:"5.00",max_qty:"10.000"}};
  const intent={id:"buy1",symbol:"BTCUSDT",side:"buy",quantity:"0.002",decision_ms:now-500,
    expiry_ms:now+4000,reserveCents:10500,strategyVersion:"v1",modelVersion:"m1",paperOnly:true} as const;
  const unopened=createAxiomPaperExecution(ledger);
  await assert.rejects(unopened.execute(intent,market),/sem autorização/);
  const runner=createAxiomPaperExecution(ledger,{approved:()=>approved,checkEntry:()=>gates},async request=>{
    calls++;
    return {id:request.intent.id,status:"FILLED",reason:"IOC",qty:request.intent.quantity,
      fee_brl:"0.10",gross_brl:"100.00",sequence:request.book.seq,fx_snapshot_id:request.fx.snapshot_id,average_price:"9800"};
  },()=>now);
  await assert.rejects(runner.execute(intent,market),/vetada/);
  runner.resume();
  await assert.rejects(runner.execute(intent,market),/vetada/);
  approved=true;
  await assert.rejects(runner.execute(intent,market),/vetada/);
  assert.equal(calls,0);
  gates=true;
  assert.equal((await runner.execute(intent,market)).fill?.qty,200000);
  const receipt=await runner.execute(intent,market);
  assert.equal(receipt.fill?.qty,200000);
  assert.equal(calls,1);
  runner.pause();
  await assert.rejects(runner.execute({...intent,id:"buy2"},market),/vetada/);
  approved=false;
  assert.equal((await runner.execute({...intent,id:"s1",side:"sell",reserveCents:0},market)).fill?.side,"sell");
  assert.equal(ledger.status(now).positions.length,0);
  assert.equal(ledger.status(now).remaining,189990);
  now+=8000;
  await assert.rejects(runner.execute({...intent,id:"buy3"},market),/vencido/);
 }finally{db.close();}
});

test("pausar durante o match impede liquidação e libera o ciclo sem débito", async () => {
 const {createAxiomPaperExecution}=await import("../server/modules/axiom-paper.ts");
 const db=new DatabaseSync(":memory:");
 try{
  const now=Date.parse("2026-11-26T20:00:00-03:00");
  const ledger=new AxiomLedger(db);
  const market={run_id:"run",book:{symbol:"BTCUSDT",seq:100,event_ms:now,receive_ms:now,bids:[],asks:[]},
    fx:{bid:"5.10",ask:"5.11",snapshot_id:"fx1",receive_ms:now},
    rules:{qty_step:"0.001",min_qty:"0.001",min_notional:"5.00",max_qty:"10.000"}};
  const intent={id:"buy1",symbol:"BTCUSDT",side:"buy",quantity:"0.002",decision_ms:now-500,
    expiry_ms:now+4000,reserveCents:10500,strategyVersion:"v1",modelVersion:"m1",paperOnly:true} as const;
  const result={id:intent.id,status:"FILLED",reason:"IOC",qty:intent.quantity,
    fee_brl:"0.10",gross_brl:"100.00",sequence:market.book.seq,
    fx_snapshot_id:market.fx.snapshot_id,average_price:"9800"} as const;
  let finish!: (value: typeof result) => void;
  const reply=new Promise<typeof result>(resolve=>{finish=resolve;});
  const runner=createAxiomPaperExecution(ledger,{approved:()=>true,checkEntry:()=>true},()=>reply,()=>now);
  runner.resume();
  const execution=runner.execute(intent,market);
  await assert.rejects(runner.execute({...intent,id:"buy2"},market),/ocupado/);
  runner.pause();
  runner.resume();
  finish(result);
  await assert.rejects(execution,/vetada/);
  assert.equal(runner.status().cash,10000000);
  assert.equal(runner.status().reserved,0);
  assert.equal(runner.status().execution.busy,false);
 }finally{db.close();}
});
