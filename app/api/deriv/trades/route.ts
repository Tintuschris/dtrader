import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
import { derivV3AuthRequest } from "../../../../lib/deriv-options-ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const numberParam = (value: string | null, fallback: number, maximum: number) =>
  Math.min(Math.max(Number.parseInt(value ?? "", 10) || fallback, 0), maximum);

function log(level: "info" | "warn" | "error", step: string, data: Record<string, unknown>) {
  const entry = JSON.stringify({ ts: new Date().toISOString(), level, step, ...data });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
}

type ProfitTableResult = { profit_table?: { transactions?: Record<string, unknown>[]; count?: number } };

export async function GET(request: NextRequest) {
  const t0 = Date.now();

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
    targetAccountId: targetAccountId ?? "(none)",
    loginId: session.loginId ?? "(none)",
    limit,
    offset,
    hasPAT: !!process.env.DERIV_PAT,
  });

  // Try PAT first (long-lived), then session token
  const tokens = [process.env.DERIV_PAT, session.accessToken].filter(Boolean) as string[];
  if (tokens.length === 0) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let lastError: Error | null = null;

  for (const token of tokens) {
    try {
      log("info", "trying", { tokenPrefix: token.substring(0, 8) });
      const result = await derivV3AuthRequest<ProfitTableResult>(
        token,
        { profit_table: 1, description: 1, limit, offset, sort: "DESC" },
        "profit_table",
        targetAccountId,
        30_000,
      );

      const source = result.result.profit_table?.transactions ?? [];
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
          account_type: result.accountType,
          account_id: result.accountId,
        };
      });

      log("info", "done", { elapsed_ms: Date.now() - t0, tradesReturned: trades.length, accountId: result.accountId });

      return NextResponse.json({
        trades,
        total: result.result.profit_table?.count ?? trades.length,
        hasMore: source.length === limit,
        account: { id: result.accountId, type: result.accountType },
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      log("info", "token_failed", { tokenPrefix: token.substring(0, 8), error: lastError.message });
    }
  }

  const elapsed = Date.now() - t0;
  log("error", "all_failed", { elapsed_ms: elapsed, error: lastError?.message });
  return NextResponse.json(
    { error: lastError?.message ?? "Unable to load trade history." },
    { status: 500 },
  );
}
