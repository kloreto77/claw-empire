import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { AxiomLedger, localDay, QTY_SCALE, type IocSettlement } from "./axiom-ledger.ts";

type Snapshot = {
  run_id: string;
  book: { symbol: string; seq: number; event_ms: number; receive_ms: number; bids: string[][]; asks: string[][] };
  fx: { bid: string; ask: string; receive_ms: number; snapshot_id: string };
  rules: { qty_step: string; min_qty: string; min_notional: string; max_qty: string };
};

type Intent = {
  id: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: string;
  decision_ms: number;
  expiry_ms: number;
  reserveCents: number;
  strategyVersion: string;
  modelVersion: string;
  paperOnly: true;
};

type MatchRequest = Omit<Snapshot, "run_id"> & {
  intent: Pick<Intent, "id" | "symbol" | "side" | "quantity" | "decision_ms" | "expiry_ms"> &
    { reservation_brl: string; held_quantity: string };
  now_ms: number;
};

const resultKinds = ["FILLED", "PARTIAL_CANCELLED", "CANCELLED"] as const;
type MatchResult = {
  id: string;
  status: IocSettlement["result"];
  reason: string;
  qty: string;
  gross_brl: string;
  fee_brl: string;
  average_price: string | null;
  sequence: number;
  fx_snapshot_id: string;
};

type PaperPolicy = {
  // Supplied only by Mesa's internal authorization and quantitative execution
  // path. Neither agent requests nor supervisor reports can supply these checks.
  approved: (strategy: string, model: string, now: number) => boolean;
  checkEntry: (intent: Intent, market: Snapshot, state: ReturnType<AxiomLedger["status"]>, now: number) => boolean;
};

function fromUnits(amount: number, scale: number) {
  const width = scale === QTY_SCALE ? 8 : 2;
  const base = BigInt(scale);
  const units = BigInt(amount);
  return `${units / base}.${String(units % base).padStart(width, "0")}`;
}

function toUnits(amount: unknown, decimals: number) {
  if (typeof amount !== "string" || !/^\d{1,16}(?:\.\d{1,18})?$/.test(amount)) throw Error("decimal IOC inválido");
  const [whole, fraction = ""] = amount.split(".");
  if (/[1-9]/.test(fraction.slice(decimals))) throw Error("precisão IOC não suportada");
  const units = Number(BigInt(whole) * BigInt(10 ** decimals) + BigInt(fraction.slice(0, decimals).padEnd(decimals, "0")));
  if (!Number.isSafeInteger(units)) throw Error("valor IOC excede a precisão contábil");
  return units;
}

function validResult(result: MatchResult, request: MatchRequest) {
  return result?.id === request.intent.id &&
    resultKinds.includes(result.status) &&
    /^[A-Z_]{1,64}$/.test(result.reason) &&
    result.sequence === request.book.seq &&
    result.fx_snapshot_id === request.fx.snapshot_id;
}

export function runAxiomMatcher(request: MatchRequest): Promise<MatchResult> {
  const executable = fileURLToPath(new URL("../../axiom-worker/axiom-worker.exe", import.meta.url));
  const input = JSON.stringify(request);
  if (Buffer.byteLength(input) > 4 * 1024 * 1024) throw Error("livro IOC excede o limite de transporte");
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {};
    for (const name of ["SystemRoot", "WINDIR", "PATH", "TEMP", "TMP", "TZ"]) {
      if (process.env[name]) env[name] = process.env[name];
    }
    env.PYTHONUTF8 = "1";
    const child = spawn(executable, ["--data", ".", "--state", ".", "ioc"], {env, windowsHide: true, stdio: ["pipe", "pipe", "ignore"]});
    let output = "";
    const deadline = setTimeout(() => {
      child.kill();
      reject(Error("tempo limite do simulador IOC"));
    }, 2500);
    deadline.unref();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      output += chunk;
      if (output.length > 16384) {
        child.kill();
        reject(Error("resposta IOC excedeu o limite"));
      }
    });
    child.on("error", reject);
    child.stdin.on("error", reject);
    child.on("close", code => {
      clearTimeout(deadline);
      if (code !== 0) return reject(Error("simulador IOC indisponível"));
      try {
        resolve(JSON.parse(output) as MatchResult);
      } catch {
        reject(Error("resposta IOC inválida"));
      }
    });
    child.stdin.end(input);
  });
}

const latestSnapshot = (snapshot: Snapshot, now: number) =>
  now - snapshot.book.receive_ms >= 0 && now - snapshot.book.receive_ms <= 3000 &&
  now - snapshot.book.event_ms >= 0 && now - snapshot.book.event_ms <= 3000 &&
  now - snapshot.fx.receive_ms >= 0 && now - snapshot.fx.receive_ms <= 60000;

