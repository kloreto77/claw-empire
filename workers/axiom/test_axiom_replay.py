from dataclasses import asdict, replace
import json

from axiom_policy import Gates
from axiom_replay import ReplayDecision, load_decisions, replay
import pytest


T = 1764172800000
SYMBOL = "BTCUSDT"


def decision():
    gates = Gates(True, True, True, True, True, True, True, True, .9, 200, .01, .02, 1., 40.)
    return ReplayDecision(T, SYMBOL, gates, [0.] * 800, {(5, 50000): [5.] * 800})


def rows(*, include_fx=True, include_rules=True, gap=False):
    rules = {SYMBOL: {"qty_step": ".001", "min_qty": ".001", "max_qty": "100", "min_notional": "5"}}
    events = [
        (T - 200, "UNIVERSE", {"fxSymbol": "USDTBRL", "exchangeRules": rules if include_rules else {}}),
        (T - 190, "SNAPSHOT", {"symbol": SYMBOL, "snapshot": {
            "lastUpdateId": 4, "bids": [["99", "100"]], "asks": [["100", "100"]],
        }}),
    ]
    if include_fx:
        events.append((T - 100, "WS", {"s": "USDTBRL", "u": 10, "b": "5.00", "a": "5.01"}))
    for sequence, offset in [(5, -1), (9 if gap else 6, 499), (7, 500), (8, 2000)]:
        events.append((T + offset, "WS", {
            "s": SYMBOL, "e": "depthUpdate", "U": sequence, "u": sequence, "E": T + offset,
            "b": [], "a": [],
        }))
    if include_fx:
        events.append((T + 300000, "WS", {"s": "USDTBRL", "u": 11, "b": "5.00", "a": "5.01"}))
    for sequence, offset in [(9, 300500), (10, 302000)]:
        events.append((T + offset, "WS", {
            "s": SYMBOL, "e": "depthUpdate", "U": sequence, "u": sequence, "E": T + offset,
            "b": [], "a": [],
        }))
    return events


def log(path, events):
    path.write_text("".join(json.dumps({
        "operator_id": "axiom-01", "schema_version": 1, "run_id": "a",
        "ts_receive_utc": timestamp, "kind": kind, "data": data,
    }) + "\n" for timestamp, kind, data in events), encoding="utf-8")
    return path


def test_replay_has_deterministic_costed_fills(tmp_path):
    path = log(tmp_path / "capture.ndjson", rows())
    end = T + 302000
    result = replay([path], [decision()], end)
    assert result == replay([path], [decision()], end)
    assert not result["paper_authorized"] and not result["prospective_holdout"]
    assert result["blockers"] == []
    standard, stress = result["scenarios"]
    assert standard["events"]["ENTRY"] == standard["events"]["EXIT"] == 1
    assert stress["events"]["ENTRY"] == stress["events"]["EXIT"] == 1
    assert float(stress["portfolio"]["realized_brl"]) < float(standard["portfolio"]["realized_brl"]) < 0
    truncated = replay([path], [decision()], T + 499)
    assert "ENTRY" not in truncated["scenarios"][0]["events"]


@pytest.mark.parametrize("flags,reason", [
    ({"include_fx": False}, "FX_UNAVAILABLE"),
    ({"include_rules": False}, "RULES_UNAVAILABLE"),
    ({"gap": True}, "MARKET_INTEGRITY"),
])
def test_never_invents_exchange_evidence(tmp_path, flags, reason):
    path = log(tmp_path / "capture.ndjson", rows(**flags))
    result = replay([path], [decision()], T + 302000)
    assert reason in result["blockers"]
    assert all("ENTRY" not in scenario["events"] for scenario in result["scenarios"])


def test_replay_cannot_override_gates_or_read_later_quotes(tmp_path):
    path = log(tmp_path / "capture.ndjson", rows())
    pending = decision()
    result = replay([path], [replace(pending, gates=replace(pending.gates, human_approved=False))], T + 302000)
    assert all("RESERVE" not in scenario["events"] for scenario in result["scenarios"])
    result = replay([path], [replace(pending, ts=T-100)], T + 302000)
    assert "L2_UNAVAILABLE" in result["blockers"]


def test_manifest_roundtrip_and_empty_status(tmp_path):
    pending = decision()
    path = tmp_path / "decisions.json"
    path.write_text(json.dumps([{
        "symbol": pending.symbol, "ts": pending.ts, "gates": asdict(pending.gates),
        "baseline_pnl": pending.baseline_pnl, "scenarios": [
            {"horizon": 5, "debit_cents": 50000, "pnl": pending.scenarios[(5, 50000)]},
        ],
    }]), encoding="utf-8")
    assert load_decisions(path) == [pending]
    assert "DECISIONS_UNAVAILABLE" in replay([], [], T)["blockers"]


def test_replay_buffers_book_diffs_until_snapshot_is_known(tmp_path):
    events = rows()
    timestamp, kind, snapshot = events.pop(1)
    events.insert(3, (T, kind, snapshot))
    path = log(tmp_path / "capture.ndjson", events)
    pending = replace(decision(), ts=T + 1)
    result = replay([path], [pending], T + 303000)
    assert result["scenarios"][0]["events"]["ENTRY"] == 1
    without_snapshot = replay([path], [decision()], T + 303000)
    assert "L2_UNAVAILABLE" in without_snapshot["blockers"]
