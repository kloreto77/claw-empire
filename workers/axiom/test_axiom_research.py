import numpy as np
import pandas as pd
import pytest
from axiom_research import topology, labeled, split, MINUTE, DAY, FEATURES, fit_horizon

def test_topology_and_reset():
    rng=np.random.default_rng(42)
    x=pd.DataFrame(rng.normal(size=(60,12)),index=np.arange(60)*MINUTE,columns=[f"A{i:02}" for i in range(12)])
    state, first=topology(x)
    assert first is None
    _, second=topology(x,state)
    assert len(second)==12
    assert all(v["bottleneck_h0"]==0 and v["bottleneck_h1"]==0 for v in second.values())
    assert topology(x.iloc[:,1:]) is None
    assert topology(x.rename(columns={"A00":"Z"}),state)[1] is None

def test_labels_reject_gaps_and_reconnects():
    x=pd.DataFrame({"run":["a"]*7,"symbol":["BTC"]*7,"end":np.array([0,1,2,3,4,5,7])*MINUTE,
                    "decision_at":np.array([0,1,2,3,4,5,7])*MINUTE+1000,"mid":[100,101,102,103,104,105,107]})
    y=labeled(x,5)
    assert len(y)==1 and abs(y.iloc[0].y-.05)<1e-10
    x.loc[3,"run"]="b"
    assert labeled(x,5).empty

def test_split_rejects_short_history():
    with pytest.raises(ValueError,match="44 calendar"):
        split(pd.DataFrame({"end":[0,DAY]}),0)

def test_catboost_end_to_end_research_only(tmp_path):
    # Synthetic fixtures test software, not market evidence.
    n=44*1440+1; time=np.arange(n)*MINUTE
    rng=np.random.default_rng(19)
    frame=pd.DataFrame({"end":time,"decision_at":time+1000,"run":"fixture","symbol":"BTC",
                        "mid":100*np.exp(np.cumsum(rng.normal(0,.0002,n)))})
    for c in FEATURES: frame[c]=rng.normal(size=n)
    r=fit_horizon(frame,5,0,tmp_path/"candidate")
    assert r["status"]=="RESEARCH_ONLY" and not r["paper_authorized"]
    assert r["metrics"]["train_rows"]>200 and len(r["metrics"]["pinball"])==7
    assert len(r["model_files"])==2
