"""AXIOM research worker entrypoint. Operates on the actual Mesa collector files.
No orders are exposed; official paper authorization remains disabled.
Commands: scan, train, review. Host process manager/automatic schedule still required.
"""
from __future__ import annotations
import argparse
import json
import hashlib
from pathlib import Path
from datetime import datetime,timezone
import sys
import time
from axiom_science import Science,canonical
from axiom_research import HORIZONS,FEATURES,MINUTE,DAY,load_minutes,fit_horizon
from axiom_supervisor import review

VERSION="1.0.0-draft"
def utc_ms(): return int(time.time()*1000)

def inputs(root):
    root=Path(root).resolve()
    return sorted(p for p in root.glob("*.ndjson") if p.is_file() and not p.is_symlink())

def scan(paths,cutoff):
    """Read complete records only. No partial live line is treated as evidence."""
    counts={}; symbols=set(); days=set(); first=None;last=None;invalid=0;latest={}
    for path in paths:
        with path.open(encoding="utf-8") as f:
            for line in f:
                if not line.endswith("\n"):
                    invalid+=1;continue
                try:
                    e=json.loads(line)
                    if e.get("operator_id")!="axiom-01" or e.get("schema_version")!=1:
                        invalid+=1;continue
                    ts=int(e["ts_receive_utc"])
                    if ts>cutoff:continue
                    k=e["kind"];p=e["data"]
                    counts[k]=counts.get(k,0)+1
                    if k=="FEATURE_1M":
                        end=int(p["end"]);s=str(p["symbol"])
                        if end>ts or ts-end>3000:invalid+=1;continue
                        symbols.add(s);days.add(end//DAY)
                        first=end if first is None else min(first,end)
                        last=end if last is None else max(last,end)
                        latest[s]=max(latest.get(s,0),end)
                except (ValueError,KeyError,TypeError,AttributeError):
                    invalid+=1
    return {"as_of_ms":cutoff,"stage":"COLLECT_ONLY","strategy_version":VERSION,
       "source_files":len(paths),"bytes":sum(p.stat().st_size for p in paths),
       "records":counts,"symbols":sorted(symbols),"minute_days":len(days),
       "first_minute":first,"last_minute":last,"latest_by_symbol":latest,
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
            with path.open("rb") as src:
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
    t=sub.add_parser("train");t.add_argument("--start-ms",type=int,required=True);t.add_argument("--output",required=True)
    r=sub.add_parser("review");r.add_argument("--id",required=True);r.add_argument("--question",default="Revisão científica do estado atual e qualidade dos dados.")
    a=p.parse_args()
    state=Path(a.state);state.mkdir(parents=True,exist_ok=True)
    store=Science(state/"science.sqlite");cutoff=utc_ms();paths=inputs(a.data)
    try:
        quality=scan(paths,cutoff)
        eid=store.evidence("DATA_QUALITY",cutoff,quality)
        if a.cmd=="scan":result={**quality,"evidence_id":eid}
        elif a.cmd=="train":result=train(paths,a.start_ms,cutoff,a.output,store)
        else:
            result=review(store,a.id,cutoff,VERSION,a.question,[e["id"] for e in store.context(cutoff,10)])
        write_json(state/"last_result.json",result);print(canonical(result))
    except Exception as e:
        # Do not leak credential, HTTP body or stack via machine-readable status.
        result={"stage":"COLLECT_ONLY","paper_authorized":False,"error_type":type(e).__name__}
        if isinstance(e,ValueError):result["detail"]=str(e)[:300]
        write_json(state/"last_result.json",result);print(canonical(result),file=sys.stderr)
        return 1
    finally:store.close()
    return 0

if __name__=="__main__":raise SystemExit(main())
