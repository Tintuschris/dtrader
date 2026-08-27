import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/deriv-session";
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

const OPTIONS_REST_URL = "https://api.derivws.com/trading/v1/options";

let balanceCache: { accounts: AccountBalance[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 30_000;

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
  console.log("[Balances] GET /accounts status:", res.status);
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.warn("[Balances] GET /accounts error body:", errBody.substring(0, 500));
    return [];
  }
  const raw = await res.json();
  console.log("[Balances] GET /accounts response keys:", Object.keys(raw ?? {}));
  // Try multiple possible response shapes
  const accounts =
    raw?.data?.accounts ??   // { data: { accounts: [...] } }
    raw?.data ??              // { data: [...] }
    raw?.accounts ??          // { accounts: [...] }
    (Array.isArray(raw) ? raw : []);  // [...]
  console.log("[Balances] Parsed accounts count:", Array.isArray(accounts) ? accounts.length : "not array");
  if (Array.isArray(accounts) && accounts.length > 0) {
    console.log("[Balances] First account keys:", Object.keys(accounts[0]));
  }
  return Array.isArray(accounts) ? accounts : [];
}

/** Get an authenticated WebSocket URL via OTP. */
async function getOtpUrl(accountId: string, accessToken: string): Promise<string> {
  const appId = process.env.DERIV_APP_ID ?? "";
  const res = await fetch(`${OPTIONS_REST_URL}/accounts/${encodeURIComponent(accountId)}/otp`, {
    method: "POST",
    headers: { "Deriv-App-ID": appId, Authorization: "Bearer " + accessToken },
    cache: "no-store",
  });
  console.log("[Balances] OTP status for", accountId, ":", res.status);
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.warn("[Balances] OTP error body:", errBody.substring(0, 500));
    throw new Error("OTP failed: HTTP " + res.status);
  }
  const payload = (await res.json()) as { data?: { url?: string } };
  const wsUrl = payload?.data?.url;
  if (!wsUrl) throw new Error("No WebSocket URL in OTP response");
  return wsUrl;
}

/** Send a request to an authenticated Deriv WebSocket and wait for the expected response. */
function wsRequest<T>(wsUrl: string, payload: Record<string, unknown>, msgType: string, timeoutMs = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => { ws.close(); reject(new Error("WS timeout (" + timeoutMs + "ms)")); }, timeoutMs);
    ws.on("open", () => ws.send(JSON.stringify(payload)));
    ws.on("message", (event) => {
      try {
        const msg = JSON.parse(String(event));
        if (msg.msg_type === msgType) {
          clearTimeout(timer); ws.close();
          if (msg.error) reject(new Error(msg.error.message ?? JSON.stringify(msg.error)));
          else resolve(msg);
        }
      } catch { /* ignore non-JSON */ }
    });
    ws.on("error", (err) => { clearTimeout(timer); reject(err); });
    ws.on("close", () => clearTimeout(timer));
  });
}

function extractLoginId(acct: Record<string, unknown>): string {
  return String(acct.loginid ?? acct.account_id ?? acct.accountId ?? acct.id ?? "");
}

function extractAccountType(acct: Record<string, unknown>): "demo" | "real" {
  const raw = String(acct.account_type ?? acct.accountType ?? acct.type ?? "demo").toLowerCase();
  return raw.includes("real") ? "real" : "demo";
}

export async function GET() {
  if (balanceCache && Date.now() - balanceCache.timestamp < CACHE_TTL_MS) {
    return NextResponse.json({ accounts: balanceCache.accounts, cached: true });
  }

  const session = await getSession();
  if (!session?.accessToken) {
    console.log("[Balances] No session or no accessToken");
    return NextResponse.json({ accounts: [], error: "Not authenticated" }, { status: 401 });
  }

  try {
    // Step 1: Get the account list — try session.loginId first, then fetch from REST
    let accountId = session.loginId;
    let accountsRaw: Array<Record<string, unknown>> = [];

    if (!accountId) {
      console.log("[Balances] No loginId in session, fetching accounts list...");
      accountsRaw = await fetchAccountsList(session.accessToken);
      if (accountsRaw.length > 0) {
        accountId = extractLoginId(accountsRaw[0]);
        console.log("[Balances] Extracted accountId:", accountId);
      }
    }

    if (!accountId) {
      console.warn("[Balances] Could not determine accountId — returning empty");
      return NextResponse.json({ accounts: [], error: "Could not determine account ID. Please log out and log back in." });
    }

    // Step 2: Get balance via OTP → authenticated WebSocket
    const accounts: AccountBalance[] = [];
    try {
      const wsUrl = await getOtpUrl(accountId, session.accessToken);

      // Try to get account list via WS first
      let wsAccounts: Array<Record<string, unknown>> = [];
      try {
        const acctsData = await wsRequest<{ accounts?: Array<Record<string, unknown>> }>(
          wsUrl, { accounts: 1 }, "accounts", 8000
        );
        wsAccounts = acctsData.accounts ?? [];
        console.log("[Balances] WS accounts count:", wsAccounts.length);
      } catch (err) {
        console.log("[Balances] WS accounts request failed:", err instanceof Error ? err.message : err);
      }

      // If WS returned accounts, use those; otherwise fall back to REST list
      const allAccounts = wsAccounts.length > 0 ? wsAccounts : accountsRaw.length > 0 ? accountsRaw : [{ loginid: accountId }];

      for (const acct of allAccounts) {
        const id = extractLoginId(acct);
        if (!id) continue;
        const type = extractAccountType(acct);
        const currency = String(acct.currency ?? "USD");

        try {
          // Get OTP for this specific account to query its balance
          const subWsUrl = await getOtpUrl(id, session.accessToken);
          const balanceData = await wsRequest<{ balance?: { balance?: number; currency?: string } }>(
            subWsUrl, { balance: 1, subscribe: 0 }, "balance", 8000
          );
          const bal = balanceData.balance?.balance;
          accounts.push({
            id, loginid: id, type,
            currency: balanceData.balance?.currency ?? currency,
            balance: typeof bal === "number" ? bal : null,
          });
          console.log("[Balances] Got balance for", id, ":", bal);
        } catch (err) {
          console.warn("[Balances] Failed to get balance for", id, ":", err instanceof Error ? err.message : err);
          accounts.push({ id, loginid: id, type, currency, balance: null });
        }
      }
    } catch (err) {
      console.error("[Balances] OTP/WS flow failed:", err instanceof Error ? err.message : err);
    }

    balanceCache = { accounts, timestamp: Date.now() };
    return NextResponse.json({ accounts });
  } catch (err) {
    console.error("[Balances] Unexpected error:", err);
    return NextResponse.json({ accounts: [], error: "Failed to fetch balances" }, { status: 500 });
  }
}
