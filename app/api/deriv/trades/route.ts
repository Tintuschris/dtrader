import { NextRequest, NextResponse } from "next/server";
import { getSession, getAuthHeaders } from "../../../../lib/deriv-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DerivTrade = {
  contract_id: string;
  contract_type: string;
  symbol: string;
  buy_price: number;
  payout: number;
  profit: number;
  status: string;
  barrier?: string;
  tick_count?: number;
  entry_tick?: number;
  exit_tick?: number;
  purchase_time: number;
  sell_time?: number;
  is_sold: boolean;
  account_type: "demo" | "real";
};

/**
 * GET /api/deriv/trades
 *
 * Fetches the user's trade history from Deriv.
 * Uses the open_contract endpoint to get active contracts,
 * and the profit_table endpoint for closed trades.
 * Separates demo and real account trades.
 *
 * Query params:
 *   ?account_type=demo|real — filter by account type
 *   ?status=open|won|lost|sold|all — filter by status
 *   ?limit=50 — max results
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const statusFilter = searchParams.get("status") ?? "all";
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  // Get auth headers
  const session = await getSession();
  let headers: Record<string, string> | null = null;
  let isOAuth = false;

  if (session?.accessToken) {
    headers = await getAuthHeaders();
    isOAuth = true;
  }

  if (!headers) {
    return NextResponse.json({ error: "Not authenticated. Please log in with your Deriv account.", trades: [] }, { status: 401 });
  }

  try {
    // Fetch open contracts from Deriv
    const response = await fetch(
      "https://api.derivws.com/trading/v1/options/profit-table",
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          limit,
          offset: 0,
          // Only closed trades — open contracts come via WS
        }),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      console.error("Profit table returned", response.status);
      return NextResponse.json({ trades: [], total: 0, error: "Failed to fetch trades" });
    }

    const payload = await response.json().catch(() => null);
    const profitData = payload?.profit_table;
    const rawTrades = profitData?.transactions ?? [];

    // Normalize trades
    const trades: DerivTrade[] = rawTrades.map((t: Record<string, unknown>) => {
      const appID = String(t.app_id ?? "");
      // Determine account type from app_id or other indicators
      const isDemo = appID.includes("demo") || String(t.loginid ?? "").includes("VR");

      return {
        contract_id: String(t.contract_id ?? t.order_key ?? ""),
        contract_type: String(t.contract_type ?? ""),
        symbol: String(t.underlying_symbol ?? t.symbol ?? ""),
        buy_price: Number(t.buy_price) || 0,
        payout: Number(t.payout) || 0,
        profit: Number(t.profit) || 0,
        status: normalizeStatus(String(t.status ?? "")),
        barrier: t.barrier ? String(t.barrier) : undefined,
        tick_count: typeof t.tick_count === "number" ? t.tick_count : undefined,
        entry_tick: typeof t.entry_tick === "number" ? t.entry_tick : undefined,
        exit_tick: typeof t.exit_tick === "number" ? t.exit_tick : undefined,
        purchase_time: Number(t.purchase_time ?? t.transaction_time ?? 0),
        sell_time: typeof t.sell_time === "number" ? t.sell_time : undefined,
        is_sold: Boolean(t.is_sold),
        account_type: isDemo ? "demo" : "real",
      };
    });

    // Apply status filter
    let filtered = trades;
    if (statusFilter !== "all") {
      filtered = trades.filter((t) => t.status === statusFilter);
    }

    return NextResponse.json({
      trades: filtered,
      total: trades.length,
      authenticated: isOAuth,
    });
  } catch (err) {
    console.error("Failed to fetch trades:", err);
    return NextResponse.json({ trades: [], total: 0, error: "Network error" });
  }
}

function normalizeStatus(status: string): string {
  const s = status.toLowerCase();
  if (s.includes("won") || s === "win") return "won";
  if (s.includes("lost") || s === "loss") return "lost";
  if (s.includes("sold")) return "sold";
  if (s.includes("open") || s.includes("pending")) return "open";
  if (s.includes("expired")) return "expired";
  return s || "unknown";
}
