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


def test_dedicated_worker_ioc_command_preserves_decimal_amounts(tmp_path):
    import json
    from pathlib import Path
    import subprocess
    import sys

    request = {
        "intent": {"id": "order1", "symbol": "BTCUSDT", "side": "buy", "quantity": "0.002",
                   "decision_ms": 0, "expiry_ms": 5000, "reservation_brl": "200.00", "held_quantity": "0"},
        "book": {"symbol": "BTCUSDT", "seq": 50, "event_ms": 500, "receive_ms": 500,
                 "bids": [["9999", "1"]], "asks": [["10000", "1"]]},
        "fx": {"bid": "5.10", "ask": "5.11", "receive_ms": 500, "snapshot_id": "safe"},
        "rules": {"qty_step": "0.001", "min_qty": "0.001", "min_notional": "5.00", "max_qty": "10.000"},
        "now_ms": 500,
    }
    state = tmp_path / "science"
    result = subprocess.run(
        [sys.executable, str(Path(__file__).with_name("axiom_runtime.py")),
         "--data", str(tmp_path), "--state", str(state), "ioc"],
        input=json.dumps(request), text=True, capture_output=True, check=True,
    )
    assert json.loads(result.stdout) == {
        "average_price": "10000", "fee_brl": "0.11", "fx_snapshot_id": "safe", "gross_brl": "102.20",
        "id": "order1", "qty": "0.002", "reason": "IOC", "sequence": 50, "status": "FILLED",
    }
    assert not state.exists()
