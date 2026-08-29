import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
import { derivV3AuthRequest } from "../../../../lib/deriv-options-ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const numberParam = (value: string | null, fallback: number, maximum: number) =>
  Math.min(Math.max(Number.parseInt(value ?? "", 10) || fallback, 0), maximum);

/**
 * GET /api/deriv/trades?accountId=...&limit=...&offset=...
 *
 * Fetches the profit table via the Core API v3 WebSocket.
 * profit_table is a Core API v3 endpoint — it is NOT supported on the
 * Options API WebSocket (OTP-authenticated). Using the Options API WS
 * for this causes "UnrecognisedRequest" errors.
 */
export async function GET(request: NextRequest) {
  const t0 = Date.now();

  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Please log in to load trade history." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, numberParam(searchParams.get("limit"), 50, 500));
  const offset = numberParam(searchParams.get("offset"), 0, Number.MAX_SAFE_INTEGER);
  const targetAccountId = searchParams.get("accountId") ?? session.loginId;

  const log = (step: string, data: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ ts: new Date().toISOString(), step, targetAccountId, limit, offset, elapsed_ms: Date.now() - t0, ...data }));

  log("start", { hasToken: !!session.accessToken, hasPAT: !!process.env.DERIV_PAT });

  // Try PAT first (most reliable for Core API v3), then OAuth token
  const tokens: Array<{ label: string; token: string }> = [];
  if (process.env.DERIV_PAT) {
    tokens.push({ label: "PAT", token: process.env.DERIV_PAT });
  }
  tokens.push({ label: "OAuth", token: session.accessToken });

  let lastError: string | null = null;

  for (const { label, token } of tokens) {
    try {
      log("trying_auth", { method: label });

      const result = await derivV3AuthRequest<{
        profit_table?: { transactions?: Record<string, unknown>[]; count?: number };
      }>(
        token,
        {
          profit_table: 1,
          description: 1,
          limit,
          offset,
          sort: "DESC",
        },
        "profit_table",
        targetAccountId ?? undefined,
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
          symbol: String(item.underlying_symbol ?? item.underlying ?? item.symbol ?? ""),
          buy_price: buyPrice,
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

      log("done", { tradesReturned: trades.length, accountId: result.accountId, authMethod: label });

      return NextResponse.json({
        trades,
        total: result.result.profit_table?.count ?? trades.length,
        hasMore: source.length === limit,
        account: { id: result.accountId, type: result.accountType },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("auth_failed", { method: label, error: msg });
      lastError = msg;
    }
  }

  log("all_auth_failed", { lastError });
  return NextResponse.json(
    { error: lastError || "Unable to load trade history. Make sure DERIV_PAT is set in .env.local." },
    { status: 500 },
  );
}
