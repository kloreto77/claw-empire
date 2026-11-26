import type {DatabaseSync} from "node:sqlite";
export const CAPITAL=10_000_000;
export const DAILY=200_000;
export const QTY_SCALE=100_000_000;
const operator="axiom-01";
const dayFmt=new Intl.DateTimeFormat("en-CA",{timeZone:"America/Sao_Paulo",year:"numeric",month:"2-digit",day:"2-digit"});
export function localDay(ts:number){if(!Number.isSafeInteger(ts)||ts<0)throw Error("timestamp inválido");return dayFmt.format(new Date(ts));}
function positive(n:number){if(!Number.isSafeInteger(n)||n<=0)throw Error("valor inválido");return n;}
function key(s:string){if(!/^[a-zA-Z0-9:_-]{1,100}$/.test(s))throw Error("identificador inválido");return s;}
type Reservation={id:string;day:string;symbol:string;amount:number;used:number;state:string};
type Position={symbol:string;qty:number;basis:number};
type Fill={id:string;reservation:string|null;side:string;symbol:string;qty:number;amount:number;fee:number;day:string;realized:number};
export class AxiomLedger {
 constructor(private db:DatabaseSync){
  db.exec(`CREATE TABLE IF NOT EXISTS axiom_ledger_account(id TEXT PRIMARY KEY,cash INTEGER NOT NULL CHECK(cash>=0),day TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS axiom_ledger_reservations(id TEXT PRIMARY KEY,day TEXT NOT NULL,symbol TEXT NOT NULL,amount INTEGER NOT NULL CHECK(amount>0),used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0 AND used<=amount),state TEXT NOT NULL CHECK(state IN ('open','closed','expired')));
  CREATE TABLE IF NOT EXISTS axiom_ledger_positions(symbol TEXT PRIMARY KEY,qty INTEGER NOT NULL CHECK(qty>=0),basis INTEGER NOT NULL CHECK(basis>=0));
  CREATE TABLE IF NOT EXISTS axiom_ledger_fills(id TEXT PRIMARY KEY,reservation TEXT,side TEXT NOT NULL CHECK(side IN ('buy','sell')),symbol TEXT NOT NULL,qty INTEGER NOT NULL CHECK(qty>0),amount INTEGER NOT NULL CHECK(amount>0),fee INTEGER NOT NULL CHECK(fee>=0),day TEXT NOT NULL,realized INTEGER NOT NULL);`);
 }
 private transaction<T>(fn:()=>T):T{this.db.exec("BEGIN IMMEDIATE");try{const r=fn();this.db.exec("COMMIT");return r;}catch(e){this.db.exec("ROLLBACK");throw e;}}
 private roll(ts:number){
  const day=localDay(ts);
  this.db.prepare("INSERT OR IGNORE INTO axiom_ledger_account VALUES(?,?,?)").run(operator,CAPITAL,day);
  const a=this.db.prepare("SELECT * FROM axiom_ledger_account WHERE id=?").get(operator) as {cash:number;day:string};
  if(day<a.day)throw Error("relógio retrocedeu; reconciliar");
  if(day>a.day){this.db.prepare("UPDATE axiom_ledger_reservations SET state='expired' WHERE state='open'").run();this.db.prepare("UPDATE axiom_ledger_account SET day=? WHERE id=?").run(day,operator);}
  return {day,cash:a.cash};
 }
 private state(ts:number){
  const a=this.roll(ts);
  const spent=(this.db.prepare("SELECT COALESCE(SUM(amount+fee),0) n FROM axiom_ledger_fills WHERE day=? AND side='buy'").get(a.day) as {n:number}).n;
  const reserved=(this.db.prepare("SELECT COALESCE(SUM(amount-used),0) n FROM axiom_ledger_reservations WHERE day=? AND state='open'").get(a.day) as {n:number}).n;
  return {...a,spent,reserved,remaining:DAILY-spent-reserved,availableCash:a.cash-reserved,positions:this.db.prepare("SELECT symbol,qty,basis FROM axiom_ledger_positions WHERE qty>0 ORDER BY symbol").all() as unknown as Position[]};
 }
 status(ts:number){return this.transaction(()=>this.state(ts));}
 reserve(id:string,symbol:string,amount:number,ts:number){
  key(id);key(symbol);positive(amount);
  return this.transaction(()=>{const s=this.state(ts);const old=this.db.prepare("SELECT * FROM axiom_ledger_reservations WHERE id=?").get(id) as Reservation|undefined;
   if(old){if(old.symbol!==symbol||old.amount!==amount||old.day!==s.day)throw Error("reserva conflitante");return old;}
   if(amount>s.remaining||amount>s.availableCash)throw Error("orçamento ou caixa insuficiente");
   this.db.prepare("INSERT INTO axiom_ledger_reservations VALUES(?,?,?,?,0,'open')").run(id,s.day,symbol,amount);
   return this.db.prepare("SELECT * FROM axiom_ledger_reservations WHERE id=?").get(id);
  });
 }
 release(id:string,ts:number){return this.transaction(()=>{this.state(ts);const r=this.db.prepare("SELECT * FROM axiom_ledger_reservations WHERE id=?").get(key(id));if(!r)throw Error("reserva inexistente");this.db.prepare("UPDATE axiom_ledger_reservations SET state='closed' WHERE id=? AND state='open'").run(id);return this.state(ts);});}
 fill(input:{id:string;reservation?:string;side:"buy"|"sell";symbol:string;qty:number;amount:number;fee:number},ts:number){
  const {id,side,symbol,qty,amount,fee}=input;key(id);key(symbol);positive(qty);positive(amount);if(!Number.isSafeInteger(fee)||fee<0||!Number.isSafeInteger(amount+fee)||(side!=="buy"&&side!=="sell"))throw Error("fill inválido");
  return this.transaction(()=>{
   const s=this.state(ts),rId=input.reservation??null;
   const old=this.db.prepare("SELECT * FROM axiom_ledger_fills WHERE id=?").get(id) as Fill|undefined;
   if(old){if(old.reservation!==rId||old.side!==side||old.symbol!==symbol||old.qty!==qty||old.amount!==amount||old.fee!==fee)throw Error("fill conflitante");return old;}
   const p=s.positions.find(v=>v.symbol===symbol)??{symbol,qty:0,basis:0};
   let cash=s.cash,nextQty=p.qty,nextBasis=p.basis,realized=0;
   if(side==="buy"){
    if(!rId)throw Error("reserva obrigatória");const r=this.db.prepare("SELECT * FROM axiom_ledger_reservations WHERE id=?").get(key(rId)) as Reservation|undefined;
    const debit=amount+fee;if(!r||r.state!=="open"||r.day!==s.day||r.symbol!==symbol||debit>r.amount-r.used||debit>cash)throw Error("reserva insuficiente ou vencida");
    cash-=debit;nextQty+=qty;nextBasis+=debit;
    this.db.prepare("UPDATE axiom_ledger_reservations SET used=used+?,state=CASE WHEN used+?=amount THEN 'closed' ELSE state END WHERE id=?").run(debit,debit,rId);
   }else{
    if(rId||qty>p.qty||fee>amount)throw Error("venda sem posição ou inválida");
    const basis=Number(BigInt(p.basis)*BigInt(qty)/BigInt(p.qty));nextQty-=qty;nextBasis-=basis;cash+=amount-fee;realized=amount-fee-basis;
   }
   if(![cash,nextQty,nextBasis,realized].every(Number.isSafeInteger)||cash<0||nextQty<0||nextBasis<0)throw Error("overflow contábil");
   this.db.prepare("UPDATE axiom_ledger_account SET cash=? WHERE id=?").run(cash,operator);
   this.db.prepare("INSERT INTO axiom_ledger_positions VALUES(?,?,?) ON CONFLICT(symbol) DO UPDATE SET qty=excluded.qty,basis=excluded.basis").run(symbol,nextQty,nextBasis);
   this.db.prepare("INSERT INTO axiom_ledger_fills VALUES(?,?,?,?,?,?,?,?,?)").run(id,rId,side,symbol,qty,amount,fee,s.day,realized);
   return this.db.prepare("SELECT * FROM axiom_ledger_fills WHERE id=?").get(id) as Fill;
  });
 }
}
