"""Research-only simulated IOC matching. No real orders or ledger authority.
All amounts use Decimal. A persistent service must integrate this with the
transactional ledger atomically before any simulated operation is enabled.
"""
from dataclasses import dataclass
from decimal import Decimal, ROUND_DOWN, ROUND_UP
from typing import Literal

D=Decimal
CENT=D("0.01")
def dec(v):
    x=D(str(v))
    if not x.is_finite(): raise ValueError("nonfinite decimal")
    return x

def floor_step(x,step):
    return (x/step).to_integral_value(rounding=ROUND_DOWN)*step
def money(x,buy):
    return x.quantize(CENT,rounding=ROUND_UP if buy else ROUND_DOWN)

@dataclass(frozen=True)
class Rules:
    qty_step:Decimal
    min_qty:Decimal
    min_notional:Decimal
    max_qty:Decimal
@dataclass(frozen=True)
class Book:
    symbol:str
    seq:int
    event_ms:int
    receive_ms:int
    bids:tuple
    asks:tuple
@dataclass(frozen=True)
class FX:
    bid:Decimal
    ask:Decimal
    receive_ms:int
    snapshot_id:str
@dataclass(frozen=True)
class Intent:
    id:str
    symbol:str
    side:Literal["buy","sell"]
    quantity:Decimal
    decision_ms:int
    expiry_ms:int
    reservation_brl:Decimal
    held_quantity:Decimal
@dataclass(frozen=True)
class Result:
    id:str
    status:str
    qty:Decimal
    average_price:Decimal|None
    gross_brl:Decimal
    fee_brl:Decimal
    net_brl:Decimal
    reason:str
    sequence:int
    fx_snapshot_id:str

class Matcher:
    def __init__(self,latency_ms=500,fee_bps=10,extra_slippage_bps=0):
        if latency_ms not in (100,500,2000) or fee_bps not in (5,10,20) or extra_slippage_bps not in (0,5,10):
            raise ValueError("invalid scenario")
        self.latency=latency_ms
        self.fee=D(fee_bps)/10000
        self.slip=D(extra_slippage_bps)/10000
        self.last={}
        self.cache={}

    def execute(self,intent:Intent,book:Book,fx:FX,rules:Rules,now_ms:int):
        # Research replay only: inputs must be sourced from immutable recorded snapshots.
        if intent.id in self.cache:
            old,result=self.cache[intent.id]
            if old!=intent: raise ValueError("conflicting intent")
            return result
        if intent.symbol!=book.symbol or intent.side not in ("buy","sell"): raise ValueError("invalid intent")
        if now_ms<intent.decision_ms+self.latency: raise ValueError("simulated latency not elapsed")
        buy=intent.side=="buy"
        def finish(status,reason,qty=D(0),avg=None,gross=D(0),fee=D(0)):
            result=Result(intent.id,status,qty,avg,gross,fee,gross+fee if buy else gross-fee,reason,book.seq,fx.snapshot_id)
            self.cache[intent.id]=(intent,result)
            return result
        if now_ms>intent.expiry_ms: return finish("CANCELLED","EXPIRED")
        if book.receive_ms<intent.decision_ms+self.latency or not 0<=now_ms-book.receive_ms<=3000 or not 0<=now_ms-book.event_ms<=3000:
            return finish("CANCELLED","STALE_BOOK")
        if not 0<=now_ms-fx.receive_ms<=60000 or not fx.snapshot_id or not (D(0)<fx.bid<=fx.ask):
            return finish("CANCELLED","STALE_FX")
        if not (D(0)<rules.qty_step<=rules.max_qty and D(0)<rules.min_qty<=rules.max_qty and rules.min_notional>0):
            raise ValueError("invalid exchange rules")
        if intent.quantity<=0 or intent.quantity>rules.max_qty or intent.reservation_brl<0 or intent.held_quantity<0:
            raise ValueError("invalid quantity or balance")
        if not buy and intent.quantity>intent.held_quantity: return finish("CANCELLED","INSUFFICIENT_POSITION")
        bids=sorted(((dec(p),dec(q)) for p,q in book.bids),reverse=True)
        asks=sorted((dec(p),dec(q)) for p,q in book.asks)
        if not bids or not asks or bids[0][0]>=asks[0][0] or any(p<=0 or q<0 for p,q in bids+asks):
            return finish("CANCELLED","INVALID_BOOK")
        if len({p for p,q in bids})!=len(bids) or len({p for p,q in asks})!=len(asks):
            return finish("CANCELLED","DUPLICATE_LEVEL")
        old=self.last.get(book.symbol)
        if old and old[0]>book.seq: return finish("CANCELLED","REWIND_BOOK")
        fingerprint=(tuple(bids),tuple(asks))
        if old and old[0]==book.seq and old[1]!=fingerprint: return finish("CANCELLED","CONFLICTING_BOOK")
        if old and old[0]==book.seq:
            consumed=old[2].copy()
        else:
            consumed={}
            # A new book update may replenish liquidity. Full historical replay
            # of price-level changes and impact is still required for certification.
        remaining=floor_step(intent.quantity,rules.qty_step)
        if remaining<rules.min_qty: return finish("CANCELLED","MIN_QTY")
        qty=quote=D(0)
        fx_rate=fx.ask if buy else fx.bid
        for p,available in (asks if buy else bids):
            level=(intent.side,p)
            available=max(D(0),available-consumed.get(level,D(0)))
            effective=p*(1+self.slip if buy else 1-self.slip)
            fill=floor_step(min(available,remaining),rules.qty_step)
            if buy:
                # Bound the fee-inclusive reservation before consuming this level.
                # Two cents headroom covers conservative gross/fee rounding.
                room=max(D(0),intent.reservation_brl-D("0.02")-quote*fx_rate*(1+self.fee))
                fill=min(fill,floor_step(room/(effective*fx_rate*(1+self.fee)),rules.qty_step))
            if fill<=0: continue
            quote+=fill*effective;qty+=fill;remaining-=fill
            consumed[level]=consumed.get(level,D(0))+fill
            if remaining<rules.qty_step: break
        if qty<rules.min_qty or quote<rules.min_notional: return finish("CANCELLED","NO_ELIGIBLE_LIQUIDITY")
        gross=money(quote*fx_rate,buy)
        fee=money(quote*fx_rate*self.fee,True)
        if buy and gross+fee>intent.reservation_brl: return finish("CANCELLED","RESERVATION_LIMIT")
        if not buy and fee>gross: return finish("CANCELLED","NEGATIVE_PROCEEDS")
        self.last[book.symbol]=(book.seq,fingerprint,consumed)
        return finish("FILLED" if remaining==0 else "PARTIAL_CANCELLED","IOC",qty,quote/qty,gross,fee)
