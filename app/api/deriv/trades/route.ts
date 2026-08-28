import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
import { derivV3AuthRequest } from "../../../../lib/deriv-options-ws";
import { pooledV3Request } from "../../../../lib/deriv-ws-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const numberParam = (value: string | null, fallback: number, maximum: number) =>
  Math.min(Math.max(Number.parseInt(value ?? "", 10) || fallback, 0), maximum);

/** Structured logger — every step writes a JSON line to server logs */
function log(level: "info" | "warn" | "error", step: string, data: Record<string, unknown>) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), level, step, ...data });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
}

export async function GET(request: NextRequest) {
  const t0 = Date.now();

  /* ── 1. Session check ─────────────────────────────────────────── */
  const session = await getSession();
  if (!session?.accessToken) {
    log("warn", "session", { status: "missing" });
    return NextResponse.json({ error: "Please log in to load trade history." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, numberParam(searchParams.get("limit"), 50, 500));
  const offset = numberParam(searchParams.get("offset"), 0, Number.MAX_SAFE_INTEGER);
  const targetAccountId = searchParams.get("accountId") ?? session.loginId;

  log("info", "start", {
    hasToken: !!session.accessToken,
    tokenPrefix: session.accessToken.substring(0, 6),
    targetAccountId: targetAccountId ?? "(none)",
    loginId: session.loginId ?? "(none)",
    limit,
    offset,
  });

  /* ── 2. Token selection ────────────────────────────────────────── */
  // Core API v3 WS supports profit_table; Options API WS does not.
  const token = process.env.DERIV_PAT || session.accessToken;
  if (!token) {
    log("error", "env", { msg: "No token available (neither DERIV_PAT nor session token)" });
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }
  log("info", "env", { hasPAT: !!process.env.DERIV_PAT, tokenPrefix: token.substring(0, 8) });

  /* ── 3. Core API v3 chain ─────────────────────────────────────── */
  try {
    log("info", "ws_chain", { msg: "calling pooledV3Request (Core API v3)" });
    const t1 = Date.now();

    type ProfitTableResult = { profit_table?: { transactions?: Record<string, unknown>[]; count?: number } };
    let result: ProfitTableResult;
    let accountId: string;
    let accountType: "demo" | "real";
    try {
      // Try pooled connection first (reuses existing WS)
      const pooled = await pooledV3Request<ProfitTableResult>(
        token,
        { profit_table: 1, description: 1, limit, offset, sort: "DESC" },
        "profit_table",
        targetAccountId,
        25_000,
      );
      result = pooled.result;
      accountId = pooled.accountId;
      accountType = pooled.accountType;
      log("info", "ws_chain_ok", { elapsed_ms: Date.now() - t1, source: "pooled" });
    } catch {
      // Pooled connection failed, fall back to per-request
      log("info", "ws_chain", { msg: "pooled failed, falling back to derivV3AuthRequest" });
      const fallback = await derivV3AuthRequest<ProfitTableResult>(
        token,
        { profit_table: 1, description: 1, limit, offset, sort: "DESC" },
        "profit_table",
        targetAccountId,
        30_000,
      );
      result = fallback.result;
      accountId = fallback.accountId;
      accountType = fallback.accountType;
      log("info", "ws_chain_ok", { elapsed_ms: Date.now() - t1, source: "fallback" });
    }

    log("info", "ws_chain_ok", {
      elapsed_ms: Date.now() - t1,
      accountId,
      accountType,
      txCount: result.profit_table?.transactions?.length ?? 0,
      totalCount: result.profit_table?.count,
    });

    /* ── 4. Map trades ───────────────────────────────────────────── */
    const source = result.profit_table?.transactions ?? [];
    const trades = source.map((item) => {
      const sellPrice = Number(item.sell_price ?? 0);
      const buyPrice = Number(item.buy_price ?? 0);
      const profit = sellPrice - buyPrice;
      const receivedStatus = String(item.status ?? "").toLowerCase();
      return {
        contract_id: String(item.contract_id ?? item.transaction_id ?? ""),
        contract_type: String(item.contract_type ?? ""),
        symbol: String(item.underlying ?? item.symbol ?? ""),
        buy_price: Number(item.buy_price ?? 0),
        payout: Number(item.payout ?? item.sell_price ?? 0),
        profit,
        status: receivedStatus || (profit > 0 ? "won" : profit < 0 ? "lost" : "break_even"),
        barrier: item.barrier == null ? undefined : String(item.barrier),
        purchase_time: Number(item.purchase_time ?? item.transaction_time ?? 0),
        sell_time: Number(item.sell_time ?? 0) || undefined,
        account_type: accountType,
        account_id: accountId,
      };
    });

    log("info", "done", { elapsed_ms: Date.now() - t0, tradesReturned: trades.length });

    return NextResponse.json({
      trades,
      total: result.profit_table?.count ?? trades.length,
      hasMore: source.length === limit,
      account: { id: accountId, type: accountType },
    });
  } catch (error) {
    const elapsed = Date.now() - t0;
    const msg = error instanceof Error ? error.message : String(error);
    log("error", "failed", { elapsed_ms: elapsed, error: msg });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
