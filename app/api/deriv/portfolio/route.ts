import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
import { derivV3AuthRequest } from "../../../../lib/deriv-options-ws";
import { pooledV3Request } from "../../../../lib/deriv-ws-pool";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const t0 = Date.now();
  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Please log in to load open positions." }, { status: 401 });
  }

  const targetAccountId = new URL(request.url).searchParams.get("accountId") ?? session.loginId;
  console.log(JSON.stringify({ ts: new Date().toISOString(), step: "start", targetAccountId, hasToken: !!session.accessToken }));

  // Core API v3 WS supports portfolio; Options API WS does not.
  const token = process.env.DERIV_PAT || session.accessToken;
  if (!token) {
    return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  }

  try {
    // Try pooled connection first (reuses existing WS), fall back to per-request
    let result: { portfolio?: { contracts?: Record<string, unknown>[] } };
    let accountId: string;
    let accountType: "demo" | "real";
    try {
      const t1 = Date.now();
      const pooled = await pooledV3Request<typeof result>(token, { portfolio: 1 }, "portfolio", targetAccountId, 25_000);
      result = pooled.result;
      accountId = pooled.accountId;
      accountType = pooled.accountType;
      console.log(JSON.stringify({ ts: new Date().toISOString(), step: "pooled_ok", elapsed_ms: Date.now() - t1, accountId, accountType }));
    } catch (pooledErr) {
      console.log(JSON.stringify({ ts: new Date().toISOString(), step: "pooled_failed", error: pooledErr instanceof Error ? pooledErr.message : String(pooledErr) }));
      // Pooled connection failed, fall back to per-request with longer timeout
      const t2 = Date.now();
      const fallback = await derivV3AuthRequest<typeof result>(token, { portfolio: 1 }, "portfolio", targetAccountId, 30_000);
      result = fallback.result;
      accountId = fallback.accountId;
      accountType = fallback.accountType;
      console.log(JSON.stringify({ ts: new Date().toISOString(), step: "fallback_ok", elapsed_ms: Date.now() - t2, accountId, accountType }));
    }

    const positions = (result.portfolio?.contracts ?? []).map((item) => ({
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

    console.log(JSON.stringify({ ts: new Date().toISOString(), step: "done", elapsed_ms: Date.now() - t0, positions: positions.length }));

    return NextResponse.json({
      positions,
      account: { id: accountId, type: accountType },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({ ts: new Date().toISOString(), step: "failed", elapsed_ms: Date.now() - t0, error: msg }));
    return NextResponse.json(
      { error: msg },
      { status: 500 },
    );
  }
}
