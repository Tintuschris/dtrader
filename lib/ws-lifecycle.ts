/**
 * Pure helpers for the trading WebSocket lifecycle.
 *
 * Kept free of React and DOM so the trickiest failure paths — stale-socket
 * reconnect races, pending requests stranded by a disconnect, stale proposal
 * guards, and post-reconnect reconciliation — are unit-testable in isolation.
 */

/* ------------------------------------------------------------------ */
/*  Connection generation guard                                        */
/* ------------------------------------------------------------------ */
/**
 * Guards against the classic WebSocket reconnect race: socket A closes and
 * schedules a reconnect; meanwhile the user (or another path) calls connect()
 * again, creating socket B. When A's `onclose` fires late it must NOT be
 * allowed to tear down or replace B, or schedule a duplicate reconnect.
 *
 * Every connect() attempt calls begin() and captures the returned generation;
 * handlers only act while isCurrent(gen) is true.
 */
export function createConnGuard() {
  let gen = 0;
  return {
    begin(): number {
      return ++gen;
    },
    isCurrent(g: number): boolean {
      return g === gen;
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Pending request rejection                                          */
/* ------------------------------------------------------------------ */
// The stored resolvers are `(v: T | null) => void` for various T (Proposal,
// OpenContract...). We only ever call them with `null`, so `any` keeps the
// map assignable from any of those concrete types without contravariance
// fights under strict mode.
type ResolveMap = { forEach(cb: (v: any) => void): void; clear(): void };

/**
 * Resolve every pending request with `null` and clear the maps. Used when the
 * socket closes so no promise hangs until its (long) timeout, and the UI can
 * immediately show the request failed instead of silently spinning.
 * Returns the number of requests rejected.
 */
export function rejectAllPending(maps: ResolveMap[]): number {
  let count = 0;
  for (const map of maps) {
    // Map.forEach is used deliberately: `for...of` over the values() iterator
    // breaks when ts-jest downlevels to ES5, while forEach survives any target.
    map.forEach((resolve) => {
      resolve(null);
      count++;
    });
    map.clear();
  }
  return count;
}

/* ------------------------------------------------------------------ */
/*  Proposal freshness                                                 */
/* ------------------------------------------------------------------ */
/**
 * A subscribed proposal re-streams continuously, so the timestamp of the last
 * received proposal message doubles as a liveness check. If the socket died
 * and reconnected, the *old* proposal id may have expired server-side even
 * though the connection is back — buying it would fail. Treat any proposal
 * whose last update is older than `maxAgeMs` (or never received) as stale.
 */
export function isProposalFresh(lastUpdateAt: number, maxAgeMs: number, now: number = Date.now()): boolean {
  return lastUpdateAt > 0 && now - lastUpdateAt <= maxAgeMs;
}

/* ------------------------------------------------------------------ */
/*  Post-reconnect reconciliation                                      */
/* ------------------------------------------------------------------ */
export type PortfolioContract = {
  contract_id?: unknown;
  status?: unknown;
  is_sold?: unknown;
  buy_price?: unknown;
  payout?: unknown;
  contract_type?: unknown;
  underlying?: unknown;
  underlying_symbol?: unknown;
  tick_count?: unknown;
  barrier?: unknown;
};

/**
 * Find the first still-open contract in a `portfolio` response. Used after a
 * reconnect to recover a trade that Deriv accepted but whose buy response was
 * lost in the disconnect ("UI said failed, contract exists" case).
 */
export function findOpenPortfolioContract(
  positions: unknown[] | null | undefined,
): Record<string, unknown> | null {
  if (!Array.isArray(positions)) return null;
  for (const raw of positions) {
    const p = raw as PortfolioContract;
    const status = String(p.status ?? "");
    const isSold = p.is_sold;
    const isOpenStatus =
      status === "open" || status === "purchased" || status === "ready" || status === "started";
    const notSold = isSold === undefined || isSold === 0 || isSold === false;
    if (isOpenStatus && notSold) {
      return raw as Record<string, unknown>;
    }
  }
  return null;
}


/* ------------------------------------------------------------------ */
/*  Connection drop diagnostics                                        */
/* ------------------------------------------------------------------ */
export type WsCloseLogEntry = {
  at: number; // epoch ms when the socket closed
  code: number; // WebSocket close code (1006 = abnormal, no close frame)
  reason: string; // close reason string
  durationMs: number; // how long the connection was up before closing
  attempt: number; // reconnect attempt at the time of the close
  inFlight: {
    proposals: number;
    buys: number;
    portfolio: boolean;
    profitTable: boolean;
  };
  hadActiveContract: boolean;
  reconcileFlagged: boolean;
};

type KvStore = Pick<Storage, "getItem" | "setItem"> | null;

/**
 * Append a close event to a capped, newest-first ring buffer in a key/value
 * store (localStorage). Returns the new list, or [] if the store is
 * unavailable or the write fails (private mode / quota) — logging must never
 * throw into the socket close path.
 */
export function appendWsCloseLog(
  storage: KvStore,
  key: string,
  entry: WsCloseLogEntry,
  maxEntries = 50,
): WsCloseLogEntry[] {
  if (!storage) return [];
  try {
    let list: WsCloseLogEntry[] = [];
    const raw = storage.getItem(key);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) list = parsed as WsCloseLogEntry[];
      } catch {
        /* corrupted record — start fresh */
      }
    }
    list = [entry, ...list].slice(0, maxEntries);
    storage.setItem(key, JSON.stringify(list));
    return list;
  } catch {
    return [];
  }
}

/** Read the logged close events, newest first. Never throws. */
export function readWsCloseLog(storage: KvStore, key: string): WsCloseLogEntry[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as WsCloseLogEntry[]) : [];
  } catch {
    return [];
  }
}
