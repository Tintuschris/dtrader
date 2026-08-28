import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
import { derivV3AuthRequest, requestOptionsAccountWs } from "../../../../lib/deriv-options-ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const numberParam = (value: string | null, fallback: number, maximum: number) =>
  Math.min(Math.max(Number.parseInt(value ?? "", 10) || fallback, 0), maximum);

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Please log in to load trade history." }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, numberParam(searchParams.get("limit"), 50, 500));
  const offset = numberParam(searchParams.get("offset"), 0, Number.MAX_SAFE_INTEGER);
  const targetAccountId = searchParams.get("accountId") ?? session.loginId;

  try {
    const { result, accountId, accountType } = await derivV3AuthRequest<{
      profit_table?: { transactions?: Record<string, unknown>[]; count?: number };
    }>(
      session.accessToken,
      { profit_table: 1, description: 1, limit, offset, sort: "DESC" },
      "profit_table",
      targetAccountId ?? undefined
    );

    const source = result.profit_table?.transactions ?? [];
    const trades = source.map((item) => {
      const profit = Number(item.profit ?? 0);
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

    return NextResponse.json({
      trades,
      total: result.profit_table?.count ?? trades.length,
      hasMore: source.length === limit,
      account: { id: accountId, type: accountType },
    });
  } catch (error) {
    console.error("[deriv:history] failed:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load trade history." },
      { status: 500 },
    );
  }
}
