import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
import { derivV3AuthRequest } from "../../../../lib/deriv-options-ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Please log in to load open positions." }, { status: 401 });
  }

  const targetAccountId = new URL(request.url).searchParams.get("accountId") ?? session.loginId;

  // Core API v3 WS supports portfolio; Options API WS does not.
  const token = process.env.DERIV_PAT || session.accessToken;

  try {
    const { result, accountId, accountType } = await derivV3AuthRequest<{
      portfolio?: { contracts?: Record<string, unknown>[] };
    }>(
      token,
      { portfolio: 1 },
      "portfolio",
      targetAccountId,
    );

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

    return NextResponse.json({
      positions,
      account: { id: accountId, type: accountType },
    });
  } catch (error) {
    console.error("[deriv:portfolio] failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load open positions." },
      { status: 500 },
    );
  }
}
