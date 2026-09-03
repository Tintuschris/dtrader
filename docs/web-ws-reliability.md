# Trading WebSocket reliability — root causes & fixes

Investigation into the workspace/trader reports of "the trader sometimes
disconnects, so when I place a trade it snaps or doesn't take it."

## Why the chart can look live while trades fail

The app runs **two separate WebSockets**:

1. A **public** tick stream (`wss://api.derivws.com/trading/v1/options/ws/public`)
   feeding the chart — it has its own reconnect loop and looks alive almost
   always.
2. An **authenticated** trading socket (session URL from `/api/deriv/session`)
   that carries proposals, buys, portfolio and contract settlement.

The chart being live therefore says nothing about the trading connection.
If the authenticated socket is down, clicking Buy can silently fail.

## Root causes found in code

| # | Problem | Consequence |
|---|---------|-------------|
| 1 | **Reconnect race in `connect()`** — a superseded socket's late `onclose` could schedule a reconnect (or run its handlers) over a newer socket | Old socket tears down / replaces the new connection; status flickers, buys sent on a dying socket |
| 2 | **Pending requests never rejected on close** — proposals/buys/portfolio promises only resolved by their 6–15 s timeouts | UI spins or reports failure long after the socket died; a rejected-by-server buy hangs the button |
| 3 | **No freshness check before buying** — `handlePlaceTrade` only checked "a proposal exists" | After a reconnect the pre-disconnect proposal id may have expired server-side; buying it fails or misfires |
| 4 | **No recovery for lost buy responses** — if Deriv accepted the buy but the response was lost in the disconnect, the UI said "failed" while the contract existed | Missed/duplicated trades; account state diverges from UI |
| 5 | **Buy button not disabled while disconnected** | User clicks Buy on a dead socket, gets a confusing failure instead of "reconnecting" |

## Fixes implemented

### 1. Connection-generation guard (`lib/ws-lifecycle.ts` → `use-deriv-ws.ts`)

Every `connect()` bumps a generation counter; the socket's `onopen`/`onerror`/
`onclose` and the reconnect timer only act while their captured generation is
still current. A stale socket can no longer reconnect over — or clobber state
belonging to — a newer connection.

### 2. Reject pending requests on disconnect (`rejectAllPending`)

When the socket closes, every pending proposal/buy/portfolio/profit-table
request is resolved with `null` immediately (instead of waiting out its
timeout), so the UI reflects the failure at once and nothing hangs.

### 3. Stale-proposal guard before buying (`isProposalFresh`)

The proposal subscription re-streams continuously, so the timestamp of the
last received proposal message is a liveness check. `buy()` / `buyBot()`
refuse a proposal older than `PROPOSAL_MAX_AGE_MS` (20 s), clear it, and
re-subscribe for fresh pricing. `handlePlaceTrade` additionally refuses to
fire while `connectionStatus !== "connected"` and explains why.

### 4. Post-reconnect reconciliation (`findOpenPortfolioContract`)

If the socket dropped with a pending buy **or** an open contract being
tracked, the next `onopen` queries `portfolio`; any still-open contract is
recovered: the stranded buy promise resolves with it, it becomes the active
contract, and its settlement stream is re-subscribed so the result is still
counted.

### 5. Buy disabled while disconnected (`trading-terminal.tsx`)

The Buy button is disabled unless the trading socket is `connected`, and its
label shows `Reconnecting…` / `Offline` instead of `Buy` — no more clicking
into a dead connection. `handlePlaceTrade` shows "Trading connection
interrupted — reconnecting…" if it somehow gets invoked.

## Test coverage (`__tests__/ws-lifecycle.test.ts`, 13 tests)

- stale socket `onclose` blocked after a newer `connect()`
- reconnect timer from an old generation never fires
- pending proposals and buys resolve `null` on disconnect (no hanging)
- stale proposal refused when buying right after a reconnect
- portfolio reconciliation recovers an open contract (incl. a simulated
  full disconnect → reject → reconnect → resolve flow)

Full suite: **108 tests passing**; `tsc --noEmit` clean.

## Drop diagnostics — every socket close is logged

Every trading-socket close is appended to a capped, newest-first ring buffer
in `localStorage` under **`freebuff_ws_drops`** (last 50 closes). This is the
data to pull when a future "trade didn't take" report arrives — it tells you
whether the trading socket actually dropped at that moment and what was
in flight when it did.

Each entry:

```json
{
  "at": 1754312345678,        // epoch ms of the close
  "code": 1006,               // 1006 = abnormal (no close frame) → genuine drop
  "reason": "no close frame received or sent",
  "durationMs": 45000,        // how long the connection was up before closing
  "attempt": 2,               // reconnect attempt at the time of the close
  "inFlight": { "proposals": 1, "buys": 1, "portfolio": false, "profitTable": false },
  "hadActiveContract": true,
  "reconcileFlagged": true    // a buy was stranded or a contract was open →
                              // the reconnect will try to recover it
}
```

Read it in the browser console:

```js
JSON.parse(localStorage.getItem("freebuff_ws_drops") || "[]")
```

or in-app via `getWsDropLog()` from `useDerivTrading()`. If `inFlight.buys`
was > 0 on a `1006` close, that is exactly the "clicked Buy and it didn't
take" scenario — and `reconcileFlagged` says whether the post-reconnect
portfolio reconciliation ran. Deliberate closes (account switch, page unload)
record normally too, so compare close codes to tell drops from intentional
disconnects. Logging is best-effort: if `localStorage` is unavailable or full
(private mode, quota), it silently skips and never interferes with the close
handler.

## Files touched

- `lib/ws-lifecycle.ts` — new pure, unit-tested lifecycle helpers
- `components/use-deriv-ws.ts` — gen guard, reject-on-close, stale-proposal
  guard, reconcile-on-reopen
- `components/trading-context.tsx` — connection check in `handlePlaceTrade`
- `components/trading-terminal.tsx` — Buy disabled/labeled while offline
- `__tests__/ws-lifecycle.test.ts` — lifecycle tests
- `lib/ws-lifecycle.ts` — `appendWsCloseLog` / `readWsCloseLog` ring buffer
