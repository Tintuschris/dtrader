import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
import { derivV3AuthRequest } from "../../../../lib/deriv-options-ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const t0 = Date.now();
  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Please log in to load open positions." }, { status: 401 });
  }

  const targetAccountId = new URL(request.url).searchParams.get("accountId") ?? session.loginId;
  console.log(JSON.stringify({ ts: new Date().toISOString(), step: "start", targetAccountId, hasToken: !!session.accessToken, hasPAT: !!process.env.DERIV_PAT }));

  // Core API v3 WS supports portfolio; Options API WS does not.
  // Try PAT first (long-lived, full permissions), then session token.
  const tokens = [process.env.DERIV_PAT, session.accessToken].filter(Boolean) as string[];
  if (tokens.length === 0) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  let lastError: Error | null = null;

  for (const token of tokens) {
    try {
      console.log(JSON.stringify({ ts: new Date().toISOString(), step: "trying", tokenPrefix: token.substring(0, 8) }));
      const result = await derivV3AuthRequest<{ portfolio?: { contracts?: Record<string, unknown>[] } }>(
        token,
        { portfolio: 1 },
        "portfolio",
        targetAccountId,
        30_000,
      );

      const positions = (result.result.portfolio?.contracts ?? []).map((item) => ({
        contract_id: String(item.contract_id ?? ""),
        contract_type: String(item.contract_type ?? ""),
        symbol: String(item.underlying ?? item.symbol ?? ""),
        buy_price: Number(item.buy_price ?? 0),
        payout: Number(item.payout ?? 0),
        profit: Number(item.profit ?? 0),
        status: String(item.status ?? "open"),
        barrier: item.barrier == null ? undefined : String(item.barrier),
        purchase_time: Number(item.purchase_time ?? 0),
      }));

      console.log(JSON.stringify({ ts: new Date().toISOString(), step: "done", elapsed_ms: Date.now() - t0, positions: positions.length, accountId: result.accountId }));

      return NextResponse.json({
        positions,
        account: { id: result.accountId, type: result.accountType },
      });
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.log(JSON.stringify({ ts: new Date().toISOString(), step: "token_failed", tokenPrefix: token.substring(0, 8), error: lastError.message }));
      // If this was the PAT and it failed, try session token next
      // If this was the session token and it failed, we're done
    }
  }

  console.error(JSON.stringify({ ts: new Date().toISOString(), step: "all_failed", elapsed_ms: Date.now() - t0, error: lastError?.message }));
  return NextResponse.json(
    { error: lastError?.message ?? "Unable to load open positions." },
    { status: 500 },
  );
}
