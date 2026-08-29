import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
import { requestOptionsAccountWs } from "../../../../lib/deriv-options-ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/deriv/portfolio?accountId=...
 *
 * Fetches open positions via the Options API WebSocket (OTP-authenticated).
 * Per the Deriv Complete Trading Workflow docs, `portfolio` is called on the
 * same OTP-authenticated WebSocket used for trading — NOT the Core API v3 WS.
 */
export async function GET(request: NextRequest) {
  const t0 = Date.now();
  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Please log in to load open positions." }, { status: 401 });
  }

  const targetAccountId = new URL(request.url).searchParams.get("accountId") ?? session.loginId;
  const log = (step: string, data: Record<string, unknown> = {}) =>
    console.log(JSON.stringify({ ts: new Date().toISOString(), step, targetAccountId, elapsed_ms: Date.now() - t0, ...data }));

  log("start", { hasToken: !!session.accessToken, hasPAT: !!process.env.DERIV_PAT });

  // Try PAT first (most reliable), then OAuth token
  const tokens: Array<{ label: string; token: string }> = [];
  if (process.env.DERIV_PAT) {
    tokens.push({ label: "PAT", token: process.env.DERIV_PAT });
  }
  tokens.push({ label: "OAuth", token: session.accessToken });

  let lastError: string | null = null;

  for (const { label, token } of tokens) {
    try {
      log("trying_auth", { method: label });

      const { result, accountId, accountType } = await requestOptionsAccountWs<{
        portfolio?: { contracts?: Record<string, unknown>[] };
      }>(
        token,
        targetAccountId ?? undefined,
        { portfolio: 1 },
        "portfolio",
      );

      const positions = (result.portfolio?.contracts ?? []).map((item) => ({
        contract_id: String(item.contract_id ?? ""),
        contract_type: String(item.contract_type ?? ""),
        symbol: String(item.underlying_symbol ?? item.underlying ?? item.symbol ?? ""),
        buy_price: Number(item.buy_price ?? 0),
        payout: Number(item.payout ?? 0),
        profit: Number(item.profit ?? 0),
        status: String(item.status ?? "open"),
        barrier: item.barrier == null ? undefined : String(item.barrier),
        purchase_time: Number(item.purchase_time ?? 0),
      }));

      log("done", { positions: positions.length, accountId, accountType, authMethod: label });

      return NextResponse.json({
        positions,
        account: { id: accountId, type: accountType },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("auth_failed", { method: label, error: msg });
      lastError = msg;
    }
  }

  log("all_auth_failed", { lastError });
  return NextResponse.json(
    { error: lastError || "Unable to load open positions." },
    { status: 500 },
  );
}
