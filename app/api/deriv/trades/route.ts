import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
import { getOptionsSocketUrl, requestOptionsWs, resolveOptionsAccount } from "../../../../lib/deriv-options-ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const numberParam = (value: string | null, fallback: number, maximum: number) => Math.min(Math.max(Number.parseInt(value ?? "", 10) || fallback, 0), maximum);

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.accessToken) return NextResponse.json({ error: "Please log in to load trade history." }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const limit = Math.max(1, numberParam(searchParams.get("limit"), 50, 500));
  const offset = numberParam(searchParams.get("offset"), 0, Number.MAX_SAFE_INTEGER);
  try {
    const account = await resolveOptionsAccount(session.accessToken, searchParams.get("accountId") ?? session.loginId);
    const socketUrl = await getOptionsSocketUrl(account.id, session.accessToken);
    const response = await requestOptionsWs<{ profit_table?: { transactions?: Record<string, unknown>[]; count?: number } }>(socketUrl, { profit_table: 1, description: 1, limit, offset }, "profit_table");
    const source = response.profit_table?.transactions ?? [];
    const trades = source.map((item) => {
      const profit = Number(item.profit ?? 0);
      const receivedStatus = String(item.status ?? "").toLowerCase();
      return {
        contract_id: String(item.contract_id ?? item.transaction_id ?? ""), contract_type: String(item.contract_type ?? ""), symbol: String(item.underlying ?? item.symbol ?? ""),
        buy_price: Number(item.buy_price ?? 0), payout: Number(item.payout ?? item.sell_price ?? 0), profit,
        status: receivedStatus || (profit > 0 ? "won" : profit < 0 ? "lost" : "break_even"),
        barrier: item.barrier == null ? undefined : String(item.barrier), purchase_time: Number(item.purchase_time ?? item.transaction_time ?? 0),
        sell_time: Number(item.sell_time ?? 0) || undefined, account_type: account.type, account_id: account.id,
      };
    });
    return NextResponse.json({ trades, total: response.profit_table?.count ?? null, hasMore: source.length === limit, account });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to load trade history." }, { status: 500 });
  }
}
