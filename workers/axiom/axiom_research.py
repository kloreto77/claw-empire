"""AXIOM V1 research worker: causal structural and CatBoost primitives.
Research only. No broker client, ledger mutation, or production promotion.
Input: minute rows produced by the collector, with explicit receive timestamps.
"""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.covariance import LedoitWolf
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import make_pipeline

HORIZONS=(5,15,30,60,120)
QUANTILES=(.05,.10,.25,.50,.75,.90,.95)
MINUTE=60_000
DAY=1440*MINUTE
FEATURES=("logReturn","realizedVol","spread","imbalance","entropyBid","entropyAsk","flow",
          "depth_bid","depth_ask","w1Bid","w1Ask","massBid","massAsk","referenceMassBid","referenceMassAsk",
          "h1_mass","h1_cycles","bottleneck_h0","bottleneck_h1","local_change","centrality")

def topology(returns: pd.DataFrame, previous=None):
    """60 contiguous aligned returns; reset comparison when node set changes."""
    from ripser import ripser
    from persim import bottleneck
    if len(returns)!=60 or returns.columns.duplicated().any():
        return None
    if not np.all(np.diff(returns.index.to_numpy(dtype=np.int64))==MINUTE):
        return None
    returns=returns.reindex(sorted(returns.columns),axis=1)
    returns=returns.loc[:,returns.notna().all() & (returns.std()>0)]
    if returns.shape[1]<12 or not np.isfinite(returns.to_numpy()).all():
        return None
    cov=LedoitWolf().fit(returns.to_numpy()).covariance_
    std=np.sqrt(np.diag(cov))
    if np.any(std<=0): return None
    corr=np.clip(cov/np.outer(std,std),-1,1)
    dist=np.sqrt(np.maximum(0,2*(1-corr)))
    dist=(dist+dist.T)/2; np.fill_diagonal(dist,0)
    diagrams=[d[np.isfinite(d).all(axis=1)] for d in ripser(dist,distance_matrix=True,maxdim=1)["dgms"]]
    names=tuple(returns.columns)
    persistence=diagrams[1][:,1]-diagrams[1][:,0]
    state={"names":names,"diagrams":diagrams,"corr":corr}
    # Complete baseline required for deformation; do not fill missing with zero.
    if previous is None or previous["names"]!=names:
        return state,None
    def bn(a,b): return float(bottleneck(a,b)) if len(a) or len(b) else 0.
    centrality=(np.abs(corr).sum(axis=1)-1)/(len(names)-1)
    change=np.abs(corr-previous["corr"]).sum(axis=1)/(len(names)-1)
    global_features={"h1_mass":float(persistence.sum()),"h1_cycles":int(np.sum(persistence>0)),
       "bottleneck_h0":bn(diagrams[0],previous["diagrams"][0]),
       "bottleneck_h1":bn(diagrams[1],previous["diagrams"][1])}
    return state,{s:{**global_features,"centrality":float(centrality[i]),"local_change":float(change[i])} for i,s in enumerate(names)}

def load_minutes(paths):
    """Join one-minute and W1 records without using events received after the decision.
    Preserve run boundaries; duplicated or conflicting records are rejected.
    """
    records={}; liquidity={}
    for path in sorted(map(Path,paths)):
        with path.open(encoding="utf-8") as f:
            for line in f:
                e=json.loads(line)
                if e.get("kind") not in ("FEATURE_1M","LIQUIDITY_W1"): continue
                p=e["data"];end=int(p.get("end",p.get("minute_end")))
                received=int(e["ts_receive_utc"])
                # Feature is finalized on arrival of the next minute, not before it.
                if received<end or received>end+3000: continue
                key=(str(e["run_id"]),str(p["symbol"]),end)
                table=records if e["kind"]=="FEATURE_1M" else liquidity
                row={**p,"received":received}
                if key in table and table[key]!=row: raise ValueError("conflicting minute record")
                table[key]=row
    if not records: raise ValueError("no usable minute observations")
    by_run={}
    for (run,symbol,end),p in records.items():
        l=liquidity.get((run,symbol,end),{})
        row={**p,"run":run,"symbol":symbol,"end":end,"decision_at":max(p["received"],l.get("received",0)),
             "depth_bid":sum(p["bids"]),"depth_ask":sum(p["asks"])}
        for k in FEATURES:
            if k in l: row[k]=l[k]
        by_run.setdefault(run,[]).append(row)
    rows=[]
    for run,raw in by_run.items():
        frame=pd.DataFrame(raw).sort_values(["end","symbol"])
        pivot=frame.pivot(index="end",columns="symbol",values="logReturn").sort_index()
        state=None;out=[]
        for i in range(59,len(pivot)):
            result=topology(pivot.iloc[i-59:i+1],state)
            if result is None: state=None;continue
            state,metrics=result
            if metrics:
                end=int(pivot.index[i])
                # Cross-asset input cutoff is the latest receive time of all contributing rows.
                cutoff=int(frame.loc[frame.end==end,"decision_at"].max())
                out.extend({"end":end,"symbol":s,"topology_at":cutoff,**v} for s,v in metrics.items())
        if out:
            frame=frame.merge(pd.DataFrame(out),on=["end","symbol"],how="left",validate="one_to_one")
            frame["decision_at"]=frame[["decision_at","topology_at"]].max(axis=1).astype("int64")
        rows.append(frame)
    result=pd.concat(rows,ignore_index=True)
    if result.duplicated(["symbol","end"]).any(): raise ValueError("overlapping sessions")
    return result.sort_values(["end","symbol"]).reset_index(drop=True)

