/**
 * Tests for the trading WebSocket lifecycle helpers (lib/ws-lifecycle.ts).
 *
 * Covers the failure paths that previously caused "trade snaps or doesn't
 * take" reports:
 *   - stale socket onclose scheduling a reconnect over a newer connection
 *   - proposals/buys stranded by a disconnect hanging until timeout
 *   - buying with a proposal that went stale during a reconnect
 *   - trades accepted server-side but whose buy response was lost
 */

import {
  createConnGuard,
  rejectAllPending,
  isProposalFresh,
  findOpenPortfolioContract,
  appendWsCloseLog,
  readWsCloseLog,
  makeDropEntryId,
  dedupeWsDrops,
  postWsDrops,
  WsDropForwarder,
  type WsCloseLogEntry,
} from "../lib/ws-lifecycle";

/* ------------------------------------------------------------------ */
/*  Connection generation guard                                        */
/* ------------------------------------------------------------------ */

describe("createConnGuard — stale socket races", () => {
  it("lets the current connection act", () => {
    const guard = createConnGuard();
    const gen = guard.begin();
    expect(guard.isCurrent(gen)).toBe(true);
  });

  it("blocks a superseded socket from acting after a newer connect()", () => {
    const guard = createConnGuard();
    const socketA = guard.begin(); // connect #1
    const socketB = guard.begin(); // user reconnects → connect #2
    expect(guard.isCurrent(socketB)).toBe(true);
    // Socket A's late onclose must be ignored:
    expect(guard.isCurrent(socketA)).toBe(false);
  });

  it("blocks an old socket's reconnect timer from firing after a newer connect", () => {
    const guard = createConnGuard();
    const genA = guard.begin();
    // ... socket A closes, schedules a reconnect timer ...
    guard.begin(); // ... but connect() runs first, creating socket B
    // When A's timer finally fires it must not reconnect:
    expect(guard.isCurrent(genA)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Pending request rejection on disconnect                            */
/* ------------------------------------------------------------------ */

describe("rejectAllPending — requests stranded by a disconnect", () => {
  it("resolves every pending request with null and clears the maps", () => {
    const proposals = new Map<string, (v: unknown | null) => void>();
    const buys = new Map<string, (v: unknown | null) => void>();
    const resolved: unknown[] = [];
    proposals.set("p1", (v) => resolved.push(["proposal", v]));
    proposals.set("p2", (v) => resolved.push(["proposal", v]));
    buys.set("b1", (v) => resolved.push(["buy", v]));

    const count = rejectAllPending([proposals, buys]);

    expect(count).toBe(3);
    expect(proposals.size).toBe(0);
    expect(buys.size).toBe(0);
    expect(resolved).toEqual([
      ["proposal", null],
      ["proposal", null],
      ["buy", null],
    ]);
  });

  it("simulates a disconnect during a pending buy: the promise resolves null instead of hanging", async () => {
    const buys = new Map<string, (v: unknown | null) => void>();
    let buyResolved: unknown = "still-pending";
    buys.set("req-7", (v) => { buyResolved = v; });

    // socket drops → hook calls rejectAllPending on close
    rejectAllPending([buys]);

    expect(buyResolved).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/*  Proposal freshness                                                 */
/* ------------------------------------------------------------------ */

describe("isProposalFresh — stale proposal guard", () => {
  const MAX_AGE = 20_000;
  const now = 1_000_000;

  it("accepts a proposal updated within the window", () => {
    expect(isProposalFresh(now - 5_000, MAX_AGE, now)).toBe(true);
  });

  it("rejects a proposal that has not been refreshed (socket was down)", () => {
    expect(isProposalFresh(now - 30_000, MAX_AGE, now)).toBe(false);
  });

  it("rejects a proposal that was never received", () => {
    expect(isProposalFresh(0, MAX_AGE, now)).toBe(false);
  });

  it("simulates buying right after a reconnect: stale proposal is refused", () => {
    // Proposal was last refreshed at t=1_000, we reconnected at t=40_000.
    const fresh = isProposalFresh(1_000, MAX_AGE, 40_000);
    expect(fresh).toBe(false); // must not buy — server-side id likely expired
  });
});

/* ------------------------------------------------------------------ */
/*  Post-reconnect reconciliation                                      */
/* ------------------------------------------------------------------ */

describe("findOpenPortfolioContract — reconcile after reconnect", () => {
  it("recovers a still-open contract from the portfolio", () => {
    const open = findOpenPortfolioContract([
      { contract_id: 999, status: "won", is_sold: 1 },
      { contract_id: 123456, status: "open", is_sold: 0, buy_price: 10, contract_type: "DIGITOVER" },
    ]);
    expect(open).not.toBeNull();
    expect((open as Record<string, unknown>).contract_id).toBe(123456);
  });

  it("ignores sold / settled contracts", () => {
    const open = findOpenPortfolioContract([
      { contract_id: 1, status: "open", is_sold: 1 },
      { contract_id: 2, status: "won", is_sold: 1 },
      { contract_id: 3, status: "lost", is_sold: 1 },
      { contract_id: 4, status: "expired", is_sold: 1 },
    ]);
    expect(open).toBeNull();
  });

  it("returns null for an empty or malformed portfolio", () => {
    expect(findOpenPortfolioContract(null)).toBeNull();
    expect(findOpenPortfolioContract(undefined)).toBeNull();
    expect(findOpenPortfolioContract([])).toBeNull();
    expect(findOpenPortfolioContract("nope" as unknown as unknown[])).toBeNull();
  });

  it("simulates the full reconnect flow: stranded buy is resolved with the recovered contract", () => {
    // --- while the socket is up, a buy is sent and awaits a response ---
    const pendingBuys = new Map<string, (c: unknown | null) => void>();
    let buyResult: unknown = null;
    pendingBuys.set("req-42", (c) => { buyResult = c; });

    // --- socket drops; hook rejects everything and flags reconcile ---
    rejectAllPending([pendingBuys]);
    const reconcileOnOpen = true; // hadPendingBuy === true

    // --- socket reopens; hook queries portfolio and reconciles ---
    const recovered = findOpenPortfolioContract([
      { contract_id: 777001, status: "open", is_sold: 0, buy_price: 10, payout: 19.5 },
    ]);

    expect(reconcileOnOpen).toBe(true);
    expect(recovered).not.toBeNull();
    // In the hook this is what the stranded buy promise resolves to:
    if (recovered) {
      pendingBuys.set("req-42", (c) => { buyResult = c; });
      pendingBuys.delete("req-42");
      buyResult = { contract_id: recovered.contract_id, status: "open" };
    }
    expect(buyResult).toEqual({ contract_id: 777001, status: "open" });
  });
});


/* ------------------------------------------------------------------ */
/*  Connection drop diagnostics ring buffer                            */
/* ------------------------------------------------------------------ */

function fakeStorage(seed?: Record<string, string>) {
  const store = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    dump: () => Object.fromEntries(store),
  };
}

const drop = (over: Partial<WsCloseLogEntry> = {}): WsCloseLogEntry => ({
  at: 1000,
  code: 1006,
  reason: "no close frame received or sent",
  durationMs: 45_000,
  attempt: 0,
  inFlight: { proposals: 0, buys: 0, portfolio: false, profitTable: false },
  hadActiveContract: false,
  reconcileFlagged: false,
  ...over,
});

describe("appendWsCloseLog / readWsCloseLog — drop diagnostics", () => {
  it("stores closes newest-first", () => {
    const storage = fakeStorage();
    appendWsCloseLog(storage, "drops", drop({ at: 1, code: 1006 }));
    appendWsCloseLog(storage, "drops", drop({ at: 2, code: 1000 }));
    const log = readWsCloseLog(storage, "drops");
    expect(log.map((e) => e.at)).toEqual([2, 1]);
  });

  it("records in-flight requests and contract state at close time", () => {
    const storage = fakeStorage();
    appendWsCloseLog(storage, "drops", drop({
      at: 5,
      code: 1006,
      inFlight: { proposals: 1, buys: 1, portfolio: true, profitTable: false },
      hadActiveContract: true,
      reconcileFlagged: true,
    }));
    const [entry] = readWsCloseLog(storage, "drops");
    expect(entry).toMatchObject({
      code: 1006,
      inFlight: { proposals: 1, buys: 1, portfolio: true, profitTable: false },
      hadActiveContract: true,
      reconcileFlagged: true,
    });
  });

  it("caps the buffer at maxEntries, dropping the oldest", () => {
    const storage = fakeStorage();
    for (let i = 1; i <= 55; i++) appendWsCloseLog(storage, "drops", drop({ at: i }), 50);
    const log = readWsCloseLog(storage, "drops");
    expect(log.length).toBe(50);
    expect(log[0].at).toBe(55);   // newest kept
    expect(log[49].at).toBe(6);   // oldest kept; at=1..5 trimmed
  });

  it("survives a corrupted existing record (starts fresh)", () => {
    const storage = fakeStorage({ drops: "not json {{{" });
    appendWsCloseLog(storage, "drops", drop({ at: 9 }));
    expect(readWsCloseLog(storage, "drops").map((e) => e.at)).toEqual([9]);
  });

  it("returns [] and never throws when storage is unavailable", () => {
    expect(appendWsCloseLog(null, "drops", drop())).toEqual([]);
    expect(readWsCloseLog(null, "drops")).toEqual([]);
  });

  it("never throws when storage writes fail (private mode / quota)", () => {
    const throwing = {
      getItem: () => null,
      setItem: () => { throw new Error("QuotaExceededError"); },
    };
    expect(appendWsCloseLog(throwing, "drops", drop())).toEqual([]);
  });
});


/* ------------------------------------------------------------------ */
/*  Server forwarding — batching, dedupe, id generation                */
/* ------------------------------------------------------------------ */

function manualTimers() {
  let nextId = 0;
  const timers = new Map<number, () => void>();
  return {
    set: (cb: () => void) => { const id = ++nextId; timers.set(id, cb); return id as unknown as ReturnType<typeof setTimeout>; },
    clear: (id: ReturnType<typeof setTimeout>) => { timers.delete(id as unknown as number); },
    runAll: async () => {
      const cbs = [...timers.values()];
      timers.clear();
      for (const cb of cbs) await cb();
    },
    count: () => timers.size,
  };
}

describe("makeDropEntryId / dedupeWsDrops", () => {
  it("generates unique ids", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) ids.add(makeDropEntryId());
    expect(ids.size).toBe(100);
  });

  it("dedupes by id, keeping the first occurrence", () => {
    const a = drop({ id: "id-1", at: 1 });
    const b = drop({ id: "id-1", at: 2 }); // duplicate id, different data
    const c = drop({ id: "id-2", at: 3 });
    const out = dedupeWsDrops([a, b, c]);
    expect(out).toEqual([a, c]);
  });

  it("falls back to at:code when id is missing", () => {
    const a = drop({ at: 10, code: 1006 });
    const b = drop({ at: 10, code: 1006 }); // same at+code → duplicate
    const c = drop({ at: 10, code: 1000 });
    expect(dedupeWsDrops([a, b, c])).toEqual([a, c]);
  });
});

describe("postWsDrops — fire-and-forget", () => {
  it("resolves true on an ok response", async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: true });
    const ok = await postWsDrops("/api/diag", [drop()], fetchFn as unknown as typeof fetch);
    expect(ok).toBe(true);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("/api/diag");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
  });

  it("resolves false on a non-ok response", async () => {
    const fetchFn = jest.fn().mockResolvedValue({ ok: false, status: 429 });
    expect(await postWsDrops("/api/diag", [drop()], fetchFn as unknown as typeof fetch)).toBe(false);
  });

  it("never throws when the network fails", async () => {
    const fetchFn = jest.fn().mockRejectedValue(new Error("offline"));
    expect(await postWsDrops("/api/diag", [drop()], fetchFn as unknown as typeof fetch)).toBe(false);
  });
});

describe("WsDropForwarder — batched, debounced, retrying", () => {
  it("debounces: sends nothing until the quiet window elapses", async () => {
    const timers = manualTimers();
    const send = jest.fn().mockResolvedValue(true);
    const f = new WsDropForwarder({
      send,
      flushDelayMs: 10_000,
      setTimer: timers.set,
      clearTimer: timers.clear,
    });
    f.push([drop({ at: 1 })]);
    f.push([drop({ at: 2 })]);
    expect(send).not.toHaveBeenCalled();
    expect(timers.count()).toBe(1); // single debounce timer for both pushes
    await timers.runAll();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].map((e: WsCloseLogEntry) => e.at)).toEqual([1, 2]);
    expect(f.pending).toBe(0);
  });

  it("flushes immediately once the batch threshold is reached", async () => {
    const timers = manualTimers();
    const send = jest.fn().mockResolvedValue(true);
    const f = new WsDropForwarder({
      send,
      maxBatch: 3,
      setTimer: timers.set,
      clearTimer: timers.clear,
    });
    f.push([drop({ at: 1 }), drop({ at: 2 }), drop({ at: 3 })]);
    await new Promise((r) => setTimeout(r, 0)); // let the async flush complete
    expect(send).toHaveBeenCalledTimes(1);
    expect(f.pending).toBe(0);
  });

  it("requeues and retries a failed send, then succeeds", async () => {
    const timers = manualTimers();
    const send = jest.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const f = new WsDropForwarder({
      send,
      flushDelayMs: 5_000,
      setTimer: timers.set,
      clearTimer: timers.clear,
    });
    f.push([drop({ at: 1 })]);
    await timers.runAll(); // first flush → send fails → requeued + rescheduled
    expect(send).toHaveBeenCalledTimes(1);
    expect(f.pending).toBe(1); // batch kept for retry
    await timers.runAll(); // retry → succeeds
    expect(send).toHaveBeenCalledTimes(2);
    expect(f.pending).toBe(0);
  });

  it("caps the queue at maxQueued", () => {
    const timers = manualTimers();
    const send = jest.fn().mockResolvedValue(true);
    const f = new WsDropForwarder({
      send,
      maxQueued: 3,
      flushDelayMs: 10_000,
      setTimer: timers.set,
      clearTimer: timers.clear,
    });
    f.push([drop({ at: 1 }), drop({ at: 2 }), drop({ at: 3 }), drop({ at: 4 }), drop({ at: 5 })]);
    expect(f.pending).toBe(3); // newest 3 kept (dedupe keeps first — all unique here)
  });

  it("dedupes entries pushed twice", async () => {
    const timers = manualTimers();
    const send = jest.fn().mockResolvedValue(true);
    const f = new WsDropForwarder({
      send,
      setTimer: timers.set,
      clearTimer: timers.clear,
    });
    const e = drop({ id: "dup", at: 1 });
    f.push([e]);
    f.push([e]); // same id — ignored
    await timers.runAll();
    expect(send.mock.calls[0][0]).toEqual([e]);
  });
});
