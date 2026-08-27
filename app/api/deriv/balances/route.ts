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
    // Step 1: Get account ID from session (stored during OAuth) or fallback to REST endpoint
    let accountId = session.loginId;
    
    if (!accountId) {
      // Fallback: fetch accounts list from REST endpoint
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
        const accountsPayload = await accountsRes.json() as { data?: { accounts?: Array<Record<string, unknown>> } };
        const accountsList = accountsPayload?.data?.accounts ?? [];
        if (Array.isArray(accountsList) && accountsList.length > 0) {
          // Deriv returns "loginid" as the primary account identifier
          accountId = String(
            accountsList[0].loginid ??
            accountsList[0].account_id ??
            accountsList[0].accountId ??
            ""
          );
          console.log("[Balances] Fetched accountId from REST:", accountId);
        }
      } catch (err) {
        console.warn("[Balances] REST accounts fetch failed:", err);
      }
    }

    if (!accountId) {
      return NextResponse.json({ accounts: [] });
    }

    // Step 2: Get all sub-accounts via authenticated WebSocket
    // Deriv real accounts have sub-accounts (options, multipliers, etc.)
    let accounts: AccountBalance[] = [];
    try {
      const wsUrl = await getOtpUrl(accountId, session.accessToken);
      
      // First, get the list of all accounts
      const accountsData = await authWsRequest<{
        accounts?: Array<Record<string, unknown>>;
      }>(
        wsUrl,
        { accounts: 1 },
        "accounts",
      );

      const accountsList = accountsData.accounts ?? [];
      
      if (accountsList.length === 0) {
        // Fallback: just get balance for the main account
        const balanceData = await authWsRequest<{ balance?: { balance?: number; currency?: string } }>(
          wsUrl,
          { balance: 1, subscribe: 0 },
          "balance",
        );
        const bal = balanceData.balance?.balance;
        const currency = balanceData.balance?.currency ?? "USD";
        const type: "demo" | "real" = accountId.startsWith("VR") || accountId.includes("demo") ? "demo" : "real";
        accounts = [{
          id: accountId,
          loginid: accountId,
          type,
          currency,
          balance: typeof bal === "number" ? bal : null,
        }];
      } else {
        // Get balance for each sub-account
        for (const acct of accountsList) {
          const id = String(acct.loginid ?? acct.account_id ?? "");
          if (!id) continue;
          const rawType = String(acct.account_type ?? acct.type ?? "demo").toLowerCase();
          const type: "demo" | "real" = rawType.includes("real") ? "real" : "demo";
          const currency = String(acct.currency ?? "USD");
          
          try {
            // Get OTP for this specific sub-account
            const subWsUrl = await getOtpUrl(id, session.accessToken);
            const balanceData = await authWsRequest<{ balance?: { balance?: number; currency?: string } }>(
              subWsUrl,
              { balance: 1, subscribe: 0 },
              "balance",
            );
            const bal = balanceData.balance?.balance;
            accounts.push({
              id,
              loginid: id,
              type,
              currency: balanceData.balance?.currency ?? currency,
              balance: typeof bal === "number" ? bal : null,
            });
          } catch {
            accounts.push({ id, loginid: id, type, currency, balance: null });
          }
        }
      }
    } catch {
      accounts = [];
    }

    balanceCache = { accounts, timestamp: Date.now() };
    return NextResponse.json({ accounts });
  } catch (err) {
    console.error("Failed to fetch balances:", err);
    return NextResponse.json({ error: "Failed to fetch account balances" }, { status: 500 });
  }
}
