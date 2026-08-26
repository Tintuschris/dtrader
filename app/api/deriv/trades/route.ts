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

const DERIV_WS_URL = "https://api.derivws.com/trading/v1/options";

/**
 * GET /api/deriv/trades
 *
 * Fetches the user's trade history from Deriv using the v3 WebSocket API.
 * Uses the profit_table endpoint for closed/completed trades.
 *
 * Query params:
 *   ?limit=50 — max results
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated. Please log in.", trades: [] }, { status: 401 });
  }

  const headers = await getAuthHeaders();
  if (!headers) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const appId = process.env.DERIV_APP_ID;
  if (!appId) {
    return NextResponse.json({ error: "DERIV_APP_ID not configured" }, { status: 500 });
  }

  try {
    // Fetch profit table using v3 WebSocket API via HTTP POST
    const response = await fetch(`${DERIV_WS_URL}?app_id=${appId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        profit_table: 1,
        limit,
        offset: 0,
      }),
      cache: "no-store",
    });

    if (!response.ok) {
      console.error("Profit table returned", response.status);
      return NextResponse.json({ trades: [], total: 0, error: `API error: ${response.status}` });
    }

    const payload = await response.json().catch(() => null);

    // Check for auth errors
    if (payload?.error) {
      console.error("Deriv API error:", payload.error);
      return NextResponse.json({
        trades: [],
        total: 0,
        error: payload.error.message ?? "Deriv API error",
      });
    }

    const profitData = payload?.profit_table;
    const rawTrades = profitData?.transactions ?? [];

    // Determine account type from the login ID in the response
    const accountLoginid = profitData?.loginid ?? "";

    const trades: DerivTrade[] = rawTrades.map((t: Record<string, unknown>) => {
      const isDemo = accountLoginid.startsWith("VR") || accountLoginid.includes("demo");

      return {
        contract_id: String(t.contract_id ?? ""),
        contract_type: String(t.contract_type ?? ""),
        symbol: String(t.underlying ?? t.symbol ?? ""),
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

    return NextResponse.json({
      trades,
      total: profitData?.count ?? trades.length,
      authenticated: true,
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