def labeled(frame,h):
    if h not in HORIZONS: raise ValueError("invalid horizon")
    # Exact time joins, not row offsets. Never bridge gaps or reconnects.
    cols=["run","symbol","end","mid","decision_at"]
    future=frame[cols].rename(columns={"mid":"future_mid","decision_at":"mature_at"})
    future["end"]=future["end"]-h*MINUTE
    x=frame.merge(future,on=["run","symbol","end"],how="inner",validate="one_to_one")
    x["y"]=x.future_mid/x.mid-1
    # Verify all intermediate minute rows exist; endpoints alone do not certify continuity.
    counts=frame.sort_values("end").groupby(["run","symbol"])["end"]
    contiguous=set()
    for (run,symbol),ends in counts:
        times=ends.to_numpy(dtype=np.int64)
        if len(times)<=h: continue
        for start in times[:-h][times[h:]-times[:-h]==h*MINUTE]:
            contiguous.add((run,symbol,int(start)))
    x=x[[ (r.run,r.symbol,int(r.end)) in contiguous for r in x.itertuples() ]]
    x=x[(x.mature_at>x.decision_at)&(x.mid>0)&(x.future_mid>0)]
    return x.replace([np.inf,-np.inf],np.nan)

def split(frame,start):
    """Fixed 30/7/7 calendar days; 120-minute purge+embargo; holdout untouched."""
    a,b,c=int(start)+30*DAY,int(start)+37*DAY,int(start)+44*DAY
    gap=120*MINUTE
    if frame.end.max()<c-MINUTE: raise ValueError("44 calendar days required; collect only")
    ranges=((start,a-gap),(a+gap,b-gap),(b+gap,c))
    sets=[]
    for lo,hi in ranges:
        d=frame[(frame.end>=lo)&(frame.decision_at<hi)&(frame.mature_at<hi)].copy()
        d=d.dropna(subset=list(FEATURES)+["y"])
        # Fail closed on missing calendar days and inadequate count. This is
        # a provisional density gate, not proof of effective sample size.
        days=(d.end//DAY).nunique()
        required=int((hi-lo)//DAY)
        if days<required or len(d)<200: raise ValueError("inadequate complete data for chronological split")
        sets.append(d)
    return sets

def fit_horizon(frame,h,start,out):
    from catboost import CatBoostRegressor
    train,cal,val=split(labeled(frame,h),start)
    x=train[list(FEATURES)]; y=train.y
    params=dict(iterations=300,depth=5,learning_rate=.05,random_seed=42,thread_count=2,
                verbose=False,allow_writing_files=False,task_type="CPU")
    mean_model=CatBoostRegressor(loss_function="RMSE",**params).fit(x,y)
    q_model=CatBoostRegressor(loss_function="MultiQuantile:alpha="+",".join(map(str,QUANTILES)),**params).fit(x,y)
    def predict(d):
        z=d[list(FEATURES)]; raw=np.asarray(q_model.predict(z)); ordered=np.sort(raw,axis=1)
        return np.asarray(mean_model.predict(z)),ordered,float(np.mean(np.any(np.diff(raw,axis=1)<0,axis=1)))
    cm,cq,cross=predict(cal)
    scores=np.maximum.reduce([cq[:,0]-cal.y.to_numpy(),cal.y.to_numpy()-cq[:,-1],np.zeros(len(cal))])
    scores=np.sort(scores);k=int(np.ceil((len(scores)+1)*.9))
    if k>len(scores): raise ValueError("insufficient calibration")
    expansion=float(scores[k-1])
    vm,vq,vcross=predict(val); actual=val.y.to_numpy()
    low=vq[:,0]-expansion;high=vq[:,-1]+expansion
    ridge=make_pipeline(StandardScaler(),Ridge(alpha=1.)).fit(x,y)
    rv=ridge.predict(val[list(FEATURES)])
    # Diagnostics only: no candidate selection, cost model, CVaR or trading gate.
    metrics={"horizon":h,"train_rows":len(train),"cal_rows":len(cal),"validation_rows":len(val),
       "validation_mae":float(np.mean(np.abs(vm-actual))),"zero_mae":float(np.mean(np.abs(actual))),
       "ridge_mae":float(np.mean(np.abs(rv-actual))),"cal_crossing":cross,"val_crossing":vcross,
       "coverage":float(np.mean((actual>=low)&(actual<=high))),"mean_width":float(np.mean(high-low)),
       "pinball":[float(np.mean(np.maximum(q*(actual-vq[:,i]),(q-1)*(actual-vq[:,i])))) for i,q in enumerate(QUANTILES)],
       "cqr_expansion":expansion,"paper_authorized":False}
    out=Path(out);out.mkdir(parents=True,exist_ok=False)
    mean_model.save_model(str(out/"mean.cbm"));q_model.save_model(str(out/"quantiles.cbm"))
    manifest={"status":"RESEARCH_ONLY","horizon":h,"start_utc_ms":int(start),"features":FEATURES,"seed":42,
              "model_files":{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in out.glob("*.cbm")},
              "metrics":metrics,"paper_authorized":False}
    (out/"manifest.json").write_text(json.dumps(manifest,indent=2,allow_nan=False),encoding="utf-8")
    return manifest

if __name__=="__main__":
    import argparse
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument("--input",nargs="+",required=True);p.add_argument("--start-utc-ms",type=int,required=True)
    p.add_argument("--output",required=True)
    a=p.parse_args()
    frame=load_minutes(a.input)
    if any(c not in frame for c in FEATURES): raise SystemExit("COLLECT_ONLY: incomplete structural features")
    for h in HORIZONS: print(json.dumps(fit_horizon(frame,h,a.start_utc_ms,Path(a.output)/str(h))))
