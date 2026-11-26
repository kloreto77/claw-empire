"""Deterministic AXIOM V1 candidate and allocation gates (research only).
No order access. Scenario vectors must be causally aligned joint BRL P&L
from the same replay observations, net of prospective costs.
"""
from dataclasses import dataclass
from decimal import Decimal
import numpy as np
from collections import deque

COMPONENTS=(
 ("bottleneck_h0","bottleneck_h1","h1_mass","h1_cycles","local_change"),
 ("w1Bid","w1Ask","massBid","massAsk","spread"),
 ("entropyBid","entropyAsk","flow"),
)
class CandidateDetector:
    def __init__(self):
        self.history={}
    def observe(self,symbol,end,values):
        if not isinstance(end,int) or end%60000:raise ValueError("invalid minute")
        state=self.history.setdefault(symbol,{"last":-1,"rows":deque(),"scores":deque(),"signal":-1})
        if end<=state["last"]:raise ValueError("duplicate or noncausal observation")
        state["last"]=end
        cutoff=end-7*86400000
        for k in ("rows","scores"):
            while state[k] and state[k][0][0]<cutoff:state[k].popleft()
        names=[k for group in COMPONENTS for k in group]
        if any(k not in values or not np.isfinite(values[k]) for k in names):
            return {"candidate":False,"reason":"MISSING_FEATURE"}
        row=np.array([values[k] for k in names],dtype=float)
        history=state["rows"]
        result={"candidate":False,"reason":"ROBUST_WARMUP"}
        if len(history)>=1440:
            past=np.array([v for _,v in history]);median=np.median(past,axis=0)
            scale=1.4826*np.median(np.abs(past-median),axis=0)
            if np.all(scale>0):
                z=(row-median)/scale
                groups=np.split(np.abs(z),np.cumsum([len(g) for g in COMPONENTS])[:-1])
                components=[float(np.mean(g)) for g in groups];score=float(np.mean(components))
                scores=state["scores"]
                result={"candidate":False,"score":score,"components":components,"signed_z":dict(zip(names,map(float,z))),"reason":"SCORE_WARMUP"}
                if len(scores)>=1440:
                    threshold=float(np.quantile([v for _,v in scores],.95))
                    result.update(threshold=threshold,reason="BELOW_THRESHOLD")
                    if score>threshold:
                        if state["signal"]>=0 and end-state["signal"]<5*60000:result["reason"]="DEDUP"
                        else:
                            result.update(candidate=True,reason="STRUCTURAL_CANDIDATE");state["signal"]=end
                scores.append((end,score))
            else:result["reason"]="ZERO_MAD_UNCALIBRATED"
        history.append((end,row))
        return result

@dataclass(frozen=True)
class Gates:
    # Internal engineering certification flags, never inferred from LLM output.
    integrity:bool
    fx_fresh:bool
    book_fresh:bool
    version_valid:bool
    holdout_valid:bool
    human_approved:bool
    candidate:bool
    drift_ok:bool
    coverage:float
    mature_forecasts:int
    width:float
    width_p90:float
    net_mean_lcb:float
    effective_tail:float
    paused:bool=False
    def vetoes(self):
        flags={"INTEGRITY":self.integrity,"FX":self.fx_fresh,"BOOK":self.book_fresh,"VERSION":self.version_valid,
          "HOLDOUT":self.holdout_valid,"APPROVAL":self.human_approved,"CANDIDATE":self.candidate,"DRIFT":self.drift_ok,
          "COVERAGE":np.isfinite(self.coverage) and .85<=self.coverage<=1 and self.mature_forecasts>=200,
          "WIDTH":np.isfinite(self.width) and np.isfinite(self.width_p90) and 0<=self.width<=self.width_p90,
          "NET_MEAN_LCB":np.isfinite(self.net_mean_lcb) and self.net_mean_lcb>0,
          "EFFECTIVE_TAIL":np.isfinite(self.effective_tail) and self.effective_tail>=40,"PAUSED":not self.paused}
        return [k for k,v in flags.items() if not v]

def cvar95(losses):
    a=np.asarray(losses,dtype=float)
    if a.ndim!=1 or len(a)<800 or not np.isfinite(a).all():raise ValueError("insufficient valid joint scenarios")
    # Exact empirical upper 5% average, including fractional last observation.
    a=np.sort(a)[::-1];mass=len(a)*.05;n=int(mass);fraction=mass-n
    return float((a[:n].sum()+fraction*a[n] if fraction else a[:n].sum())/mass)

def allocation_grid(remaining_cents,cash_cents):
    if any(not isinstance(v,int) or v<0 for v in (remaining_cents,cash_cents)):raise ValueError("invalid balance")
    cap=min(remaining_cents,cash_cents,200000)
    return sorted(set([0,*range(5000,cap+1,5000),cap]))

def choose_allocation(gates,remaining_cents,cash_cents,baseline_pnl,scenarios):
    """Scenarios keyed by (horizon minutes, debit cents), with incremental net P&L
    vectors aligned to baseline_pnl. This function cannot authorize a fill."""
    veto=gates.vetoes()
    if veto:return {"debit_cents":0,"reason":"VETO","vetoes":veto}
    grid=set(allocation_grid(remaining_cents,cash_cents))
    baseline=np.asarray(baseline_pnl,dtype=float)
    try:base_risk=cvar95(-baseline)
    except ValueError:return {"debit_cents":0,"reason":"JOINT_RISK_MISSING"}
    best={"debit_cents":0,"utility_brl":0.0,"reason":"ABSTAIN"}
    for (h,q),incremental in sorted(scenarios.items()):
        if h not in (5,15,30,60,120) or q not in grid or q<=0:continue
        inc=np.asarray(incremental,dtype=float)
        if inc.shape!=baseline.shape or not np.isfinite(inc).all():continue
        expected=float(inc.mean())
        if expected<=0:continue
        delta=cvar95(-(baseline+inc))-base_risk
        u=expected-.5*max(0,delta)
        if u>best["utility_brl"]:
            best={"debit_cents":q,"horizon":h,"utility_brl":u,"expected_net_brl":expected,
                  "incremental_cvar_brl":delta,"reason":"RESEARCH_CANDIDATE"}
    return best
