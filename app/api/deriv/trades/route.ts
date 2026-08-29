import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
import { requestOptionsAccountWs, derivV3AuthRequest } from "../../../../lib/deriv-options-ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const numberParam = (value: string | null, fallback: number, maximum: number) =>
  Math.min(Math.max(Number.parseInt(value ?? "", 10) || fallback, 0), maximum);

/**
 * GET /api/deriv/trades?accountId=...&limit=...&offset=...
 *
 * Fetches the profit table. Tries the Options API WebSocket (OTP) first —
 * the Deriv rate limits page groups portfolio and profit_table in the same
 * WebSocket budget, so both should work on the OTP-authenticated WS. Falls
 * back to Core API v3 if the Options WS rejects the request.
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

  const profitTablePayload = {
    profit_table: 1,
    description: 1,
    limit,
    offset,
    sort: "DESC",
  };

  // --- Attempt 1: Options API WebSocket (OTP-authenticated) ---
  const otpTokens: Array<{ label: string; token: string }> = [];
  if (process.env.DERIV_PAT) {
    otpTokens.push({ label: "PAT-OTP", token: process.env.DERIV_PAT });
  }
  otpTokens.push({ label: "OAuth-OTP", token: session.accessToken });

  for (const { label, token } of otpTokens) {
    try {
      log("trying_otp", { method: label });

      const { result, accountId, accountType } = await requestOptionsAccountWs<{
        profit_table?: { transactions?: Record<string, unknown>[]; count?: number };
      }>(
        token,
        targetAccountId ?? undefined,
        profitTablePayload,
        "profit_table",
      );

      const source = result.profit_table?.transactions ?? [];
      const trades = parseTrades(source, accountType, accountId);

      log("done_otp", { tradesReturned: trades.length, accountId, authMethod: label });

      return NextResponse.json({
        trades,
        total: result.profit_table?.count ?? trades.length,
        hasMore: source.length === limit,
        account: { id: accountId, type: accountType },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("otp_failed", { method: label, error: msg });
      // If the error suggests the endpoint isn't supported, try Core API v3
      if (msg.includes("UnrecognisedRequest") || msg.includes("Unrecognised request")) {
        log("otp_endpoint_unsupported", { method: label });
        break; // Stop trying OTP, go to Core API v3
      }
    }
  }

  // --- Attempt 2: Core API v3 WebSocket (fallback) ---
  log("trying_core_v3");

  const coreTokens: Array<{ label: string; token: string }> = [];
  if (process.env.DERIV_PAT) {
    coreTokens.push({ label: "PAT-Core", token: process.env.DERIV_PAT });
  }
  coreTokens.push({ label: "OAuth-Core", token: session.accessToken });

  let lastError: string | null = null;

  for (const { label, token } of coreTokens) {
    try {
      log("trying_core_auth", { method: label });

      const result = await derivV3AuthRequest<{
        profit_table?: { transactions?: Record<string, unknown>[]; count?: number };
      }>(
        token,
        profitTablePayload,
        "profit_table",
        targetAccountId ?? undefined,
      );

      const source = result.result.profit_table?.transactions ?? [];
      const trades = parseTrades(source, result.accountType, result.accountId);

      log("done_core", { tradesReturned: trades.length, accountId: result.accountId, authMethod: label });

      return NextResponse.json({
        trades,
        total: result.result.profit_table?.count ?? trades.length,
        hasMore: source.length === limit,
        account: { id: result.accountId, type: result.accountType },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("core_failed", { method: label, error: msg });
      lastError = msg;
    }
  }

  log("all_attempts_failed", { lastError });
  return NextResponse.json(
    { error: lastError || "Unable to load trade history." },
    { status: 500 },
  );
}

function parseTrades(
  source: Record<string, unknown>[],
  accountType: "demo" | "real",
  accountId: string,
) {
  return source.map((item) => {
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
      account_type: accountType,
      account_id: accountId,
    };
  });
}
