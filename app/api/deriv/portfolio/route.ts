import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
import { getOptionsSocketUrl, requestOptionsWs, resolveOptionsAccount } from "../../../../lib/deriv-options-ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.accessToken) return NextResponse.json({ error: "Please log in to load open positions." }, { status: 401 });
  try {
    const account = await resolveOptionsAccount(session.accessToken, new URL(request.url).searchParams.get("accountId") ?? session.loginId);
    console.info("[deriv:portfolio] requesting", { accountId: account.id });
    const socketUrl = await getOptionsSocketUrl(account.id, session.accessToken);
    const response = await requestOptionsWs<{ portfolio?: { contracts?: Record<string, unknown>[] } }>(socketUrl, { portfolio: 1 }, "portfolio");
    const positions = (response.portfolio?.contracts ?? []).map((item) => ({ contract_id: String(item.contract_id ?? ""), contract_type: String(item.contract_type ?? ""), symbol: String(item.underlying ?? item.symbol ?? ""), buy_price: Number(item.buy_price ?? 0), payout: Number(item.payout ?? 0), profit: Number(item.profit ?? 0), status: String(item.status ?? "open"), barrier: item.barrier == null ? undefined : String(item.barrier), purchase_time: Number(item.purchase_time ?? 0) }));
    console.info("[deriv:portfolio] received", { accountId: account.id, count: positions.length });
    return NextResponse.json({ positions, account });
  } catch (error) {
    console.error("[deriv:portfolio] failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load open positions." }, { status: 500 });
  }
}
