"""Causal collector replay over frozen scientific decisions and recorded L2/FX."""

from collections import Counter, defaultdict, deque
from dataclasses import asdict, dataclass, field
from decimal import DecimalException
from hashlib import sha256
import json
from math import isfinite

from axiom_cycle import ShadowCycle
from axiom_ioc import Book, FX, Matcher, Rules, dec
from axiom_policy import Gates
from axiom_retention import open_log
from axiom_science import canonical, digest


@dataclass(frozen=True)
class ReplayDecision:
    ts: int
    symbol: str
    gates: Gates
    baseline_pnl: object
    scenarios: dict


def _vector(values):
    if not isinstance(values, list) or any(type(v) not in (int, float) or not isfinite(v) for v in values):
        raise ValueError("invalid scenario vector")
    return values


def load_decisions(path):
    """Read a frozen local JSON decision manifest for research replay."""
    with open(path, encoding="utf-8") as stream:
        raw = stream.read(128 * 1024 * 1024 + 1)
    if len(raw) > 128 * 1024 * 1024:
        raise ValueError("decision manifest exceeds size limit")
    records = json.loads(raw)
    if not isinstance(records, list):
        raise ValueError("decision manifest must be an array")
    decisions = []
    for item in records:
        if not isinstance(item, dict) or set(item) != {"ts", "symbol", "gates", "baseline_pnl", "scenarios"}:
            raise ValueError("invalid decision manifest row")
        if not isinstance(item["symbol"], str) or not item["symbol"].isascii() or not item["symbol"].isalnum():
            raise ValueError("invalid decision symbol")
        gates = Gates(**item["gates"])
        for name, value in asdict(gates).items():
            expected = Gates.__dataclass_fields__[name].type
            if expected is bool and type(value) is not bool:
                raise ValueError("invalid boolean gate")
            if expected is int and type(value) is not int:
                raise ValueError("invalid integer gate")
            if expected is float and (type(value) not in (int, float) or not isfinite(value)):
                raise ValueError("invalid numeric gate")
        scenarios = {}
        for scenario in item["scenarios"]:
            if not isinstance(scenario, dict) or set(scenario) != {"horizon", "debit_cents", "pnl"}:
                raise ValueError("invalid incremental scenario")
            key = (_integer(scenario["horizon"]), _integer(scenario["debit_cents"]))
            if key in scenarios:
                raise ValueError("duplicate incremental scenario")
            scenarios[key] = _vector(scenario["pnl"])
        decisions.append(ReplayDecision(_integer(item["ts"]), item["symbol"], gates,
                                        _vector(item["baseline_pnl"]), scenarios))
    return decisions


def _integer(value):
    if type(value) is not int or value < 0:
        raise ValueError("invalid market integer")
    return value


def _levels(values):
    if not isinstance(values, list):
        raise ValueError("invalid levels")
    result = {}
    for price, quantity in values:
        price, quantity = dec(price), dec(quantity)
        if price <= 0 or quantity < 0 or price in result:
            raise ValueError("invalid price level")
        result[price] = quantity
    return result


@dataclass
class Depth:
    sequence: int
    bids: dict = field(default_factory=dict)
    asks: dict = field(default_factory=dict)
    event: int = -1
    receive: int = -1

    def update(self, payload, now):
        first, last, event = map(_integer, (payload["U"], payload["u"], payload["E"]))
        if last <= self.sequence:
            return False
        if first > last or first > self.sequence + 1 or not 0 <= now - event <= 3000:
            raise ValueError("broken depth sequence or timestamp")
        for side, raw in ((self.bids, payload["b"]), (self.asks, payload["a"])):
            for price, quantity in _levels(raw).items():
                if quantity:
                    side[price] = quantity
                else:
                    side.pop(price, None)
            if len(side) > 30_000:
                raise ValueError("depth outside collector limits")
        self.sequence, self.event, self.receive = last, event, now
        return True

    def snapshot(self, symbol):
        return Book(symbol, self.sequence, self.event, self.receive,
                    tuple(self.bids.items()), tuple(self.asks.items()))


def _rules(payload):
    step, minimum, notional, maximum = (
        dec(payload[name]) for name in ("qty_step", "min_qty", "min_notional", "max_qty")
    )
    if not (0 < step <= maximum and 0 < minimum <= maximum and notional > 0):
        raise ValueError("invalid exchange rules")
    return Rules(step, minimum, notional, maximum)


