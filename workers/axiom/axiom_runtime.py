"""AXIOM research worker entrypoint. Operates on the actual Mesa collector files.
No orders are exposed; official paper authorization remains disabled.
Commands: scan, tick, train, experiment, replay, review and private IOC matching.
"""
from __future__ import annotations
import argparse
import json
import hashlib
from pathlib import Path
import sys
import time
from axiom_science import Science,canonical
from axiom_retention import archive_expired, log_paths, open_log
from axiom_supervisor import review
from axiom_ioc import match_payload
from axiom_replay import load_decisions, replay
from axiom_scheduler import Scheduler
import os

VERSION="1.0.0-draft"
DAY=86_400_000
def utc_ms(): return int(time.time()*1000)

def inputs(root):
    return log_paths(root)

def scan_segment(path, cutoff):
    counts, days, latest = {}, set(), {}
    first = last = max_ts = None
    invalid = 0
    with open_log(path) as stream:
        for line in stream:
            if not line.endswith("\n"):
                invalid += 1
                continue
            try:
                event = json.loads(line)
                if event.get("operator_id") != "axiom-01" or event.get("schema_version") != 1:
                    invalid += 1
                    continue
                ts = int(event["ts_receive_utc"])
                max_ts = ts if max_ts is None else max(max_ts, ts)
                if ts > cutoff:
                    continue
                kind, payload = event["kind"], event["data"]
                counts[kind] = counts.get(kind, 0) + 1
                if kind != "FEATURE_1M":
                    continue
                end, symbol = int(payload["end"]), str(payload["symbol"])
                if end > ts or ts - end > 3000:
                    invalid += 1
                    continue
                days.add(end // DAY)
                first = end if first is None else min(first, end)
                last = end if last is None else max(last, end)
                latest[symbol] = max(latest.get(symbol, end), end)
            except (ValueError, KeyError, TypeError, AttributeError):
                invalid += 1
    return counts, sorted(days), latest, first, last, invalid, max_ts

def segment_stat(path):
    try:
        return path.stat()
    except FileNotFoundError:
        return path.with_suffix(".ndjson.gz").stat()

def scan(paths, cutoff, db=None):
    """Reuse exact summaries of unchanged segments when every record precedes the cut."""
    if db is not None:
        db.execute("""CREATE TABLE IF NOT EXISTS scan_segments(
            path TEXT PRIMARY KEY, signature TEXT NOT NULL, max_ts INTEGER, summary TEXT NOT NULL)""")
    counts, days, latest = {}, set(), {}
    first = last = None
    invalid = size = 0
    for path in paths:
        before = segment_stat(path)
        size += before.st_size
        signature = canonical([before.st_size, before.st_mtime_ns, before.st_ino])
        cached = None if db is None else db.execute(
            "SELECT summary FROM scan_segments WHERE path=? AND signature=? AND (max_ts IS NULL OR max_ts<=?)",
            (str(path), signature, cutoff),
        ).fetchone()
        segment = json.loads(cached[0]) if cached else scan_segment(path, cutoff)
        c, d, timestamps, lo, hi, bad, max_ts = segment
        if db is not None and not cached and (max_ts is None or max_ts <= cutoff) and before == segment_stat(path):
            db.execute("""INSERT INTO scan_segments VALUES(?,?,?,?)
                ON CONFLICT(path) DO UPDATE SET signature=excluded.signature,
                max_ts=excluded.max_ts,summary=excluded.summary""",
                (str(path), signature, max_ts, canonical(segment)))
        for kind,count in c.items():
            counts[kind] = counts.get(kind, 0) + count
        for symbol,ts in timestamps.items():
            latest[symbol] = max(latest.get(symbol, ts), ts)
        days.update(d)
        if lo is not None:
            first = lo if first is None else min(first, lo)
            last = hi if last is None else max(last, hi)
        invalid += bad
    return {"as_of_ms":cutoff,"stage":"COLLECT_ONLY","strategy_version":VERSION,
       "source_files":len(paths),"bytes":size,"records":counts,"symbols":sorted(latest),
       "minute_days":len(days),"first_minute":first,"last_minute":last,"latest_by_symbol":latest,
       "invalid_records":invalid,"calendar_span_ms":0 if first is None else last-first,
       "paper_authorized":False}

def write_json(path,obj):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    tmp=path.with_suffix(path.suffix+".tmp")
    tmp.write_text(canonical(obj),encoding="utf-8");tmp.replace(path)

def freeze_inputs(paths,target,cutoff):
    """Freeze full prefix records to a private research dataset before training.
    No mutable input or future observation enters the manifest.
    """
    target=Path(target);target.mkdir(parents=True,exist_ok=False)
    digest=hashlib.sha256();out=target/"minutes.ndjson"
    with out.open("wb") as dst:
        for path in paths:
            with open_log(path,"rb") as src:
                for line in src:
                    if not line.endswith(b"\n"):continue
                    try:e=json.loads(line)
                    except (ValueError,UnicodeError):continue
                    if (e.get("operator_id")!="axiom-01" or e.get("schema_version")!=1 or
                       e.get("kind") not in ("FEATURE_1M","LIQUIDITY_W1") or
                       not isinstance(e.get("ts_receive_utc"),int) or e["ts_receive_utc"]>cutoff):continue
                    normalized=(canonical(e)+"\n").encode()
                    digest.update(normalized);dst.write(normalized)
    return out,digest.hexdigest()

def train(paths,start,cutoff,output,store):
    from axiom_research import HORIZONS,FEATURES,MINUTE,load_minutes,fit_horizon
    if cutoff<start+44*DAY:raise ValueError("44 calendar days have not elapsed")
    quality=scan(paths,cutoff)
    if quality["calendar_span_ms"]<44*DAY-MINUTE or quality["minute_days"]<44 or len(quality["symbols"])<12:
        raise ValueError("insufficient real minute history; COLLECT_ONLY")
    output=Path(output);output.mkdir(parents=True,exist_ok=False)
    # Freeze and train in an isolated output directory. Never overwrite official models.
    data,sha=freeze_inputs(paths,output/"dataset",cutoff)
    frame=load_minutes([data])
    if any(k not in frame for k in FEATURES):raise ValueError("incomplete structural features")
    manifests=[]
    for h in HORIZONS:
        manifests.append(fit_horizon(frame,h,start,output/"models"/str(h)))
    result={"mode":"RESEARCH_ONLY","version":VERSION,"start_ms":start,"as_of_ms":cutoff,
            "data_sha256":sha,"horizons":manifests,"paper_authorized":False,
            "blockers":["prospective holdout","cost-aware replay","effective sample size","human approval"]}
    write_json(output/"manifest.json",result)
    store.evidence("FORECAST",cutoff,{"data_sha256":sha,"metrics":[m["metrics"] for m in manifests],"mode":"RESEARCH_ONLY"})
    return result

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--data",required=True,help="Mesa logs/axiom-01")
    p.add_argument("--state",required=True,help="separate scientific state directory")
    sub=p.add_subparsers(dest="cmd",required=True)
    sub.add_parser("scan")
    sub.add_parser("ioc")
    sub.add_parser("tick")
    sub.add_parser("experiment")
    sub.add_parser("replay").add_argument("--decisions")
    t=sub.add_parser("train");t.add_argument("--start-ms",type=int,required=True);t.add_argument("--output",required=True)
    r=sub.add_parser("review");r.add_argument("--id",required=True);r.add_argument("--question",default="Revisão científica do estado atual e qualidade dos dados.")
    a=p.parse_args()
    if a.cmd=="ioc":
        try:
            raw=sys.stdin.buffer.read(4*1024*1024+1)
            if len(raw)>4*1024*1024:raise ValueError("IOC request too large")
            print(canonical(match_payload(json.loads(raw))))
            return 0
        except (ValueError, TypeError, KeyError, ArithmeticError):
            return 1
    from axiom_experiments import ExperimentQueue,run_next
    state=Path(a.state);state.mkdir(parents=True,exist_ok=True)
    store=Science(state/"science.sqlite");cutoff=utc_ms()
    try:
        retention=archive_expired(a.data,cutoff) if a.cmd=="tick" else None
        if retention and (retention["archived"] or retention["error"]):
            store.evidence("SYSTEM",cutoff,{"retention":retention})
        paths=inputs(a.data)
        quality=scan(paths,cutoff,store.db)
        eid=store.evidence("DATA_QUALITY",cutoff,quality)
        def review_context(ts):
            # Recent quality summaries alone crowd out experimental evidence.
            ids=[]
            for kind in ("DATA_QUALITY","EXPERIMENT","EXECUTION_REPLAY","FORECAST","CALIBRATION","SYSTEM"):
                row=store.db.execute("SELECT id FROM evidence WHERE kind=? AND ts<=? AND length(body)<=8000 ORDER BY ts DESC,id LIMIT 1",(kind,ts)).fetchone()
                if row:
                    ids.append(row[0])
            return ids
        if a.cmd=="scan":result={**quality,"evidence_id":eid}
        elif a.cmd=="train":result=train(paths,a.start_ms,cutoff,a.output,store)
        elif a.cmd=="replay":
            result=replay(paths,load_decisions(a.decisions) if a.decisions else (),cutoff)
            result["evidence_id"]=store.evidence("EXECUTION_REPLAY",cutoff,result)
        elif a.cmd=="experiment":
            result={**quality,"evidence_id":eid,
                    "experiment":run_next(store,paths,cutoff,state,quality,freeze_inputs)}
        elif a.cmd=="tick":
            scheduler=Scheduler(store)
            scheduler.recover()
            handlers={}
            if os.environ.get("OPENROUTER_API_KEY"):
                def daily(id,ts):
                    return review(store,id,ts,VERSION,"Revisão diária científica.",review_context(ts))
                def weekly(id,ts):
                    return review(store,id,ts,VERSION,"Revisão semanal e hipóteses falsificáveis.",review_context(ts))
                def monthly(id,ts):
                    return review(store,id,ts,VERSION,"Revisão mensal da qualidade, riscos e resultados dos experimentos.",review_context(ts))
                handlers={"daily":daily,"weekly":weekly,"monthly":monthly}
            scheduled=scheduler.tick(cutoff,handlers)
            experiment={"jobs":ExperimentQueue(store).status()}
            result={**quality,"evidence_id":eid,"scheduled":scheduled,
                    "retention":retention,"experiment":experiment,
                    "supervisor_configured":bool(handlers),"jobs":[{k:v for k,v in j.items() if k!="detail"} for j in scheduler.status()]}
        else:
            result=review(store,a.id,cutoff,VERSION,a.question,review_context(cutoff))
        write_json(state/("last_experiment.json" if a.cmd=="experiment" else "last_result.json"),result);print(canonical(result))
    except Exception as e:
        # Do not leak credential, HTTP body or stack via machine-readable status.
        result={"stage":"COLLECT_ONLY","paper_authorized":False,"error_type":type(e).__name__}
        if isinstance(e,ValueError):result["detail"]=str(e)[:300]
        write_json(state/("last_experiment.json" if a.cmd=="experiment" else "last_result.json"),result);print(canonical(result),file=sys.stderr)
        return 1
    finally:store.close()
    return 0

if __name__=="__main__":raise SystemExit(main())
