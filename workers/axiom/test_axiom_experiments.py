from pathlib import Path

import axiom_experiments
from axiom_experiments import DAY, ExperimentQueue, run_next
from axiom_science import Science


def test_experiment_waits_for_data(tmp_path):
    store = Science(tmp_path / "science.db")
    quality = {"first_minute": 123, "last_minute": 43 * DAY, "minute_days": 43, "symbols": list(range(12))}
    assert run_next(store, [], 45 * DAY, tmp_path, quality, None) == {
        "status": "WAITING_DATA", "jobs": [],
    }
    store.close()


def test_runs_one_causal_pair_and_persists_inconclusive_evidence(tmp_path, monkeypatch):
    store = Science(tmp_path / "science.db")
    cutoff = 46 * DAY
    calls = []

    def freeze(paths, target, as_of):
        assert paths == ["retained.ndjson"]
        assert as_of == 45 * DAY
        return target / "minutes.ndjson", "a" * 64

    def fit(frame, horizon, start, output, *, features, by_day, threads):
        assert start == DAY
        assert horizon == 5 and by_day and threads == 1
        calls.append((Path(output).name, features))
        return {"features": features, "metrics": {
            "validation_mae": 0.01,
            "daily_validation": [{"utc_day": 40, "rows": 24, "mae": 0.01}],
        }}

    monkeypatch.setattr(axiom_experiments, "MIN_FREE_BYTES", 0)
    monkeypatch.setattr(axiom_experiments, "time_ns", lambda: (cutoff + 1) * 1_000_000)
    monkeypatch.setattr(axiom_experiments, "load_minutes", lambda paths: None)
    monkeypatch.setattr(axiom_experiments, "fit_horizon", fit)
    quality = {"first_minute": 1, "last_minute": 46 * DAY, "minute_days": 46, "symbols": list(range(12))}
    result = run_next(store, ["retained.ndjson"], cutoff, tmp_path, quality, freeze)
    assert result["status"] == "INCONCLUSIVE"
    assert len(result["jobs"]) == 10
    assert calls[1][1] == calls[0][1] + axiom_experiments.ADDITIONS["liquidity"]
    assert not store.context(cutoff)
    evidence = store.context(cutoff + 1)[0]
    assert evidence["id"] == result["evidence_id"]
    assert not evidence["body"]["promotion_authorized"]
    assert not evidence["body"]["paper_authorized"]
    assert evidence["body"]["data_sha256"] == "a" * 64
    assert evidence["body"]["paired_validation"] == [
        {"utc_day": 40, "rows": 24, "mae_improvement": 0.0},
    ]
    assert not list(tmp_path.glob("experiment-*"))
    store.close()

    store = Science(tmp_path / "science.db")
    assert run_next(store, [], cutoff + 1, tmp_path, quality, None)["status"] == "IDLE"
    store.close()


def test_expired_claim_cannot_write_evidence(tmp_path):
    store = Science(tmp_path / "science.db")
    queue = ExperimentQueue(store)
    cutoff = 45 * DAY
    first = queue.claim(cutoff, 0)
    assert queue.claim(cutoff + 1, 0) is None
    next_job = queue.claim(cutoff + DAY + 1, 0)
    assert next_job[0] != first[0]
    assert queue.status()[0]["state"] == "INTERRUPTED"
    assert queue.finish(first[0], cutoff, {"status": "INCONCLUSIVE"}) is None
    assert not store.context(cutoff + DAY + 1)
    store.close()
