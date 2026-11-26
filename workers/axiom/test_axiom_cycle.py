from dataclasses import replace
from decimal import Decimal as D
import numpy as np
from axiom_cycle import ShadowCycle,deadline
from axiom_ioc import Book,FX,Rules
from axiom_policy import Gates

def good():
    return Gates(True,True,True,True,True,True,True,True,.9,200,.01,.02,1.,40.)
def market(t,seq=1):
    return Book("BTCUSDT",seq,t,t,(("99","100"),),(("100","100"),)),FX(D("5"),D("5.01"),t,"fx"+str(t)),Rules(D(".001"),D(".001"),D("5"),D("100"))
def test_cycle_decision_latency_exit_while_paused():
    s=ShadowCycle();t=1764172800000
    b,f,r=market(t)
    # Fixtures exercise plumbing; they are not market evidence.
    x=s.decide(t,"BTCUSDT",good(),np.zeros(800),{(5,100000):np.full(800,10.)},b,f,r)
    assert x["debit_cents"]==100000
    assert s.status()["reserved_brl"]=="1000"
    s.on_book(t+499,*market(t+499))
    assert not s.lots
    s.on_book(t+500,*market(t+500,2))
    assert len(s.lots)==1 and D(s.status()["spent_brl"])<=1000
    spent=s.spent;s.pause(t+600)
    due=deadline(t,5)
    s.on_book(due+500,*market(due+500,3))
    assert not s.lots and s.spent==spent
    assert s.realized<0 and not s.status()["paper_authorized"]
    assert [e["kind"] for e in s.history]==["DECISION","RESERVE","ENTRY","EXIT"]
def test_blocked_exit_retained_and_purchase_cancelled_on_pause():
    s=ShadowCycle();t=1764172800000
    s.decide(t,"BTCUSDT",good(),np.zeros(800),{(5,50000):np.full(800,1.)},*market(t))
    s.pause(t+10)
    assert not s.pending and s.spent==0
    s.resume(t+20)
    s.decide(t+20,"BTCUSDT",good(),np.zeros(800),{(5,50000):np.full(800,1.)},*market(t+20))
    s.on_book(t+520,*market(t+520,2))
    due=deadline(t+20,5)
    b,f,r=market(due+500,3)
    s.on_book(due+500,b,replace(f,receive_ms=0),r)
    assert s.status()["overdue"]==1
    s.on_book(due+1000,*market(due+1000,4))
    assert s.status()["overdue"]==0