class RecordedMarkets:
    def __init__(self):
        self.run = None
        self.books = {}
        self.pending_depth = defaultdict(lambda: deque(maxlen=10_000))
        self.rules = {}
        self.fx_symbol = None
        self.fx = None
        self.counts = Counter()

    def _clear(self):
        self.books.clear()
        self.pending_depth.clear()
        self.rules.clear()
        self.fx_symbol = self.fx = None

    def observe(self, record, now):
        run, kind, data = record["run_id"], record["kind"], record["data"]
        if run != self.run:
            self._clear()
            self.run = run
        if kind == "UNIVERSE":
            self._clear()
            self.fx_symbol = data.get("fxSymbol")
            exchange_rules = data.get("exchangeRules", {})
            for symbol, rule in exchange_rules.items():
                try:
                    self.rules[symbol] = _rules(rule)
                except (KeyError, TypeError, ValueError, DecimalException):
                    self.counts["invalid_rules"] += 1
            return None
        if kind == "SNAPSHOT":
            symbol, snapshot = data["symbol"], data["snapshot"]
            self.books.pop(symbol, None)
            depth = Depth(
                _integer(snapshot["lastUpdateId"]),
                {p: q for p, q in _levels(snapshot["bids"]).items() if q},
                {p: q for p, q in _levels(snapshot["asks"]).items() if q},
            )
            try:
                updates = sum(depth.update(delta, received)
                              for received, delta in self.pending_depth.pop(symbol, ()))
            except (KeyError, TypeError, ValueError, DecimalException):
                self.counts["depth_gaps"] += 1
                return None
            if updates:
                depth.receive = now
                self.counts["depth_updates"] += updates
            self.books[symbol] = depth
            return None
        if kind != "WS":
            return None
        symbol = data.get("s")
        if self.fx_symbol and symbol == self.fx_symbol and data.get("e") != "depthUpdate":
            self.fx = None
            bid, ask = dec(data["b"]), dec(data["a"])
            if 0 < bid <= ask:
                self.fx = FX(bid, ask, now, f"{run}:{symbol}:{data.get('u', now)}:{now}")
                self.counts["fx_updates"] += 1
            return None
        if data.get("e") != "depthUpdate" or not isinstance(symbol, str):
            return None
        if symbol not in self.books:
            self.pending_depth[symbol].append((now, data))
            return None
        try:
            if self.books[symbol].update(data, now):
                self.counts["depth_updates"] += 1
                return symbol
        except (KeyError, TypeError, ValueError, DecimalException):
            # A later diff cannot repair a gap. Require another REST snapshot.
            self.books.pop(symbol)
            self.counts["depth_gaps"] += 1
        return None

    def for_symbol(self, symbol, now):
        depth = self.books.get(symbol)
        if (depth is None or not 0 <= now - depth.event <= 3000 or not 0 <= now - depth.receive <= 3000
                or not depth.bids or not depth.asks):
            return None, "L2_UNAVAILABLE"
        if max(depth.bids) >= min(depth.asks):
            return None, "L2_UNAVAILABLE"
        if self.fx is None or not 0 <= now - self.fx.receive_ms <= 60_000:
            return None, "FX_UNAVAILABLE"
        if symbol not in self.rules:
            return None, "RULES_UNAVAILABLE"
        return (depth.snapshot(symbol), self.fx, self.rules[symbol]), None


def _records(paths, cutoff, source_digest, markets):
    previous = -1
    for path in paths:
        with open_log(path, "rb") as stream:
            for line in stream:
                if not line.endswith(b"\n"):
                    markets.counts["incomplete_records"] += 1
                    break
                try:
                    event = json.loads(line)
                    if event.get("operator_id") != "axiom-01" or event.get("schema_version") != 1:
                        raise ValueError("invalid collector envelope")
                    ts = _integer(event["ts_receive_utc"])
                    if ts > cutoff:
                        return
                    if ts < previous:
                        raise ValueError("out-of-order collector event")
                    if not isinstance(event["run_id"], str) or not event["run_id"]:
                        raise ValueError("missing run identifier")
                    previous = ts
                except (AttributeError, KeyError, TypeError, ValueError):
                    source_digest.update(line)
                    markets.counts["invalid_records"] += 1
                    markets._clear()
                    continue
                source_digest.update(line)
                yield ts, event


def _needs_book(cycle, symbol, now):
    return any(intent.symbol == symbol for intent, _ in cycle.pending.values()) or any(
        lot.symbol == symbol and lot.due <= now for lot in cycle.lots.values()
    )


def _expire(cycle, timestamp):
    cycle._advance(timestamp)
    for intent_id, (intent, _) in list(cycle.pending.items()):
        if intent.expiry_ms < timestamp:
            cycle._cancel(intent_id, timestamp, "EXPIRED")


