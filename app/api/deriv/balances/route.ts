import { NextResponse } from "next/server";
import { getSession, getAuthHeaders } from "../../../../lib/deriv-session";
import WebSocket from "ws";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AccountBalance = {
  id: string;
  loginid: string;
  type: "demo" | "real";
  currency: string;
  balance: number | null;
};

/**
 * GET /api/deriv/balances
 *
 * Fetches all Deriv account balances using the Options API authenticated WebSocket.
 * Step 1: Get list of accounts via OTP endpoint
 * Step 2: For each account, get an OTP and query balance
 */

let balanceCache: { accounts: AccountBalance[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 30_000;

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
  if (!wsUrl) throw new Error("No WebSocket URL returned from OTP endpoint");
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

export async function GET() {
  if (balanceCache && Date.now() - balanceCache.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({ accounts: balanceCache.accounts, cached: true });
  }

  const session = await getSession();
  if (!session?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    // Step 1: Get list of accounts via the OTP endpoint (using first account)
    // The accounts list is available through the authenticated WebSocket
    // We'll use the demo account to get the list
    const accountsRes = await fetch(`${OPTIONS_REST_URL}/accounts`, {
      method: "GET",
      headers: await getAuthHeaders() ?? {},
      cache: "no-store",
    });

    if (!accountsRes.ok) {
      // Fallback: return empty list
      return NextResponse.json({ accounts: [] });
    }

    const accountsPayload = await accountsRes.json() as { data?: { accounts?: Array<Record<string, unknown>> } };
    const accountsList = accountsPayload?.data?.accounts ?? [];

    if (!Array.isArray(accountsList) || accountsList.length === 0) {
      return NextResponse.json({ accounts: [] });
    }

    // Step 2: Get balance for each account via authenticated WebSocket
    const accounts: AccountBalance[] = await Promise.all(
      accountsList.map(async (a): Promise<AccountBalance> => {
        const loginid = String(a.loginid ?? a.account_id ?? "");
        const id = loginid;
        const rawType = String(a.account_type ?? a.type ?? "demo").toLowerCase();
        const type: "demo" | "real" = rawType.includes("real") ? "real" : "demo";
        const currency = String(a.currency ?? "USD");

        if (!id) {
          return { id: "", loginid: "", type: "demo", currency: "USD", balance: null };
        }

        try {
          const wsUrl = await getOtpUrl(id, session.accessToken);
          const balanceData = await authWsRequest<{ balance?: { balance?: number } }>(
            wsUrl,
            { balance: 1, subscribe: 0 },
            "balance",
          );
          const balance = balanceData.balance?.balance;
          return {
            id,
            loginid,
            type,
            currency,
            balance: typeof balance === "number" ? balance : null,
          };
        } catch {
          return { id, loginid, type, currency, balance: null };
        }
      }),
    );

    balanceCache = { accounts, timestamp: Date.now() };
    return NextResponse.json({ accounts });
  } catch (err) {
    console.error("Failed to fetch balances:", err);
    return NextResponse.json({ error: "Failed to fetch account balances" }, { status: 500 });
  }
}
