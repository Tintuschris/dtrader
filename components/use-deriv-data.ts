"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { fetchDerivApi } from "./deriv-provider";

/* ------------------------------------------------------------------ */
/*  Retry with exponential backoff + jitter                            */
/* ------------------------------------------------------------------ */

/**
 * Exponential backoff delay with full jitter.
 * Attempt 0 → 0-1s, 1 → 0-2s, 2 → 0-4s, 3 → 0-8s, 4 → 0-16s (capped at 30s).
 * Full jitter prevents thundering herd when multiple queries retry together.
 */
export function exponentialBackoff(attempt: number): number {
  const base = Math.min(1000 * Math.pow(2, attempt), 30_000);
  return Math.round(base * Math.random());
}

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type WalletBalance = {
  id: string;
  walletType: string;
  currency: string;
  balance: number | null;
};

export type AccountBalance = {
  id: string;
  loginid: string;
  type: "demo" | "real";
  currency: string;
  balance?: number | null;
  account_type?: string;
  account_subtype?: string;
  is_wallet?: boolean;
};

export type Transaction = {
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

export type DerivContract = {
  contract_id: string;
  contract_type: string;
  symbol: string;
  buy_price: number;
  payout: number;
  profit: number;
  status: string;
  barrier?: string;
  purchase_time: number;
  sell_time?: number;
};

export type TransferPreview = {
  mode: "preview";
  is_valid: boolean;
  source_currency: string;
  destination_currency: string;
  amount: string;
  fee: string;
  net_amount: string;
  estimated_destination_amount: string;
  exchange_rate?: string;
  rate_token?: string;
  error?: string;
  platform_name?: string;
};

export type TransferResult = {
  mode: "executed";
  success: boolean;
  request_id: string;
  status: string;
};

/* ------------------------------------------------------------------ */
/*  Query Keys                                                         */
/* ------------------------------------------------------------------ */

export const queryKeys = {
  wallets: ["deriv", "wallets"] as const,
  platformAccounts: ["deriv", "platformAccounts"] as const,
  transactions: (walletType: string) => ["deriv", "transactions", walletType] as const,
  portfolio: (accountId: string) => ["deriv", "portfolio", accountId] as const,
  tradeHistory: (accountId: string) => ["deriv", "trades", accountId] as const,
  exchangeRate: (from: string, to: string) => ["deriv", "exchangeRate", from, to] as const,
};

/* ------------------------------------------------------------------ */
/*  Wallet Balances Hook                                               */
/* ------------------------------------------------------------------ */

export function useWallets() {
  return useQuery({
    queryKey: queryKeys.wallets,
    queryFn: async () => {
      const data = await fetchDerivApi<{ wallets?: WalletBalance[] }>("/api/deriv/wallets");
      return data.wallets ?? [];
    },
    staleTime: 20_000,
    retry: 3,
    retryDelay: exponentialBackoff,
  });
}

/* ------------------------------------------------------------------ */
/*  Platform Accounts Hook                                             */
/* ------------------------------------------------------------------ */

export function usePlatformAccounts() {
  return useQuery({
    queryKey: queryKeys.platformAccounts,
    queryFn: async () => {
      const data = await fetchDerivApi<{ accounts?: AccountBalance[] }>("/api/deriv/balances");
      return data.accounts ?? [];
    },
    staleTime: 20_000,
    retry: 3,
    retryDelay: exponentialBackoff,
  });
}

/* ------------------------------------------------------------------ */
/*  Transactions Hook                                                  */
/* ------------------------------------------------------------------ */

export function useTransactions(walletType: string, enabled = true) {
  const [allTransactions, setAllTransactions] = useState<Transaction[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);

  const baseQuery = useQuery({
    queryKey: queryKeys.transactions(walletType),
    queryFn: async () => {
      const data = await fetchDerivApi<{ transactions?: Transaction[]; links?: { next?: string } }>(
        `/api/deriv/transactions?walletType=${encodeURIComponent(walletType)}&limit=50`,
      );
      setAllTransactions(data.transactions ?? []);
      setHasMore(!!data.links?.next);
      return data;
    },
    enabled,
    retry: 3,
    retryDelay: exponentialBackoff,
  });

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    setIsLoadingMore(true);
    try {
      const lastTx = allTransactions[allTransactions.length - 1];
      const data = await fetchDerivApi<{ transactions?: Transaction[]; links?: { next?: string } }>(
        `/api/deriv/transactions?walletType=${encodeURIComponent(walletType)}&limit=50&requestId=${lastTx?.request_id ?? ""}`,
      );
      const newTx = data.transactions ?? [];
      setAllTransactions((prev) => [...prev, ...newTx]);
      setHasMore(!!data.links?.next);
    } finally {
      setIsLoadingMore(false);
    }
  }, [walletType, allTransactions, hasMore, isLoadingMore]);

  return {
    ...baseQuery,
    transactions: allTransactions,
    hasMore,
    isLoadingMore,
    loadMore,
  };
}

/* ------------------------------------------------------------------ */
/*  Portfolio Hook (Open Positions)                                    */
/* ------------------------------------------------------------------ */

/**
 * Fetches open positions via the trading WebSocket (client-side).
 * The Options API WS supports `portfolio` — confirmed by Deriv docs.
 * Server-side fetch fails in Vercel because the `ws` npm package crashes
 * in serverless environments (TypeError: b.mask is not a function).
 */
