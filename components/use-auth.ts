"use client";

import { useCallback, useEffect, useState } from "react";
import type { DerivAccount } from "./use-deriv-ws";

export type AuthState = {
  loading: boolean;
  authenticated: boolean;
  accounts: DerivAccount[];
  scopes: string[];
  error: string | null;
};

const initialState: AuthState = {
  loading: true,
  authenticated: false,
  accounts: [],
  scopes: [],
  error: null,
};

export function useAuth() {
  const [state, setState] = useState<AuthState>(initialState);

  /** Check current session status */
  const checkSession = useCallback(async () => {
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const res = await fetch("/api/deriv/me", { cache: "no-store" });
      const data = (await res.json()) as {
        authenticated?: boolean;
        accounts?: DerivAccount[];
        scopes?: string[];
        error?: string;
      };
      setState({
        loading: false,
        authenticated: data.authenticated ?? false,
        accounts: data.accounts ?? [],
        scopes: data.scopes ?? [],
        error: data.error ?? null,
      });
    } catch {
      setState({
        loading: false,
        authenticated: false,
        accounts: [],
        scopes: [],
        error: "Failed to check authentication status",
      });
    }
  }, []);

  /** Redirect to Deriv OAuth login */
  const login = useCallback(async () => {
    try {
      const res = await fetch("/api/deriv/auth");
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        setState((prev) => ({
          ...prev,
          error: data.error ?? "Failed to start login",
        }));
      }
    } catch {
      setState((prev) => ({
        ...prev,
        error: "Failed to start login flow",
      }));
    }
  }, []);

  /** Logout and clear session */
  const logout = useCallback(async () => {
    try {
      await fetch("/api/deriv/logout", { method: "POST" });
      setState({
        loading: false,
        authenticated: false,
        accounts: [],
        scopes: [],
        error: null,
      });
    } catch {
      // Even if the request fails, clear local state
      setState({
        loading: false,
        authenticated: false,
        accounts: [],
        scopes: [],
        error: null,
      });
    }
  }, []);

  /** Check session on mount and when returning from OAuth redirect */
  useEffect(() => {
    // Check for auth redirect success
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "success") {
      // Clean the URL
      window.history.replaceState({}, "", window.location.pathname);
    }

    void checkSession();
  }, [checkSession]);

  return { ...state, login, logout, checkSession };
}
