"""Fixed, retrospective forecast ablations. Only the host can run this catalog."""
from pathlib import Path
from shutil import disk_usage
from tempfile import TemporaryDirectory
from time import time_ns

from axiom_research import DAY, HORIZONS, MINUTE, fit_horizon, load_minutes
from axiom_science import canonical, digest

PROTOCOL = "paired-forecast-ablation-v1"
SIMPLE = ("logReturn", "realizedVol", "spread", "flow")
ADDITIONS = {
    "topology": ("h1_mass", "h1_cycles", "bottleneck_h0", "bottleneck_h1", "local_change", "centrality"),
    "liquidity": ("entropyBid", "entropyAsk", "w1Bid", "w1Ask"),
}
BLOCKERS = (
    "cost-aware replay and stress results",
    "untouched prospective holdout",
    "effective sample size and simultaneous confidence intervals",
    "human approval",
)
EXPERIMENT_LEASE_MS = 6 * 60 * MINUTE
MIN_FREE_BYTES = 2 * 1024**3


class ExperimentQueue:
    def __init__(self, store):
        self.store = store
        store.db.executescript("""
            CREATE TABLE IF NOT EXISTS forecast_experiments(
                id TEXT PRIMARY KEY,
                protocol TEXT NOT NULL,
                start_ms INTEGER NOT NULL,
                variant TEXT NOT NULL,
                horizon INTEGER NOT NULL,
                state TEXT NOT NULL,
                started_ms INTEGER,
                detail TEXT,
                evidence_id TEXT REFERENCES evidence(id)
            );
            CREATE INDEX IF NOT EXISTS forecast_experiments_protocol
                ON forecast_experiments(protocol,state,started_ms);
        """)

    def claim(self, cutoff, start):
        """Register the finite catalog once and claim at most one run per day."""
        with self.store.transaction():
            db = self.store.db
            db.execute("""
                UPDATE forecast_experiments SET state='INTERRUPTED',detail='lease expired'
                WHERE protocol=? AND state='RUNNING' AND started_ms<=?
            """, (PROTOCOL, cutoff - EXPERIMENT_LEASE_MS))
            anchor = db.execute(
                "SELECT start_ms FROM forecast_experiments WHERE protocol=? LIMIT 1", (PROTOCOL,),
            ).fetchone()
            if anchor is None:
                for horizon in HORIZONS:
                    for variant in ADDITIONS:
                        identity = digest((PROTOCOL, start, variant, horizon))
                        db.execute("""
                            INSERT INTO forecast_experiments(id,protocol,start_ms,variant,horizon,state)
                            VALUES(?,?,?,?,?,'QUEUED')
                        """, (identity, PROTOCOL, start, variant, horizon))
            if db.execute("""
                SELECT 1 FROM forecast_experiments WHERE protocol=?
                AND (state='RUNNING' OR started_ms>=?) LIMIT 1
            """, (PROTOCOL, cutoff - DAY)).fetchone():
                return None
            job = db.execute("""
                SELECT id,start_ms,variant,horizon FROM forecast_experiments
                WHERE protocol=? AND state='QUEUED' ORDER BY horizon,variant LIMIT 1
            """, (PROTOCOL,)).fetchone()
            if job is not None:
                db.execute("""
                    UPDATE forecast_experiments SET state='RUNNING',started_ms=? WHERE id=?
                """, (cutoff, job[0]))
            return job

    def finish(self, identity, ts, result):
        with self.store.transaction():
            job = self.store.db.execute(
                "SELECT state FROM forecast_experiments WHERE id=?", (identity,),
            ).fetchone()
            if job != ("RUNNING",):
                return None
            evidence_id = self.store.evidence("EXPERIMENT", ts, result)
            self.store.db.execute("""
                UPDATE forecast_experiments SET state=?,detail=?,evidence_id=? WHERE id=?
            """, (result["status"], canonical(result), evidence_id, identity))
            return evidence_id

    def status(self):
        rows = self.store.db.execute("""
            SELECT id,variant,horizon,state,evidence_id FROM forecast_experiments
            WHERE protocol=? ORDER BY horizon,variant
        """, (PROTOCOL,))
        return [
            dict(zip(("id", "variant", "horizon", "state", "evidence_id"), row))
            for row in rows
        ]


def run_next(store, paths, cutoff, state, quality, freeze_inputs):
    """Attempt one isolated paired diagnostic after a complete initial data window."""
    queue = ExperimentQueue(store)
    first = quality["first_minute"]
    start = first if first is None else ((first + DAY - 1) // DAY) * DAY
    end = None if start is None else start + 44 * DAY
    ready = (end is not None and cutoff >= end
             and quality["last_minute"] is not None and quality["last_minute"] >= end - MINUTE
             and quality["minute_days"] >= 44 and len(quality["symbols"]) >= 12)
    if not ready:
        return {"status": "WAITING_DATA", "jobs": queue.status()}
    if disk_usage(state).free < MIN_FREE_BYTES:
        return {"status": "DEFERRED_DISK", "jobs": queue.status()}
    job = queue.claim(cutoff, start)
    if job is None:
        return {"status": "IDLE", "jobs": queue.status()}
    identity, start, variant, horizon = job
    evaluation_end = start + 44 * DAY
    result = {
        "experiment_id": identity,
        "protocol": PROTOCOL,
        "mode": "RESEARCH_ONLY",
        "variant": variant,
        "horizon": horizon,
        "start_ms": start,
        "internal_validation_end_ms": evaluation_end,
        "status": "INCONCLUSIVE",
        "promotion_authorized": False,
        "paper_authorized": False,
        "blockers": BLOCKERS,
    }
    try:
        with TemporaryDirectory(prefix="experiment-", dir=state) as temporary:
            workspace = Path(temporary)
            snapshot, data_hash = freeze_inputs(paths, workspace / "dataset", evaluation_end)
            frame = load_minutes([snapshot])
            # Identical eligible observations, seed and splits in both arms. The
            # holdout begins after evaluation_end and is never passed to fitting.
            baseline = fit_horizon(
                frame, horizon, start, workspace / "baseline", features=SIMPLE, by_day=True, threads=1,
            )
            candidate = fit_horizon(
                frame, horizon, start, workspace / "candidate", features=SIMPLE + ADDITIONS[variant], by_day=True, threads=1,
            )
            paired = []
            baseline_days = baseline["metrics"]["daily_validation"]
            candidate_days = candidate["metrics"]["daily_validation"]
            for base_day, new_day in zip(baseline_days, candidate_days, strict=True):
                if (base_day["utc_day"], base_day["rows"]) != (new_day["utc_day"], new_day["rows"]):
                    raise ValueError("unpaired validation rows")
                paired.append({
                    "utc_day": base_day["utc_day"],
                    "rows": base_day["rows"],
                    "mae_improvement": base_day["mae"] - new_day["mae"],
                })
            result.update(data_sha256=data_hash, baseline=baseline, candidate=candidate,
                          paired_validation=paired)
    except (KeyError, ValueError) as error:
        result["failure_type"] = type(error).__name__
    except Exception as error:
        result.update(status="FAILED", failure_type=type(error).__name__)
    evidence_id = queue.finish(identity, max(cutoff, time_ns() // 1_000_000), result)
    return {
        "status": result["status"] if evidence_id else "INTERRUPTED",
        "evidence_id": evidence_id,
        "jobs": queue.status(),
    }
