from dataclasses import replace
import numpy as np
from axiom_policy import CandidateDetector,COMPONENTS,Gates,allocation_grid,cvar95,choose_allocation

def good():
    return Gates(True,True,True,True,True,True,True,True,.90,200,.1,.2,1.,40.)

def test_grid_and_veto():
    assert allocation_grid(12345,50000)==[0,5000,10000,12345]
    assert allocation_grid(200000,1)==[0,1]
    a=choose_allocation(replace(good(),holdout_valid=False),200000,10000000,np.zeros(800),{})
    assert a["debit_cents"]==0 and "HOLDOUT" in a["vetoes"]
    a=choose_allocation(good(),200000,10000000,np.zeros(799),{})
    assert a["reason"]=="JOINT_RISK_MISSING"

def test_joint_tail_risk_and_abstention():
    b=np.zeros(800)
    bad=np.full(800,20.);bad[:40]=-200
    assert cvar95(-bad)==200
    result=choose_allocation(good(),12000,100000,b,{(5,5000):bad,(15,10000):np.full(800,3.)})
    assert result["debit_cents"]==10000 and result["horizon"]==15
    assert choose_allocation(good(),12000,100000,b,{(5,5000):bad})["reason"]=="ABSTAIN"

def test_candidate_missing_and_zero_mad():
    d=CandidateDetector()
    assert d.observe("BTC",0,{})["reason"]=="MISSING_FEATURE"
    row={k:1. for group in COMPONENTS for k in group}
    # No calibrated floor: zero MAD must never become a candidate.
    for i in range(1,1442):out=d.observe("BTC",i*60000,row)
    assert out["reason"]=="ZERO_MAD_UNCALIBRATED" and not out["candidate"]
