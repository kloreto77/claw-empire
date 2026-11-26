from decimal import Decimal as D
from dataclasses import replace
import pytest
from axiom_ioc import Matcher,Intent,Book,FX,Rules

def setup():
    b=Book("BTCUSDT",1,1500,1500,(("99","3"),),(("100","1"),("101","1")))
    f=FX(D("5"),D("5.01"),1500,"fx-1")
    r=Rules(D(".001"),D(".001"),D("5"),D("10"))
    i=Intent("a","BTCUSDT","buy",D("3"),1000,3000,D("2000"),D("0"))
    return i,b,f,r

def test_partial_ioc_uses_depth_and_does_not_reuse_same_event():
    i,b,f,r=setup()
    m=Matcher()
    x=m.execute(i,b,f,r,1500)
    assert x.status=="PARTIAL_CANCELLED" and x.qty==2 and x.average_price==D("100.5")
    assert x.net_brl==x.gross_brl+x.fee_brl<=i.reservation_brl
    assert m.execute(i,b,f,r,1500)==x
    assert m.execute(replace(i,id="b"),b,f,r,1500).status=="CANCELLED"
    with pytest.raises(ValueError,match="conflicting"):
        m.execute(replace(i,quantity=D("1")),b,f,r,1500)

def test_latency_staleness_fx_and_oversell():
    i,b,f,r=setup()
    m=Matcher()
    with pytest.raises(ValueError,match="latency"):
        m.execute(i,b,f,r,1499)
    assert m.execute(i,replace(b,receive_ms=1499),f,r,1500).reason=="STALE_BOOK"
    assert m.execute(replace(i,id="b"),b,replace(f,receive_ms=-60000),r,1500).reason=="STALE_FX"
    assert m.execute(replace(i,id="c",side="sell",held_quantity=D("1")),b,f,r,1500).reason=="INSUFFICIENT_POSITION"

def test_reservation_and_conservative_fx():
    i,b,f,r=setup()
    m=Matcher()
    x=m.execute(replace(i,reservation_brl=D("500")),b,f,r,1500)
    assert x.status=="PARTIAL_CANCELLED" and D(0)<x.qty<1 and x.net_brl<=500
    y=m.execute(replace(i,id="s",side="sell",quantity=D("1"),held_quantity=D("1")),b,f,r,1500)
    assert y.status=="FILLED" and y.gross_brl==D("495.00") and y.net_brl==D("494.50")
