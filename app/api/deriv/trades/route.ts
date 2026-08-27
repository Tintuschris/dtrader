import { NextRequest, NextResponse } from "next/server";
import { getSession, getAuthHeaders } from "../../../../lib/deriv-session";
import WebSocket from "ws";

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

const OPTIONS_REST_URL = "https://api.derivws.com/trading/v1/options";

/**
 * Get an authenticated WebSocket URL via the OTP endpoint.
 */
async function getOtpUrl(accountId: string, accessToken: string): Promise<string> {
  const appId = process.env.DERIV_APP_ID;
  if (!appId) throw new Error("DERIV_APP_ID not configured");

  const response = await fetch(`${OPTIONS_REST_URL}/accounts/${encodeURIComponent(accountId)}/otp`, {
    method: "POST",
    headers: {
      "Deriv-App-ID": appId,
      Authorization: `Bearer ${accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) throw new Error(`OTP request failed: HTTP ${response.status}`);
  const payload = await response.json() as { data?: { url?: string } };
  const wsUrl = payload?.data?.url;
  if (!wsUrl) throw new Error("No WebSocket URL returned");
  return wsUrl;
}

/**
 * Make a request to an authenticated Deriv WebSocket.
 */
function authWsRequest<T>(wsUrl: string, payload: Record<string, unknown>, expectedMsgType: string, timeoutMs = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error("Timeout")); }, timeoutMs);
    ws.on("open", () => ws.send(JSON.stringify(payload)));
    ws.on("message", (event) => {
      try {
        const msg = JSON.parse(String(event));
        if (msg.msg_type === expectedMsgType) {
          clearTimeout(timer); ws.close();
          if (msg.error) reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
          else resolve(msg);
        }
      } catch { /* ignore */ }
    });
    ws.on("error", (err) => { clearTimeout(timer); reject(err); });
    ws.on("close", () => clearTimeout(timer));
  });
}

/**
 * GET /api/deriv/trades
 *
 * Fetches the user's trade history from Deriv using the authenticated WebSocket.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated. Please log in.", trades: [] }, { status: 401 });
  }

  try {
    // Step 1: Get account ID from session (stored during OAuth) or fallback to accounts REST endpoint
    let accountId = session.loginId;
    
    if (!accountId) {
      // Fallback: try to get accounts list from REST endpoint
      try {
        const accountsRes = await fetch(`${OPTIONS_REST_URL}/accounts`, {
          method: "GET",
          headers: {
            "Deriv-App-ID": process.env.DERIV_APP_ID ?? "",
            Authorization: `Bearer ${session.accessToken}`,
            "Content-Type": "application/json",
          },
          cache: "no-store",
        });

        if (accountsRes.ok) {
          const accountsPayload = await accountsRes.json() as { data?: { accounts?: Array<Record<string, unknown>> } };
          const accountsList = accountsPayload?.data?.accounts ?? [];
          if (Array.isArray(accountsList) && accountsList.length > 0) {
            accountId = String(accountsList[0].loginid ?? accountsList[0].account_id ?? "");
          }
        }
      } catch {
        // REST endpoint not available — try to get account ID from authenticated WS
      }
    }

    if (!accountId) {
      return NextResponse.json({ trades: [], total: 0, error: "Not authenticated — please log in with Deriv" }, { status: 401 });
    }

    const wsUrl = await getOtpUrl(accountId, session.accessToken);
    const profitData = await authWsRequest<{
      profit_table?: {
        transactions?: Record<string, unknown>[];
        count?: number;
        loginid?: string;
      };
    }>(
      wsUrl,
      { profit_table: 1, limit, offset: 0 },
      "profit_table",
    );

    const profitTable = profitData.profit_table;
    const rawTrades = profitTable?.transactions ?? [];
    const accountLoginid = profitTable?.loginid ?? accountId;

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
      total: profitTable?.count ?? trades.length,
      authenticated: true,
    });
  } catch (err) {
    console.error("Failed to fetch trades:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ trades: [], total: 0, error: `${message}` });
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
