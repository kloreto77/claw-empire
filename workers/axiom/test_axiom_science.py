import pytest
from axiom_science import Science
def test_memory_budget_causal_and_immutable(tmp_path):
    path=tmp_path/"science.sqlite"
    s=Science(path)
    e=s.evidence("SYSTEM",1000,{"ok":True})
    assert s.evidence("SYSTEM",1000,{"ok":True})==e
    assert not s.context(999)
    assert s.context(1000)[0]["id"]==e
    with pytest.raises(ValueError,match="future"):
        s.reserve_investigation("future",999,"why",[e])
    for i in range(3):
        assert s.reserve_investigation(str(i),1001,"why",[e])
        assert not s.reserve_investigation(str(i),1001,"why",[e])
        s.complete_investigation(str(i),None)
    s.close()
    s=Science(path)
    with pytest.raises(ValueError,match="budget"):
        s.reserve_investigation("extra",2000,"why",[e])
    assert s.reserve_investigation("tomorrow",86402000,"why",[e])
    s.close()
def test_shadow_never_promotes(tmp_path):
    s=Science(tmp_path/"science.sqlite")
    e=s.evidence("DATA_QUALITY",1000,{"n":200})
    body={k:k for k in ("hypothesis","mechanism","change","baseline","metric","falsification","risks")}
    h=s.propose(1001,e,body)
    manifest={"baseline_hash":"a"*64,"candidate_hash":"b"*64,"data_hash":"c"*64,"seed":42,"cost_scenario":"base"}
    id=s.shadow(h,manifest,2000,3000)
    x={"baseline_equity_brl":100000,"candidate_equity_brl":101000,"baseline_drawdown":.01,"candidate_drawdown":.02,"observations":100}
    s.result(id,2500,x);s.result(id,2500,x)
    with pytest.raises(ValueError,match="immutable"):
        s.result(id,2500,{**x,"observations":101})
    assert s.report(id,2499)["results"]==[]
    assert not s.report(id,3000)["promotion_authorized"]
    s.close()
