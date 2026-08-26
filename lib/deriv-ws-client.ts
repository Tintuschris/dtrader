/**
 * Deriv Options API (v1) WebSocket Client
 *
 * Uses the Options API v1 public WebSocket for market data (active_symbols, ticks).
 * Uses authenticated WebSocket (via OTP) for account operations (balance, profit_table).
 *
 * Public:  wss://api.derivws.com/trading/v1/options/ws/public
 * Demo:    wss://api.derivws.com/trading/v1/options/ws/demo?otp=...
 * Real:    wss://api.derivws.com/trading/v1/options/ws/real?otp=...
 */

import WebSocket from "ws";
import { getSession, getAuthHeaders } from "./deriv-session";

const OPTIONS_WS_URL = "wss://api.derivws.com/trading/v1/options/ws";
const OPTIONS_REST_URL = "https://api.derivws.com/trading/v1/options";

/* ------------------------------------------------------------------ */
/*  Public WebSocket — no auth required                                */
/* ------------------------------------------------------------------ */

/**
 * Make a request to the Options API public WebSocket.
 * Opens a temporary connection, sends the request, waits for matching response, then closes.
 */
export async function derivPublicRequest<T = Record<string, unknown>>(
  payload: Record<string, unknown>,
  expectedMsgType: string,
  timeoutMs = 15_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${OPTIONS_WS_URL}/public`);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Deriv public request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.on("open", () => {
      ws.send(JSON.stringify(payload));
    });

    ws.on("message", (event) => {
      try {
        const msg = JSON.parse(String(event)) as Record<string, unknown>;
        if (msg.msg_type === expectedMsgType) {
          clearTimeout(timer);
          ws.close();
          if (msg.error) {
            const errMsg = (msg.error as Record<string, string>).message ?? JSON.stringify(msg.error);
            reject(new Error(`Deriv API error: ${errMsg}`));
          } else {
            resolve(msg as T);
          }
        }
      } catch { /* ignore non-JSON */ }
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Deriv WebSocket error: ${err.message}`));
    });

    ws.on("close", () => clearTimeout(timer));
  });
}

/* ------------------------------------------------------------------ */
/*  Authenticated WebSocket — requires OTP                             */
/* ------------------------------------------------------------------ */

/**
 * Get an authenticated WebSocket URL via the OTP endpoint.
 */
async function getAuthenticatedWsUrl(accountId: string): Promise<string> {
  const session = await getSession();
  if (!session?.accessToken) {
    throw new Error("Not authenticated");
  }

  const appId = process.env.DERIV_APP_ID;
  if (!appId) {
    throw new Error("DERIV_APP_ID not configured");
  }

  const response = await fetch(`${OPTIONS_REST_URL}/accounts/${encodeURIComponent(accountId)}/otp`, {
    method: "POST",
    headers: {
      "Deriv-App-ID": appId,
      Authorization: `Bearer ${session.accessToken}`,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`OTP request failed: HTTP ${response.status}`);
  }

  const payload = await response.json() as { data?: { url?: string } };
  const wsUrl = payload?.data?.url;
  if (!wsUrl) {
    throw new Error("No WebSocket URL returned from OTP endpoint");
  }

  return wsUrl;
}

/**
 * Make a request to the Options API authenticated WebSocket.
 */
export async function derivAuthRequest<T = Record<string, unknown>>(
  accountId: string,
  payload: Record<string, unknown>,
  expectedMsgType: string,
  timeoutMs = 15_000,
): Promise<T> {
  const wsUrl = await getAuthenticatedWsUrl(accountId);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`Deriv auth request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    ws.on("open", () => {
      ws.send(JSON.stringify(payload));
    });

    ws.on("message", (event) => {
      try {
        const msg = JSON.parse(String(event)) as Record<string, unknown>;
        if (msg.msg_type === expectedMsgType) {
          clearTimeout(timer);
          ws.close();
          if (msg.error) {
            const errMsg = (msg.error as Record<string, string>).message ?? JSON.stringify(msg.error);
            reject(new Error(`Deriv API error: ${errMsg}`));
          } else {
            resolve(msg as T);
          }
        }
      } catch { /* ignore non-JSON */ }
    });

    ws.on("error", (err) => {
      clearTimeout(timer);
      reject(new Error(`Deriv WebSocket error: ${err.message}`));
    });

    ws.on("close", () => clearTimeout(timer));
  });
}

/* ------------------------------------------------------------------ */
/*  Convenience functions                                              */
/* ------------------------------------------------------------------ */

/**
 * Get active symbols from Options API public WebSocket.
 * Note: Options API uses `underlying_symbol` and `underlying_symbol_name` instead of `symbol` and `display_name`.
 */
export async function getActiveSymbols(): Promise<Array<{
  underlying_symbol: string;
  underlying_symbol_name: string;
  market: string;
  submarket: string;
  exchange_is_open: number;
  pip_size: number;
}>> {
  const data = await derivPublicRequest<{ active_symbols?: Array<Record<string, unknown>> }>(
    { active_symbols: "brief" },
    "active_symbols",
  );
  return (data.active_symbols ?? []) as Array<{
    underlying_symbol: string;
    underlying_symbol_name: string;
    market: string;
    submarket: string;
    exchange_is_open: number;
    pip_size: number;
  }>;
}

/**
 * Get profit table via authenticated WebSocket.
 */
export async function getProfitTable(
  accountId: string,
  limit: number = 50,
): Promise<{
  transactions: Record<string, unknown>[];
  count: number;
  loginid: string;
}> {
  const data = await derivAuthRequest<{
    profit_table?: {
      transactions?: Record<string, unknown>[];
      count?: number;
      loginid?: string;
    };
  }>(
    accountId,
    { profit_table: 1, limit, offset: 0 },
    "profit_table",
  );
  return {
    transactions: data.profit_table?.transactions ?? [],
    count: data.profit_table?.count ?? 0,
    loginid: data.profit_table?.loginid ?? "",
  };
}

/**
 * Get accounts via authenticated WebSocket.
 */
export async function getAccounts(accountId: string): Promise<Record<string, unknown>[]> {
  const data = await derivAuthRequest<{ accounts?: Record<string, unknown>[] }>(
    accountId,
    { accounts: 1 },
    "accounts",
  );
  return data.accounts ?? [];
}

/**
 * Get tick history from Options API public WebSocket.
 * Note: This may not be supported on the public endpoint.
 */
export async function getTicksHistory(
  symbol: string,
  count: number = 100,
): Promise<number[]> {
  const data = await derivPublicRequest<{
    tick_history?: { prices?: (number | string)[] };
    history?: { prices?: (number | string)[] };
  }>(
    {
      ticks_history: symbol,
      adjust_start_time: 1,
      count,
      end: "latest",
      style: "ticks",
    },
    "tick_history",
  );
  const prices = data.tick_history?.prices ?? data.history?.prices ?? [];
  return prices.map(Number);
}