export function usePortfolio(
  accountId: string,
  fetchFn?: () => Promise<{ positions: unknown[] } | null>,
) {
  return useQuery({
    queryKey: queryKeys.portfolio(accountId),
    queryFn: async () => {
      // Prefer client-side WS fetch (works in browser, not Vercel serverless)
      if (fetchFn) {
        const result = await fetchFn();
        const raw = result?.positions ?? [];
        return raw.map((item: any) => ({
          contract_id: String(item.contract_id ?? ""),
          contract_type: String(item.contract_type ?? ""),
          symbol: String(item.underlying_symbol ?? item.underlying ?? item.symbol ?? ""),
          buy_price: Number(item.buy_price ?? 0),
          payout: Number(item.payout ?? 0),
          profit: Number(item.profit ?? 0),
          status: String(item.status ?? "open"),
          barrier: item.barrier == null ? undefined : String(item.barrier),
          purchase_time: Number(item.purchase_time ?? 0),
        })) as DerivContract[];
      }
      // Fallback: server-side route (may fail in Vercel)
      const data = await fetchDerivApi<{ positions?: DerivContract[]; error?: string }>(
        `/api/deriv/portfolio?accountId=${encodeURIComponent(accountId)}`,
      );
      if (data.error) throw new Error(data.error);
      return data.positions ?? [];
    },
    enabled: !!accountId && !!fetchFn,
    retry: 4,
    retryDelay: exponentialBackoff,
    staleTime: 10_000,
  });
}

/* ------------------------------------------------------------------ */
/*  Trade History Hook (Profit Table)                                  */
/* ------------------------------------------------------------------ */

/**
 * Fetches closed trade history via the trading WebSocket (client-side).
 * If the Options WS returns UnrecognisedRequest for profit_table,
 * falls back to server-side Core API v3 route.
 */
export function useTradeHistory(
  accountId: string,
  limit = 500,
  fetchFn?: (opts?: { limit?: number; offset?: number }) => Promise<{ transactions: unknown[]; count: number } | null>,
) {
  return useQuery({
    queryKey: [...queryKeys.tradeHistory(accountId), limit],
    queryFn: async () => {
      // Prefer client-side WS fetch
      if (fetchFn) {
        const result = await fetchFn({ limit, offset: 0 });
        if (!result) return { trades: [] as DerivContract[], total: 0 };
        const trades = (result.transactions ?? []).map((item: any) => {
          const sellPrice = Number(item.sell_price ?? 0);
          const buyPrice = Number(item.buy_price ?? 0);
          const profit = sellPrice - buyPrice;
          return {
            contract_id: String(item.contract_id ?? item.transaction_id ?? ""),
            contract_type: String(item.contract_type ?? ""),
            symbol: String(item.underlying_symbol ?? item.underlying ?? item.symbol ?? ""),
            buy_price: buyPrice,
            payout: Number(item.payout ?? item.sell_price ?? 0),
            profit,
            status: (String(item.status ?? "") || (profit > 0 ? "won" : profit < 0 ? "lost" : "break_even")) as string,
            barrier: item.barrier == null ? undefined : String(item.barrier),
            purchase_time: Number(item.purchase_time ?? item.transaction_time ?? 0),
            sell_time: Number(item.sell_time ?? 0) || undefined,
          } as DerivContract;
        });
        return { trades, total: result.count ?? trades.length };
      }
      // Fallback: server-side route
      const data = await fetchDerivApi<{ trades?: DerivContract[]; total?: number; error?: string }>(
        `/api/deriv/trades?accountId=${encodeURIComponent(accountId)}&limit=${limit}&offset=0`,
      );
      if (data.error) throw new Error(data.error);
      return { trades: data.trades ?? [], total: data.total ?? 0 };
    },
    enabled: !!accountId && !!fetchFn,
    retry: 4,
    retryDelay: exponentialBackoff,
    staleTime: 10_000,
  });
}

/* ------------------------------------------------------------------ */
/*  Exchange Rate Hook                                                 */
/* ------------------------------------------------------------------ */

export function useExchangeRate(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.exchangeRate(from, to),
    queryFn: async () => {
      const data = await fetchDerivApi<{ exchange_rate?: string }>(
        `/api/deriv/exchange-rate?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
      );
      return data.exchange_rate ?? null;
    },
    enabled: enabled && !!from && !!to && from !== to,
    staleTime: 30_000,
  });
}

/* ------------------------------------------------------------------ */
/*  Transfer Mutation                                                  */
/* ------------------------------------------------------------------ */

export function useTransfer() {
  const queryClient = useQueryClient();

  const validateMutation = useMutation({
    mutationFn: async (params: { from: string; to: string; amount: number }) => {
      const res = await fetch("/api/deriv/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Transfer validation failed");
      return data as TransferPreview;
    },
  });

  const executeMutation = useMutation({
    mutationFn: async (params: { from: string; to: string; amount: number }) => {
      const res = await fetch("/api/deriv/transfer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...params, confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Transfer failed");
      return data as TransferResult;
    },
    onSuccess: () => {
      // Invalidate wallet and account queries to refresh balances
      void queryClient.invalidateQueries({ queryKey: ["deriv", "wallets"] });
      void queryClient.invalidateQueries({ queryKey: ["deriv", "platformAccounts"] });
    },
  });

  return {
    validate: validateMutation,
    execute: executeMutation,
  };
}
