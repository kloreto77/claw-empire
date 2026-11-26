import pytest
from axiom_science import Science
from axiom_supervisor import review, MODEL
import json
def test_supervisor_reserves_budget_and_validates_evidence(tmp_path):
    s=Science(tmp_path/"memory.sqlite")
    e=s.evidence("SYSTEM",1000,{"status":"COLLECT_ONLY"})
    def mocked(payload,key):
        assert key=="fake" and payload["model"]==MODEL
        assert "tools" not in payload and payload["max_tokens"]==2000
        ctx=json.loads(payload["messages"][1]["content"])
        report={"type":"inconclusive","as_of_utc":ctx["as_of_utc"],"strategy_version":"v1",
           "facts":[{"claim":"em coleta","evidence_ids":[e]}],"inferences":[],"hypotheses":[],
           "actions_requested":[],"risk_flags":[],"missing_data":["histórico"],"summary_pt_br":"Sem histórico."}
        return {"choices":[{"message":{"content":json.dumps(report)}}]}
    r=review(s,"a",2000,"v1","revisão",[e],credential="fake",transport=mocked)
    assert r["type"]=="inconclusive"
    with pytest.raises(ValueError,match="duplicate"):
        review(s,"a",2000,"v1","revisão",[e],credential="fake",transport=mocked)
    def bad(payload,key):
        data=mocked(payload,key)
        r=json.loads(data["choices"][0]["message"]["content"])
        r["actions_requested"]=[{"tool":"trade"}]
        data["choices"][0]["message"]["content"]=json.dumps(r)
        return data
    with pytest.raises(ValueError,match="unauthorized"):
        review(s,"b",2000,"v1","revisão",[e],credential="fake",transport=bad)
    assert s.db.execute("SELECT state FROM investigations WHERE id='b'").fetchone()[0]=="FAILED"
    s.close()
