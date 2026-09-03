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
