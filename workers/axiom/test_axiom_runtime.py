import json
from axiom_runtime import scan,freeze_inputs,train
from axiom_science import Science
import pytest
def test_scan_real_record_contract_and_frozen_cutoff(tmp_path):
    f=tmp_path/"test.ndjson"
    def event(ts,kind,data):return dict(operator_id="axiom-01",schema_version=1,run_id="r",ts_receive_utc=ts,kind=kind,data=data)
    events=[event(61000,"FEATURE_1M",{"symbol":"BTCUSDT","end":60000}),
        event(61000,"WS",{"raw":True}),event(121000,"FEATURE_1M",{"symbol":"ETHUSDT","end":120000})]
    f.write_text("".join(json.dumps(e)+"\n" for e in events)+"{",encoding="utf-8")
    q=scan([f],100000)
    assert q["symbols"]==["BTCUSDT"] and q["invalid_records"]==1
    assert q["records"]=={"FEATURE_1M":1,"WS":1}
    out,sha=freeze_inputs([f],tmp_path/"freeze",100000)
    assert len(sha)==64 and len(out.read_text().splitlines())==1
    assert json.loads(out.read_text())["data"]["symbol"]=="BTCUSDT"
    s=Science(tmp_path/"science.sqlite")
    with pytest.raises(ValueError,match="44 calendar"):
        train([f],0,100000,tmp_path/"model",s)
    s.close()
