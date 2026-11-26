"""Persistent scientific scheduler; no authority to execute orders."""
from datetime import datetime,timezone
from zoneinfo import ZoneInfo
from axiom_science import canonical

def slots(ts):
    t=datetime.fromtimestamp(ts/1000,timezone.utc).astimezone(ZoneInfo("America/Sao_Paulo"))
    date=t.date().isoformat()
    minute=t.hour*60+t.minute
    out=[]
    if 10<=minute<15:out.append(("daily:"+date,"daily"))
    if t.weekday()==0 and 30<=minute<35:out.append(("weekly:"+date,"weekly"))
    if t.day==1 and 50<=minute<55:out.append(("monthly:"+date,"monthly"))
    return out

class Scheduler:
    def __init__(self,science):
        self.s=science
        self.s.db.execute("""CREATE TABLE IF NOT EXISTS scheduled_jobs(
        id TEXT PRIMARY KEY,kind TEXT NOT NULL,ts INTEGER NOT NULL,
        state TEXT NOT NULL,detail TEXT)""")
    def tick(self,ts,handlers):
        results=[]
        for id,kind in slots(ts):
            if kind not in handlers:continue
            with self.s.transaction():
                r=self.s.db.execute("INSERT OR IGNORE INTO scheduled_jobs VALUES(?,?,?,'RUNNING',NULL)",(id,kind,ts))
                claimed=r.rowcount==1
            if not claimed:continue
            try:
                result=handlers[kind](id,ts)
                state="DONE";detail=canonical(result)
            except Exception as e:
                state="FAILED";detail=type(e).__name__
            self.s.db.execute("UPDATE scheduled_jobs SET state=?,detail=? WHERE id=?",(state,detail,id))
            results.append({"id":id,"state":state})
        return results
    def recover(self):
        return self.s.db.execute("UPDATE scheduled_jobs SET state='INTERRUPTED',detail='process interrupted' WHERE state='RUNNING'").rowcount
    def status(self):
        return [dict(zip(("id","kind","ts","state","detail"),r)) for r in self.s.db.execute("SELECT id,kind,ts,state,detail FROM scheduled_jobs ORDER BY ts DESC LIMIT 20")]