def _decide(cycles, markets, decision, rejected):
    for cycle in cycles.values():
        _expire(cycle, decision.ts)
    market, reason = markets.for_symbol(decision.symbol, decision.ts)
    if reason:
        rejected[reason] += 1
        return
    for cycle in cycles.values():
        cycle.decide(decision.ts, decision.symbol, decision.gates, decision.baseline_pnl,
                     decision.scenarios, *market)


def _decision_hash(decisions):
    prefix = sha256()
    for decision in decisions:
        event = {
            "ts": decision.ts,
            "symbol": decision.symbol,
            "gates": asdict(decision.gates),
            "baseline_pnl": list(map(float, decision.baseline_pnl)),
            "scenarios": [
                [list(key), list(map(float, values))]
                for key, values in sorted(decision.scenarios.items())
            ],
        }
        prefix.update((canonical(event) + "\n").encode())
    return prefix.hexdigest() if decisions else None


def replay(paths, decisions, cutoff, *, scenarios=((500, 10, 0), (2000, 20, 10))):
    """Replay a frozen prefix, using only evidence received before each decision.

    Scenarios are (latency ms, fee bps per side, extra slippage bps).
    Decisions must be ordered and come from a causally frozen external protocol.
    This report cannot certify prospective performance or authorize paper trading.
    """
    _integer(cutoff)
    if not scenarios or len(set(scenarios)) != len(scenarios):
        raise ValueError("unique replay scenarios required")
    decisions = tuple(decisions)
    keys = [(_integer(d.ts), d.symbol) for d in decisions]
    if keys != sorted(set(keys)) or any(ts > cutoff for ts, _ in keys):
        raise ValueError("decisions must be unique, ordered and within the frozen prefix")

    markets, rejected, source_digest = RecordedMarkets(), Counter(), sha256()
    cycles = {scenario: ShadowCycle(Matcher(*scenario)) for scenario in scenarios}
    pending = iter(decisions)
    current = next(pending, None)
    if decisions:
        for ts, event in _records(paths, cutoff, source_digest, markets):
            # Equal-millisecond market events are not assumed available at decision time.
            while current is not None and current.ts <= ts:
                _decide(cycles, markets, current, rejected)
                current = next(pending, None)
            try:
                symbol = markets.observe(event, ts)
            except (AttributeError, KeyError, TypeError, ValueError, DecimalException):
                markets.counts["invalid_payloads"] += 1
                markets._clear()
                continue
            active = [cycle for cycle in cycles.values() if symbol and _needs_book(cycle, symbol, ts)]
            if active:
                market, unavailable = markets.for_symbol(symbol, ts)
                if unavailable:
                    continue
                for cycle in active:
                    cycle.on_book(ts, *market)
        while current is not None:
            _decide(cycles, markets, current, rejected)
            current = next(pending, None)

    results = []
    for (latency, fee, slip), cycle in cycles.items():
        _expire(cycle, cutoff)
        results.append({
            "latency_ms": latency,
            "fee_bps": fee,
            "slippage_bps": slip,
            "portfolio": cycle.status(),
            "events": dict(Counter(event["kind"] for event in cycle.history)),
            "event_sha256": digest(cycle.history),
        })
    blockers = []
    if not decisions:
        blockers.append("DECISIONS_UNAVAILABLE")
    else:
        blockers.extend(sorted(rejected))
        if not markets.counts["depth_updates"] and "L2_UNAVAILABLE" not in blockers:
            blockers.append("L2_UNAVAILABLE")
        if not markets.counts["fx_updates"] and "FX_UNAVAILABLE" not in blockers:
            blockers.append("FX_UNAVAILABLE")
    if any(markets.counts[k] for k in ("depth_gaps", "invalid_records", "invalid_payloads",
                                      "invalid_rules", "incomplete_records")):
        blockers.append("MARKET_INTEGRITY")
    if not all(result["events"].get("EXIT") for result in results):
        blockers.append("MISSING_REALIZED_EXITS")
    if any(cycle.pending or cycle.lots for cycle in cycles.values()):
        blockers.append("UNRESOLVED_EXPOSURE")
    return {
        "mode": "SHADOW_REPLAY",
        "as_of_ms": cutoff,
        "paper_authorized": False,
        "prospective_holdout": False,
        "collector_sha256": source_digest.hexdigest() if decisions else None,
        "decision_sha256": _decision_hash(decisions),
        "market": dict(markets.counts),
        "decisions": len(decisions),
        "skipped_decisions": dict(rejected),
        "blockers": blockers,
        "scenarios": results,
    }
