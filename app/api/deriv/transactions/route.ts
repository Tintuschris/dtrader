import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
import { fetchTransactions } from "../../../../lib/deriv-wallet-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/deriv/transactions?walletType=main&limit=50&currency=USD
 *
 * Proxies wallet transaction history from the Deriv Wallet REST API.
 * Requires an OAuth session with the `payment` scope.
 */
export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json(
      { error: "Not authenticated. Please log in with your Deriv account." },
      { status: 401 },
    );
  }

  const { searchParams } = new URL(request.url);
  const walletType = searchParams.get("walletType") ?? "main";
  const limit = Math.min(Math.max(Number.parseInt(searchParams.get("limit") ?? "50", 10) || 50, 1), 200);
  const currency = searchParams.get("currency") ?? undefined;
  const startDate = searchParams.get("startDate") ?? undefined;
  const endDate = searchParams.get("endDate") ?? undefined;
  const requestId = searchParams.get("requestId") ?? undefined;

  try {
    const result = await fetchTransactions(walletType, {
      limit,
      currency,
      start_date: startDate,
      end_date: endDate,
      request_id: requestId,
    });

    return NextResponse.json({
      transactions: result.transactions ?? [],
      links: result.links ?? {},
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[deriv:transactions] failed:", msg);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