export function createAxiomPaperExecution(
  ledger: AxiomLedger,
  policy?: PaperPolicy,
  match = runAxiomMatcher,
  clock = Date.now,
) {
  let paused = true;
  let busy = false;
  let generation = 0;
  const status = (ts = clock()) => ({
    ...ledger.status(ts),
    execution: { paused, busy, authorityAvailable: Boolean(policy) },
  });
  function pause() {
    paused = true;
    generation++;
  }
  function resume() {
    if (policy) paused = false;
  }
  async function execute(intent: Intent, market: Snapshot) {
    if (!policy || intent.paperOnly !== true) throw Error("carteira sem autorização científica e humana");
    const buying = intent.side === "buy";
    const id = intent.id;
    const fingerprint = createHash("sha256").update(JSON.stringify([
      intent.symbol, intent.side, intent.quantity, intent.decision_ms, intent.expiry_ms,
      intent.reserveCents, intent.strategyVersion, intent.modelVersion, market.run_id,
      market.book.seq, market.book.event_ms, market.book.receive_ms, market.book.bids, market.book.asks,
      market.fx.snapshot_id, market.fx.receive_ms, market.fx.bid, market.fx.ask,
      market.rules.qty_step, market.rules.min_qty, market.rules.min_notional, market.rules.max_qty,
    ])).digest("hex");
    const previous = ledger.iocReceipt(id, fingerprint);
    if (previous) return previous;
    if (busy) throw Error("simulador IOC ocupado");

    const quantity = toUnits(intent.quantity, 8);
    if (
      !/^[A-Za-z0-9:_-]{1,96}$/.test(id) || !/^[A-Z0-9]+USDT$/.test(intent.symbol) ||
      (intent.side !== "buy" && intent.side !== "sell") || market.book.symbol !== intent.symbol ||
      !Number.isSafeInteger(intent.decision_ms) || !Number.isSafeInteger(intent.expiry_ms) ||
      intent.expiry_ms <= intent.decision_ms || intent.expiry_ms - intent.decision_ms > 5000 || quantity <= 0 ||
      (!buying && intent.reserveCents !== 0)
    ) throw Error("intenção IOC inválida");

    const epoch = generation;
    const check = (now: number) => {
      if (!latestSnapshot(market, now) || intent.expiry_ms < now || now < intent.decision_ms + 500 ||
          market.book.receive_ms < intent.decision_ms + 500 || toUnits(market.fx.bid, 8) <= 0 ||
          toUnits(market.fx.ask, 8) < toUnits(market.fx.bid, 8)) throw Error("mercado IOC vencido ou inválido");
      const state = ledger.status(now);
      const held = state.positions.find(p => p.symbol === intent.symbol)?.qty ?? 0;
      if (buying) {
        if (paused || epoch !== generation || localDay(intent.decision_ms) !== state.day ||
            !policy.approved(intent.strategyVersion, intent.modelVersion, now) ||
            !policy.checkEntry(intent, market, state, now)) throw Error("entrada vetada");
        if (!Number.isSafeInteger(intent.reserveCents) || intent.reserveCents <= 0 ||
            intent.reserveCents > state.remaining || intent.reserveCents > state.availableCash) throw Error("orçamento ou caixa insuficiente");
      } else if (quantity > held) throw Error("venda sem posição");
      return held;
    };

    busy = true;
    try {
      const start = clock();
      const held = check(start);
      const request: MatchRequest = {
        book: market.book, fx: market.fx, rules: market.rules, now_ms: start,
        intent: {id, symbol: intent.symbol, side: intent.side, quantity: intent.quantity,
          decision_ms: intent.decision_ms, expiry_ms: intent.expiry_ms,
          reservation_brl: fromUnits(intent.reserveCents, 100), held_quantity: fromUnits(held, QTY_SCALE)},
      };
      const result = await match(request);
      if (!validResult(result, request)) throw Error("resposta IOC inválida");
      const qty = toUnits(result.qty, 8);
      if (qty > quantity || (result.status === "FILLED" && qty !== quantity) ||
          (result.status === "PARTIAL_CANCELLED" && qty >= quantity)) throw Error("quantidade IOC inválida");
      const now = clock();
      check(now);
      return ledger.settleIoc({
        id, fingerprint, side: intent.side, symbol: intent.symbol, runId: market.run_id,
        reservation: intent.reserveCents, qty, amount: toUnits(result.gross_brl, 2), fee: toUnits(result.fee_brl, 2),
        sequence: result.sequence, fxSnapshotId: result.fx_snapshot_id, averagePrice: result.average_price,
        result: result.status, reason: result.reason,
      }, now);
    } finally {
      busy = false;
    }
  }
  return {status, pause, resume, execute};
}
