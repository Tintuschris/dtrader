"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import { useAuth } from "./use-auth";
import type { DerivAccount } from "./use-deriv-ws";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type WalletData = {
  wallet_id: string;
  walletType: string;
  currency: string;
  balance: number | null;
};

export type TransactionData = {
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

export type DerivContextValue = {
  // Auth
  authenticated: boolean;
  authLoading: boolean;
  authAccounts: DerivAccount[];
  authError: string | null;
  login: () => Promise<void>;
  logout: () => Promise<void>;

  // Active account
  activeAccountId: string;
  activeAccount: DerivAccount | undefined;
  setActiveAccount: (account: DerivAccount) => void;
};

const DerivContext = createContext<DerivContextValue | null>(null);

/* ------------------------------------------------------------------ */
/*  Query Client                                                       */
/* ------------------------------------------------------------------ */

/**
 * Exponential backoff delay with full jitter.
 * Attempt 0 → 0-1s, 1 → 0-2s, 2 → 0-4s, 3 → 0-8s (capped at 30s).
 */
function exponentialBackoff(attempt: number): number {
  const base = Math.min(1000 * Math.pow(2, attempt), 30_000);
  return Math.round(base * Math.random());
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,       // 30s — data is fresh for 30s
        gcTime: 5 * 60_000,      // 5min — garbage collect after 5min
        retry: 2,
        retryDelay: exponentialBackoff,
        refetchOnWindowFocus: false,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient() {
  if (typeof window === "undefined") {
    // Server: always make a new query client
    return makeQueryClient();
  }
  // Browser: make a new query client if we don't already have one
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}

/* ------------------------------------------------------------------ */
/*  Provider                                                           */
/* ------------------------------------------------------------------ */

export function DerivProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(getQueryClient);

  const {
    loading: authLoading,
    authenticated,
    accounts: authAccounts,
    error: authError,
    login,
    logout,
  } = useAuth();

  // Active account selection — persisted in sessionStorage
  const [activeAccountId, setActiveAccountId] = useState(() => {
    if (typeof window !== "undefined") {
      return sessionStorage.getItem("deriv_active_account") ?? "";
    }
    return "";
  });

  const activeAccount = authAccounts.find((a) => a.id === activeAccountId);

  const setActiveAccount = useCallback((account: DerivAccount) => {
    setActiveAccountId(account.id);
    if (typeof window !== "undefined") {
      sessionStorage.setItem("deriv_active_account", account.id);
    }
  }, []);

  // Auto-select preferred account on first auth
  useEffect(() => {
    if (!authLoading && authAccounts.length > 0 && !activeAccountId) {
      const preferred = authAccounts.find((a) => a.type === "demo") ?? authAccounts[0];
      setActiveAccount(preferred);
    }
  }, [authLoading, authAccounts, activeAccountId, setActiveAccount]);

  const value: DerivContextValue = {
    authenticated,
    authLoading,
    authAccounts,
    authError,
    login: useCallback(async () => { await login(); }, [login]),
    logout: useCallback(async () => { await logout(); }, [logout]),
    activeAccountId,
    activeAccount,
    setActiveAccount,
  };

  return (
    <QueryClientProvider client={queryClient}>
      <DerivContext.Provider value={value}>
        {children}
      </DerivContext.Provider>
    </QueryClientProvider>
  );
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useDeriv() {
  const ctx = useContext(DerivContext);
  if (!ctx) throw new Error("useDeriv must be used within a DerivProvider");
  return ctx;
}

/* ------------------------------------------------------------------ */
/*  REST API fetch helpers (used by React Query hooks)                  */
/* ------------------------------------------------------------------ */

export async function fetchDerivApi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { cache: "no-store", ...init });
  const data = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `API error: ${res.status}`);
  }
  return data;
}
