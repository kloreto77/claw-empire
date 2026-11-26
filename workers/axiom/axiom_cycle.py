"""Shadow-only execution orchestration. No official Mesa ledger, broker or LLM authority.
Event-driven on recorded, timestamped books and FX. Each run must be replayed
from its immutable inputs after a restart. Outputs are research evidence only.
"""
from dataclasses import dataclass
from decimal import Decimal as D
from datetime import datetime, timezone
from zoneinfo import ZoneInfo
from axiom_ioc import Matcher, Intent, floor_step
from axiom_policy import choose_allocation
from axiom_science import digest

ZONE=ZoneInfo("America/Sao_Paulo")
def local(ts):
    return datetime.fromtimestamp(ts/1000,timezone.utc).astimezone(ZONE)
def day(ts): return local(ts).date().isoformat()
def deadline(ts,h):
    t=local(ts)
    midnight=t.replace(hour=23,minute=59,second=59,microsecond=0)
    return min(ts+h*60000,int(midnight.timestamp()*1000))

@dataclass
class Lot:
    id:str
    symbol:str
    qty:D
    cost:D
    due:int
    bought_at:int

class ShadowCycle:
    """One isolated portfolio per experiment/cost scenario.
    Pending purchases reserve cash and daily allowance; sales never replenish allowance.
    Unfilled exits are retained and retried on later valid market events.
    """
    def __init__(self,matcher=None):
        self.matcher=matcher or Matcher()
        self.cash=D("100000")
        self.day=None
        self.spent=D(0)
        self.pending={}
        self.lots={}
        self.history=[]
        self.last_ts=-1
        self.paused=False
        self.serial=0
        self.realized=D(0)
    def _record(self,ts,kind,**fields):
        row={"ts":ts,"kind":kind,**fields}
        row["hash"]=digest(row)
        self.history.append(row)
    def _advance(self,ts):
        if not isinstance(ts,int) or ts<self.last_ts:raise ValueError("noncausal event")
        self.last_ts=ts
        d=day(ts)
        if d!=self.day:
            for id in list(self.pending):self._cancel(id,ts,"DAY_ROLLOVER")
            self.day=d;self.spent=D(0)
    def _cancel(self,id,ts,reason):
        self.pending.pop(id)
        self._record(ts,"CANCEL",id=id,reason=reason)
    def status(self):
        reserved=sum((p[0].reservation_brl for p in self.pending.values()),D(0))
        return {"mode":"SHADOW_ONLY","day":self.day,"cash_brl":str(self.cash),
          "spent_brl":str(self.spent),"reserved_brl":str(reserved),
          "remaining_brl":str(D(2000)-self.spent-reserved),"positions":len(self.lots),
          "realized_brl":str(self.realized),"overdue":sum(l.due<=self.last_ts for l in self.lots.values()),
          "paper_authorized":False}
    def pause(self,ts):
        self._advance(ts);self.paused=True
        for id in list(self.pending):self._cancel(id,ts,"PAUSED")
    def resume(self,ts): self._advance(ts);self.paused=False
    def decide(self,ts,symbol,gates,baseline_pnl,scenarios,book,fx,rules):
        self._advance(ts)
        if self.paused:return {"debit_cents":0,"reason":"PAUSED"}
        if (book.symbol!=symbol or not 0<=ts-book.receive_ms<=3000 or
            not 0<=ts-book.event_ms<=3000 or not 0<=ts-fx.receive_ms<=60000 or
            not 0<fx.bid<=fx.ask or not book.asks or not book.bids):
            return {"debit_cents":0,"reason":"STALE_OR_INVALID_MARKET"}
        status=self.status()
        reserved=D(status["reserved_brl"])
        proposal=choose_allocation(gates,int(D(status["remaining_brl"])*100),
              int((self.cash-reserved)*100),baseline_pnl,scenarios)
        self._record(ts,"DECISION",symbol=symbol,proposal=proposal)
        if not proposal["debit_cents"]:return proposal
        h=proposal["horizon"];due=deadline(ts,h)
        # Refuse a new entry too close to the same-day liquidation deadline.
        if due-ts<self.matcher.latency*2+1000:return {"debit_cents":0,"reason":"SESSION_END"}
        amount=D(proposal["debit_cents"])/100
        price=min(D(str(p)) for p,q in book.asks if D(str(q))>0)
        if price<=0:raise ValueError("invalid ask")
        qty=floor_step(min(rules.max_qty,amount/(price*fx.ask*(1+self.matcher.fee))),rules.qty_step)
        if qty<rules.min_qty:return {"debit_cents":0,"reason":"MIN_QTY"}
        self.serial+=1;id=f"b-{self.serial}"
        intent=Intent(id,symbol,"buy",qty,ts,min(ts+5000,due-self.matcher.latency),amount,D(0))
        self.pending[id]=(intent,h)
        self._record(ts,"RESERVE",id=id,symbol=symbol,amount_brl=str(amount))
        return {**proposal,"intent_id":id}
    def on_book(self,ts,book,fx,rules):
        self._advance(ts)
        # Expire orders even when their symbol does not receive an update.
        for id,(i,h) in list(self.pending.items()):
            if ts>i.expiry_ms:self._cancel(id,ts,"EXPIRED")
        # Exits take priority, even when paused. Late or stale exits remain visible.
        for id,lot in list(self.lots.items()):
            if lot.symbol!=book.symbol or ts<lot.due:continue
            self.serial+=1
            # Exit is decided at its deadline. For retry, require a post-latency book.
            decision=lot.due
            if ts<decision+self.matcher.latency or book.receive_ms<decision+self.matcher.latency:continue
            i=Intent(f"s-{self.serial}",lot.symbol,"sell",min(lot.qty,rules.max_qty),decision,ts+1,D(0),lot.qty)
            r=self.matcher.execute(i,book,fx,rules,ts)
            if r.qty:
                basis=lot.cost*r.qty/lot.qty
                self.cash+=r.net_brl;self.realized+=r.net_brl-basis
                lot.qty-=r.qty;lot.cost-=basis
                self._record(ts,"EXIT",id=id,fill=r.id,qty=str(r.qty),net_brl=str(r.net_brl),sequence=r.sequence,late=day(lot.bought_at)!=day(ts))
                if lot.qty==0:del self.lots[id]
            else:self._record(ts,"EXIT_BLOCKED",id=id,reason=r.reason)
        for id,(i,h) in list(self.pending.items()):
            if self.paused:self._cancel(id,ts,"PAUSED");continue
            if i.symbol!=book.symbol or ts<i.decision_ms+self.matcher.latency or book.receive_ms<i.decision_ms+self.matcher.latency:continue
            r=self.matcher.execute(i,book,fx,rules,ts)
            del self.pending[id]
            if not r.qty:self._record(ts,"CANCEL",id=id,reason=r.reason);continue
            if r.net_brl>i.reservation_brl or r.net_brl>self.cash or self.spent+r.net_brl>D(2000):raise RuntimeError("shadow accounting invariant")
            self.cash-=r.net_brl;self.spent+=r.net_brl
            # Horizon starts at decision, not fill, and cannot extend past midnight.
            due=deadline(i.decision_ms,h)
            self.lots[id]=Lot(id,i.symbol,r.qty,r.net_brl,due,ts)
            self._record(ts,"ENTRY",id=id,qty=str(r.qty),net_brl=str(r.net_brl),sequence=r.sequence,due=due)
        return self.status()
