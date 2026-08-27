import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
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

/** Fetch the list of accounts from Deriv's REST endpoint. */
async function fetchAccountsList(accessToken: string): Promise<Array<Record<string, unknown>>> {
  const appId = process.env.DERIV_APP_ID ?? "";
  const res = await fetch(`${OPTIONS_REST_URL}/accounts`, {
    method: "GET",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Deriv-App-ID": appId,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  console.log("[Trades] GET /accounts status:", res.status);
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.warn("[Trades] GET /accounts error body:", errBody.substring(0, 500));
    return [];
  }
  const raw = await res.json();
  const accounts =
    raw?.data?.accounts ?? raw?.data ?? raw?.accounts ??
    (Array.isArray(raw) ? raw : []);
  console.log("[Trades] Parsed accounts count:", Array.isArray(accounts) ? accounts.length : "not array");
  return Array.isArray(accounts) ? accounts : [];
}

async function getOtpUrl(accountId: string, accessToken: string): Promise<string> {
  const appId = process.env.DERIV_APP_ID ?? "";
  const res = await fetch(`${OPTIONS_REST_URL}/accounts/${encodeURIComponent(accountId)}/otp`, {
    method: "POST",
    headers: { "Deriv-App-ID": appId, Authorization: "Bearer " + accessToken },
    cache: "no-store",
  });
  console.log("[Trades] OTP status for", accountId, ":", res.status);
  if (!res.ok) throw new Error("OTP failed: HTTP " + res.status);
  const payload = (await res.json()) as { data?: { url?: string } };
  const wsUrl = payload?.data?.url;
  if (!wsUrl) throw new Error("No WebSocket URL in OTP response");
  return wsUrl;
}

function wsRequest<T>(wsUrl: string, payload: Record<string, unknown>, msgType: string, timeoutMs = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error("WS timeout")); }, timeoutMs);
    ws.on("open", () => ws.send(JSON.stringify(payload)));
    ws.on("message", (event) => {
      try {
        const msg = JSON.parse(String(event));
        if (msg.msg_type === msgType) {
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

function extractLoginId(acct: Record<string, unknown>): string {
  return String(acct.loginid ?? acct.account_id ?? acct.accountId ?? acct.id ?? "");
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

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const limit = parseInt(searchParams.get("limit") ?? "50", 10);

  const session = await getSession();
  if (!session?.accessToken) {
    console.log("[Trades] No session");
    return NextResponse.json({ trades: [], total: 0, error: "Not authenticated. Please log in." }, { status: 401 });
  }

  try {
    // Step 1: Get accountId — try session first, then fetch from REST
    let accountId = session.loginId;
    let accountsRaw: Array<Record<string, unknown>> = [];

    if (!accountId) {
      console.log("[Trades] No loginId in session, fetching accounts list...");
      accountsRaw = await fetchAccountsList(session.accessToken);
      if (accountsRaw.length > 0) {
        accountId = extractLoginId(accountsRaw[0]);
        console.log("[Trades] Extracted accountId:", accountId);
      }
    }

    if (!accountId) {
      console.warn("[Trades] Could not determine accountId");
      return NextResponse.json({ trades: [], total: 0, error: "Could not determine account ID. Please log out and log back in." });
    }

    // Step 2: Get profit_table via OTP → authenticated WebSocket
    const wsUrl = await getOtpUrl(accountId, session.accessToken);
    const profitData = await wsRequest<{
      profit_table?: {
        transactions?: Record<string, unknown>[];
        count?: number;
        loginid?: string;
      };
    }>(wsUrl, { profit_table: 1, limit, offset: 0 }, "profit_table");

    const profitTable = profitData.profit_table;
    const rawTrades = profitTable?.transactions ?? [];
    const accountLoginid = profitTable?.loginid ?? accountId;

    console.log("[Trades] Got", rawTrades.length, "trades from Deriv for", accountLoginid);

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
    console.error("[Trades] Error:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ trades: [], total: 0, error: message });
  }
}
