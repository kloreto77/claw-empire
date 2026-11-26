"""AXIOM scientific memory and shadow experiment registry. No live or paper orders.
This module deliberately cannot promote a strategy or change the official model.
"""
import json
import sqlite3
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo
from contextlib import contextmanager
import math

def canonical(obj):
    return json.dumps(obj,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False)
def day(ts):
    return datetime.fromtimestamp(ts/1000,timezone.utc).astimezone(ZoneInfo("America/Sao_Paulo")).date().isoformat()
def digest(obj):
    return hashlib.sha256(canonical(obj).encode()).hexdigest()

class Science:
    def __init__(self,path):
        self.db=sqlite3.connect(path,timeout=10,isolation_level=None)
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,ts INTEGER NOT NULL,kind TEXT NOT NULL,body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS hypotheses(id TEXT PRIMARY KEY,created INTEGER NOT NULL,evidence_id TEXT NOT NULL REFERENCES evidence(id),body TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('PROPOSED','REJECTED','SHADOW')));
        CREATE TABLE IF NOT EXISTS experiments(id TEXT PRIMARY KEY,hypothesis TEXT NOT NULL REFERENCES hypotheses(id),manifest TEXT NOT NULL,start INTEGER NOT NULL,end INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS shadow_results(experiment TEXT NOT NULL REFERENCES experiments(id),ts INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(experiment,ts));
        CREATE TABLE IF NOT EXISTS investigations(id TEXT PRIMARY KEY,day TEXT NOT NULL,ts INTEGER NOT NULL,state TEXT NOT NULL,request TEXT NOT NULL,response TEXT);
        """)
    @contextmanager
    def transaction(self):
        self.db.execute("BEGIN IMMEDIATE")
        try:
            yield
            self.db.execute("COMMIT")
        except BaseException:
            self.db.execute("ROLLBACK")
            raise
    def close(self): self.db.close()
    def evidence(self,kind,ts,body):
        if not isinstance(ts,int) or ts<0 or kind not in ("DATA_QUALITY","FORECAST","CALIBRATION","EXECUTION_REPLAY","EXPERIMENT","SYSTEM"):
            raise ValueError("invalid evidence")
        id=digest({"kind":kind,"ts":ts,"body":body})
        self.db.execute("INSERT OR IGNORE INTO evidence VALUES(?,?,?,?)",(id,ts,kind,canonical(body)))
        return id
    def context(self,cutoff,limit=30):
        if not 1<=limit<=100: raise ValueError("limit")
        rows=self.db.execute("SELECT id,ts,kind,body FROM evidence WHERE ts<=? ORDER BY ts DESC,id LIMIT ?",(cutoff,limit)).fetchall()
        return [{"id":i,"ts":ts,"kind":k,"body":json.loads(b)} for i,ts,k,b in rows]
    def reserve_investigation(self,id,ts,question,evidence_ids):
        if not id or not isinstance(ts,int) or not question or len(question)>4000 or not 1<=len(evidence_ids)<=30:
            raise ValueError("invalid investigation")
        req={"question":question,"evidence_ids":sorted(set(evidence_ids))}
        raw=canonical(req)
        with self.transaction():
            prior=self.db.execute("SELECT day,request,state FROM investigations WHERE id=?",(id,)).fetchone()
            if prior:
                if prior[:2]!=(day(ts),raw): raise ValueError("conflicting investigation")
                return False
            for e in req["evidence_ids"]:
                if not self.db.execute("SELECT 1 FROM evidence WHERE id=? AND ts<=?",(e,ts)).fetchone():
                    raise ValueError("missing or future evidence")
            if self.db.execute("SELECT COUNT(*) FROM investigations WHERE day=?",(day(ts),)).fetchone()[0]>=3:
                raise ValueError("daily LLM budget exhausted")
            # Count reservations/failed calls too. Never retry automatically with same id.
            self.db.execute("INSERT INTO investigations VALUES(?,?,?,?,?,NULL)",(id,day(ts),ts,"RESERVED",raw))
            return True
    def complete_investigation(self,id,response=None):
        if response is not None and (not isinstance(response,str) or len(response)>20000):
            raise ValueError("invalid response")
        with self.transaction():
            r=self.db.execute("UPDATE investigations SET state=?,response=? WHERE id=? AND state='RESERVED'",("FAILED" if response is None else "DONE",response,id))
            if r.rowcount!=1: raise ValueError("not reserved")
    def propose(self,ts,evidence_id,body):
        required={"hypothesis","mechanism","change","baseline","metric","falsification","risks"}
        if not isinstance(body,dict) or set(body)!=required or any(not isinstance(v,str) or not v.strip() or len(v)>4000 for v in body.values()):
            raise ValueError("invalid hypothesis")
        if not self.db.execute("SELECT 1 FROM evidence WHERE id=? AND ts<=?",(evidence_id,ts)).fetchone():
            raise ValueError("missing or future evidence")
        id=digest({"evidence":evidence_id,"body":body})
        self.db.execute("INSERT OR IGNORE INTO hypotheses VALUES(?,?,?,?,'PROPOSED')",(id,ts,evidence_id,canonical(body)))
        return id
    def shadow(self,hypothesis,manifest,start,end):
        # Only an explicit host command invokes this; the LLM has no tool access.
        if not isinstance(start,int) or not isinstance(end,int) or end<=start or not isinstance(manifest,dict):
            raise ValueError("invalid experiment")
        required={"baseline_hash","candidate_hash","data_hash","seed","cost_scenario"}
        if set(manifest)!=required or any(not isinstance(manifest[k],str) or len(manifest[k])!=64 or any(c not in "0123456789abcdef" for c in manifest[k]) for k in ("baseline_hash","candidate_hash","data_hash")):
            raise ValueError("unversioned experiment")
        if manifest["baseline_hash"]==manifest["candidate_hash"]: raise ValueError("candidate unchanged")
        id=digest({"hypothesis":hypothesis,"manifest":manifest,"start":start,"end":end})
        with self.transaction():
            h=self.db.execute("SELECT created,state FROM hypotheses WHERE id=?",(hypothesis,)).fetchone()
            if not h or h[0]>start or h[1]=="REJECTED": raise ValueError("invalid hypothesis state")
            self.db.execute("INSERT OR IGNORE INTO experiments VALUES(?,?,?,?,?)",(id,hypothesis,canonical(manifest),start,end))
            self.db.execute("UPDATE hypotheses SET state='SHADOW' WHERE id=?",(hypothesis,))
        return id
    def result(self,id,ts,body):
        required={"baseline_equity_brl","candidate_equity_brl","baseline_drawdown","candidate_drawdown","observations"}
        if not isinstance(body,dict) or set(body)!=required or any(not isinstance(x,(int,float)) or isinstance(x,bool) or not math.isfinite(x) for x in body.values()):
            raise ValueError("invalid result")
        if min(body.values())<0 or max(body["baseline_drawdown"],body["candidate_drawdown"])>1 or int(body["observations"])!=body["observations"]:
            raise ValueError("invalid metric")
        with self.transaction():
            exp=self.db.execute("SELECT start,end FROM experiments WHERE id=?",(id,)).fetchone()
            if not exp or not exp[0]<=ts<=exp[1]: raise ValueError("outside experiment")
            raw=canonical(body)
            old=self.db.execute("SELECT body FROM shadow_results WHERE experiment=? AND ts=?",(id,ts)).fetchone()
            if old and old[0]!=raw: raise ValueError("immutable result")
            self.db.execute("INSERT OR IGNORE INTO shadow_results VALUES(?,?,?)",(id,ts,raw))
    def report(self,id,cutoff):
        exp=self.db.execute("SELECT manifest,start,end FROM experiments WHERE id=?",(id,)).fetchone()
        if not exp: raise ValueError("experiment not found")
        rows=self.db.execute("SELECT ts,body FROM shadow_results WHERE experiment=? AND ts<=? ORDER BY ts",(id,cutoff)).fetchall()
        return {"mode":"SHADOW_ONLY","manifest":json.loads(exp[0]),"start":exp[1],"end":exp[2],"results":[{"ts":t,**json.loads(b)} for t,b in rows],"promotion_authorized":False}
