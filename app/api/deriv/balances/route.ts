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
  account_type?: string; // Options, CFDs, cTrader, Wallet, etc.
  account_subtype?: string; // Standard, Pro, etc.
  is_wallet?: boolean; // Whether this is a main wallet account
};

const OPTIONS_REST_URL = "https://api.derivws.com/trading/v1/options";
const CFD_REST_URL = "https://api.derivws.com/trading/v1/cfds";
const MULTIPLIERS_REST_URL = "https://api.derivws.com/trading/v1/multipliers";
const WALLET_REST_URL = "https://api.derivws.com/trading/v1/wallet";

let balanceCache: { accounts: AccountBalance[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 30_000;

/** Fetch the list of accounts from Deriv's REST endpoint for a specific trading type. */
async function fetchAccountsList(accessToken: string, baseUrl: string): Promise<Array<Record<string, unknown>>> {
  const appId = process.env.DERIV_APP_ID ?? "";
  const res = await fetch(`${baseUrl}/accounts`, {
    method: "GET",
    headers: {
      Authorization: "Bearer " + accessToken,
      "Deriv-App-ID": appId,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  console.log("[Balances] GET", baseUrl, "/accounts status:", res.status);
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.warn("[Balances] GET", baseUrl, "/accounts error body:", errBody.substring(0, 500));
    return [];
  }
  const raw = await res.json();
  console.log("[Balances] GET", baseUrl, "/accounts response keys:", Object.keys(raw ?? {}));
  // Try multiple possible response shapes
  const accounts =
    raw?.data?.accounts ??   // { data: { accounts: [...] } }
    raw?.data ??              // { data: [...] }
    raw?.accounts ??          // { accounts: [...] }
    (Array.isArray(raw) ? raw : []);  // [...]
  console.log("[Balances] Parsed accounts count from", baseUrl, ":", Array.isArray(accounts) ? accounts.length : "not array");
  if (Array.isArray(accounts) && accounts.length > 0) {
    console.log("[Balances] First account keys from", baseUrl, ":", Object.keys(accounts[0]));
  }
  return Array.isArray(accounts) ? accounts : [];
}

/** Fetch accounts from all available trading endpoints. */
async function fetchAllAccounts(accessToken: string): Promise<Array<{ account: Record<string, unknown>; type: string; is_wallet?: boolean }>> {
  const allAccounts: Array<{ account: Record<string, unknown>; type: string; is_wallet?: boolean }> = [];
  
  // Try Wallet endpoint first (main wallet)
  try {
    const walletAccounts = await fetchAccountsList(accessToken, WALLET_REST_URL);
    walletAccounts.forEach(acct => allAccounts.push({ account: acct, type: "Wallet", is_wallet: true }));
  } catch (err) {
    console.log("[Balances] Wallet endpoint failed:", err instanceof Error ? err.message : err);
  }

  // Try Options endpoint
  try {
    const optionsAccounts = await fetchAccountsList(accessToken, OPTIONS_REST_URL);
    optionsAccounts.forEach(acct => allAccounts.push({ account: acct, type: "Options", is_wallet: false }));
  } catch (err) {
    console.log("[Balances] Options endpoint failed:", err instanceof Error ? err.message : err);
  }

  // Try CFDs endpoint
  try {
    const cfdAccounts = await fetchAccountsList(accessToken, CFD_REST_URL);
    cfdAccounts.forEach(acct => allAccounts.push({ account: acct, type: "CFDs", is_wallet: false }));
  } catch (err) {
    console.log("[Balances] CFDs endpoint failed:", err instanceof Error ? err.message : err);
  }

  // Try Multipliers endpoint
  try {
    const multiplierAccounts = await fetchAccountsList(accessToken, MULTIPLIERS_REST_URL);
    multiplierAccounts.forEach(acct => allAccounts.push({ account: acct, type: "Multipliers", is_wallet: false }));
  } catch (err) {
    console.log("[Balances] Multipliers endpoint failed:", err instanceof Error ? err.message : err);
  }

  return allAccounts;
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
    // Step 1: Fetch all accounts from all trading endpoints
    console.log("[Balances] Fetching accounts from all trading endpoints...");
    const allAccountsWithType = await fetchAllAccounts(session.accessToken);
    
    if (allAccountsWithType.length === 0) {
      console.warn("[Balances] No accounts found from any endpoint");
      return NextResponse.json({ accounts: [], error: "No accounts found. Please log out and log back in." });
    }

    console.log("[Balances] Total accounts found:", allAccountsWithType.length);

    // Step 2: Get balance for each account via OTP → authenticated WebSocket
    const accounts: AccountBalance[] = [];
    
    for (const { account: acct, type: tradingType, is_wallet } of allAccountsWithType) {
      const id = extractLoginId(acct);
      if (!id) continue;
      
      const type = extractAccountType(acct);
      const currency = String(acct.currency ?? "USD");
      const accountSubtype = String(acct.account_subtype ?? acct.subtype ?? "Standard");

      try {
        // Get OTP for this specific account to query its balance
        const subWsUrl = await getOtpUrl(id, session.accessToken);
        const balanceData = await wsRequest<{ balance?: { balance?: number; currency?: string } }>(
          subWsUrl, { balance: 1, subscribe: 0 }, "balance", 8000
        );
        const bal = balanceData.balance?.balance;
        accounts.push({
          id, 
          loginid: id, 
          type,
          currency: balanceData.balance?.currency ?? currency,
          balance: typeof bal === "number" ? bal : null,
          account_type: tradingType,
          account_subtype: accountSubtype,
          is_wallet,
        });
        console.log("[Balances] Got balance for", id, `(${tradingType}${is_wallet ? ' - WALLET' : ''}):`, bal);
      } catch (err) {
        console.warn("[Balances] Failed to get balance for", id, `(${tradingType}${is_wallet ? ' - WALLET' : ''}):`, err instanceof Error ? err.message : err);
        accounts.push({ 
          id, 
          loginid: id, 
          type, 
          currency, 
          balance: null,
          account_type: tradingType,
          account_subtype: accountSubtype,
          is_wallet,
        });
      }
    }

    balanceCache = { accounts, timestamp: Date.now() };
    return NextResponse.json({ accounts });
  } catch (err) {
    console.error("[Balances] Unexpected error:", err);
    return NextResponse.json({ accounts: [], error: "Failed to fetch balances" }, { status: 500 });
  }
}
