/**
 * Deriv Wallet REST API helpers.
 *
 * All endpoints require:
 *   - Authorization: Bearer <OAuth token with `payment` scope>
 *   - Deriv-App-ID: <DERIV_APP_ID>
 */

import { getSession, getAuthHeaders } from "./deriv-session";

const WALLET_BASE = "https://api.derivws.com/wallet/v1";

type WalletError = { status: number; code: string; message: string; field?: string };

export type WalletApiResponse<T> = {
  data?: T;
  errors?: WalletError[];
};

/* ------------------------------------------------------------------ */
/*  Low-level fetch wrapper                                           */
/* ------------------------------------------------------------------ */

async function walletFetch<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = await getAuthHeaders();
  if (!headers) throw new Error("Not authenticated");

  const res = await fetch(`${WALLET_BASE}${path}`, {
    ...init,
    headers: {
      ...headers,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });

  const body = (await res.json().catch(() => null)) as WalletApiResponse<T> | null;

  if (!res.ok || body?.errors?.length) {
    const msg =
      body?.errors?.[0]?.message ??
      `Wallet API error: HTTP ${res.status}`;
    const err = new Error(msg) as Error & { status?: number; code?: string };
    err.status = res.status;
    err.code = body?.errors?.[0]?.code;
    throw err;
  }

  // Some endpoints return the payload at root level, some under `data`.
  return (body?.data ?? body) as T;
}

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export type WalletEntry = {
  wallet_id: string;        // UUID
  type: string;             // "main" | "p2p" | "partner" | "payment_agent"
  balances: Record<string, { balance?: string | number }>;
};

export type WalletBalance = {
  wallet_id: string;
  type: string;
  currency: string;
  balance: number;
  balance_usd?: number | null;
};

export type WalletTransaction = {
  transaction_id: string;
  amount: string;
  currency: string;
  balance_after: string;
  description: string;
  category: string;
  channel: string;
  created_at: string;
  request_id?: string;
};

export type TransactionsResponse = {
  transactions: WalletTransaction[];
  links?: { next?: string; prev?: string };
};

export type ExchangeRateResponse = {
  exchange_rate: string;
  rate_token: string;
  source_currency: string;
  destination_currency: string;
};

export type ValidateResponse = {
  is_valid: boolean;
  fee?: string;
  net_amount?: string;
  estimated_destination_amount?: string;
  source_currency?: string;
  destination_currency?: string;
};

export type TransferResponse = {
  request_id: string;
  status: string;
};

/* ------------------------------------------------------------------ */
/*  Public API functions                                              */
/* ------------------------------------------------------------------ */

/** Fetch wallets with balances. */
export async function fetchWallets(conversionCurrency?: string): Promise<WalletBalance[]> {
  const qs = conversionCurrency ? `?conversion_currency=${conversionCurrency}` : "";
  const raw = await walletFetch<{ wallets?: WalletEntry[] }>(`/wallets${qs}`);
  const wallets = raw.wallets ?? [];
  const result: WalletBalance[] = [];
  for (const w of wallets) {
    for (const [currency, val] of Object.entries(w.balances)) {
      result.push({
        wallet_id: w.wallet_id,
        type: w.type,
        currency,
        balance: Number(val.balance ?? 0),
      });
    }
  }
  return result;
}

/** Fetch transactions for a wallet type. */
export async function fetchTransactions(
  walletType: string,
  opts?: { limit?: number; request_id?: string; currency?: string; start_date?: string; end_date?: string },
): Promise<TransactionsResponse> {
  const params = new URLSearchParams();
  if (opts?.limit) params.set("limit", String(opts.limit));
  if (opts?.request_id) params.set("request_id", opts.request_id);
  if (opts?.currency) params.set("transaction_currency", opts.currency);
  if (opts?.start_date) params.set("start_date_time", opts.start_date);
  if (opts?.end_date) params.set("end_date_time", opts.end_date);
  const qs = params.toString() ? `?${params}` : "";
  return walletFetch<TransactionsResponse>(`/transactions/${encodeURIComponent(walletType)}${qs}`);
}

/** Get an exchange rate quote between two currencies. */
export async function getExchangeRate(
  sourceCurrency: string,
  destinationCurrency: string,
): Promise<ExchangeRateResponse> {
  const params = new URLSearchParams({
    source_currency: sourceCurrency,
    destination_currency: destinationCurrency,
  });
  return walletFetch<ExchangeRateResponse>(`/exchange-rate?${params}`);
}

/** Validate a transfer without executing it. */
export async function validateTransfer(payload: {
  source_wallet_id: string;
  destination_wallet_id: string;
  amount: string;
  currency?: string;
  exchange_rate?: string;
  rate_token?: string;
  direction?: string;
  account_id?: string;
}): Promise<ValidateResponse> {
  return walletFetch<ValidateResponse>("/transfers/validate", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Execute a same-currency transfer between wallets. */
export async function executeWalletTransfer(payload: {
  source_wallet_id: string;
  destination_wallet_id: string;
  amount: string;
  currency?: string;
  request_id: string;
}): Promise<TransferResponse> {
  return walletFetch<TransferResponse>("/transfers", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Execute a cross-currency transfer between wallets. */
export async function executeCrossCurrencyTransfer(payload: {
  source_wallet_id: string;
  destination_wallet_id: string;
  amount: string;
  exchange_rate: string;
  rate_token: string;
  request_id: string;
}): Promise<TransferResponse> {
  return walletFetch<TransferResponse>("/transfers/exchange", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Execute a transfer between a wallet and a trading platform account. */
export async function executePlatformTransfer(payload: {
  direction: "from_wallet" | "to_wallet";
  account_id: string;
  amount: string;
  currency: string;
  wallet_currency?: string;
  exchange_rate?: string;
  rate_token?: string;
  request_id: string;
}): Promise<TransferResponse> {
  return walletFetch<TransferResponse>("/transfers/platforms", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
