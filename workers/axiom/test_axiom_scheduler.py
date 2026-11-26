from datetime import datetime
from axiom_science import Science
from axiom_scheduler import Scheduler

def ms(s):return int(datetime.fromisoformat(s).timestamp()*1000)
def test_schedule_persistence(tmp_path):
    p=tmp_path/"science.db"
    s=Science(p);q=Scheduler(s);calls=[]
    handlers={k:lambda id,t:calls.append(id) or {"ok":True} for k in ("daily","weekly")}
    assert not q.tick(ms("2026-11-23T00:09:00-03:00"),handlers)
    assert len(q.tick(ms("2026-11-23T00:10:00-03:00"),handlers))==1
    assert len(q.tick(ms("2026-11-23T00:30:00-03:00"),handlers))==1
    s.close();s=Science(p);q=Scheduler(s)
    assert not q.tick(ms("2026-11-23T01:00:00-03:00"),handlers)
    assert len(calls)==2
    s.close()
def test_failure_is_not_repeated(tmp_path):
    s=Science(tmp_path/"s.db");q=Scheduler(s)
    def fail(*args):raise RuntimeError("private")
    t=ms("2026-11-24T00:10:00-03:00")
    assert q.tick(t,{"daily":fail})[0]["state"]=="FAILED"
    assert not q.tick(t,{"daily":fail})
    assert q.status()[0]["detail"]=="RuntimeError"
    s.close()
