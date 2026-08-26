"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type DerivAccount = {
  id: string;
  type: "demo" | "real";
  currency: string;
  balance?: number;
};

export type Proposal = {
  id: string;
  ask_price: number;
  payout: number;
  profit: number;
  spot: number;
  display_name?: string;
};

export type OpenContract = {
  contract_id: string;
  status: "pending" | "open" | "won" | "lost" | "sold" | "expired";
  profit?: number;
  buy_price?: number;
  payout?: number;
  entry_tick?: number;
  current_tick?: number;
  exit_tick?: number;
  is_sold?: boolean;
  contract_type?: string;
  underlying?: string;
  tick_count?: number;
  barrier?: string;
};

export type TradeRecord = {
  id: string;
  contract_type: string;
  symbol: string;
  stake: number;
  payout: number;
  profit: number;
  status: "won" | "lost" | "sold" | "expired";
  digit_prediction: number;
  duration_ticks: number;
  timestamp: number;
};

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected"
  | "reconnecting"
  | "error";

export type ProposalRequest = {
  contract_type: string;
  symbol: string;
  amount: number;
  currency: string;
  duration_ticks: number;
  barrier?: string;
};

export type TradeResult = {
  contract_id: string;
  status: "won" | "lost" | "sold" | "expired";
  profit: number;
  payout: number;
  buy_price: number;
};

/* ------------------------------------------------------------------ */
/*  WS request ID counter                                              */
/* ------------------------------------------------------------------ */

let nextReqId = 1;

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_DELAY = 1000;
const MAX_DELAY = 30000;

function jitteredDelay(attempt: number): number {
  const base = Math.min(BASE_DELAY * Math.pow(2, attempt), MAX_DELAY);
  // Add ±20% jitter to prevent thundering herd
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useDerivTrading() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const accountIdRef = useRef<string | undefined>(undefined);
  const pendingProposals = useRef<Map<string, (p: Proposal | null) => void>>(new Map());
  const pendingBuys = useRef<Map<string, (c: OpenContract | null) => void>>(new Map());
  const contractSubscribers = useRef<Map<string, (c: OpenContract) => void>>(new Map());
  const skipAutoSubscribe = useRef(false);

  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceCurrency, setBalanceCurrency] = useState("USD");
  const [activeContract, setActiveContract] = useState<OpenContract | null>(
    null,
  );
  const [lastResult, setLastResult] = useState<TradeResult | null>(null);
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);
  const [currentProposal, setCurrentProposal] = useState<Proposal | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  /* ---- helpers ---- */

  const send = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      const id = String(nextReqId++);
      ws.send(JSON.stringify({ ...msg, req_id: id }));
      return id;
    }
    return null;
  }, []);

  /* ---- connect ---- */

  const connect = useCallback(
    async (accountId?: string) => {
      if (accountId !== undefined) accountIdRef.current = accountId;
      const activeAccountId = accountId ?? accountIdRef.current;

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }

      setConnectionStatus("authenticating");
      setLastError(null);

      try {
        const res = await fetch("/api/deriv/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId: activeAccountId }),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({ error: "OTP request failed" }));
          throw new Error(errData.error ?? "OTP request failed");
        }
        const data = await res.json();
        const wsUrl: string | undefined = data.url;
        const authToken: string | undefined = data.token;
        if (!wsUrl) throw new Error("No WebSocket URL returned");

        // Log endpoint without tokens for debugging
        try {
          const debugUrl = new URL(wsUrl);
          console.log(`Connecting to Deriv v3 WS: ${debugUrl.origin}${debugUrl.pathname}`);
        } catch { /* ignore */ }

        setConnectionStatus("connecting");
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnectionStatus("connected");
          setLastError(null);
          reconnectAttempts.current = 0;
          // Authenticate with v3 API using the OAuth token
          if (authToken) {
            ws.send(JSON.stringify({ authorize: authToken, req_id: String(nextReqId++) }));
          }
          // subscribe to balance (will work after auth)
          ws.send(JSON.stringify({ balance: 1, subscribe: 1, req_id: String(nextReqId++) }));
        };

        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data) as Record<string, unknown>;

          // balance
          if (msg.msg_type === "balance") {
            const b = msg.balance as { balance?: number; currency?: string } | undefined;
            if (b) {
              setBalance(typeof b.balance === "number" ? b.balance : Number(b.balance) || null);
              setBalanceCurrency(b.currency ?? "USD");
            }
            return;
          }

          // proposal
          if (msg.msg_type === "proposal") {
            const reqId = msg.req_id as string | undefined;
            const p = msg.proposal as
              | {
                  id?: string;
                  ask_price?: number;
                  payout?: number;
                  profit?: number;
                  spot?: number;
                  display_name?: string;
                }
              | undefined;

            if (p?.id) {
              const proposal: Proposal = {
                id: p.id,
                ask_price: Number(p.ask_price) || 0,
                payout: Number(p.payout) || 0,
                profit: Number(p.profit) || 0,
                spot: Number(p.spot) || 0,
                display_name: p.display_name,
              };
              setCurrentProposal(proposal);
              setProposalLoading(false);
              setLastError(null);
              // Resolve by reqId first, then fall back to the most recent pending proposal
              const resolve = reqId ? pendingProposals.current.get(reqId) : undefined;
              if (resolve) {
                pendingProposals.current.delete(reqId!);
                resolve(proposal);
              } else if (pendingProposals.current.size > 0) {
                // Deriv may not echo reqId — resolve the most recent pending proposal
                // and reject all older ones so their timeouts don't set stale errors
                const entries = Array.from(pendingProposals.current.entries());
                for (let i = 0; i < entries.length - 1; i++) {
                  entries[i][1](null);
                  pendingProposals.current.delete(entries[i][0]);
                }
                const [lastId, lastResolve] = entries[entries.length - 1];
                pendingProposals.current.delete(lastId);
                lastResolve(proposal);
              }
            } else {
              // Proposal failed — Deriv returned an error with the proposal response
              const err = msg.error as Record<string, unknown> | undefined;
              const code = err && typeof err.code === "string" ? err.code : undefined;
              const message = err && typeof err.message === "string" ? err.message : undefined;
              const errorMsg = message
                ?? (code ? `Proposal error: ${code}` : undefined)
                ?? "Proposal failed — check contract parameters";
              console.error("Proposal error:", code, message, "full:", JSON.stringify(msg));
              setProposalLoading(false);
              setCurrentProposal(null);
              const resolve = reqId ? pendingProposals.current.get(reqId) : undefined;
              if (resolve) {
                pendingProposals.current.delete(reqId!);
                resolve(null);
              } else if (pendingProposals.current.size > 0) {
                const entries = Array.from(pendingProposals.current.entries());
                for (let i = 0; i < entries.length - 1; i++) {
                  entries[i][1](null);
                  pendingProposals.current.delete(entries[i][0]);
                }
                const [lastId, lastResolve] = entries[entries.length - 1];
                pendingProposals.current.delete(lastId);
                lastResolve(null);
              }
            }
            return;
          }

          // buy
          if (msg.msg_type === "buy") {
            const reqId = msg.req_id as string | undefined;
            const b = msg.buy as
              | {
                  contract_id?: string;
                  purchase_time?: number;
                }
              | undefined;

            if (b?.contract_id) {
              const contract: OpenContract = {
                contract_id: b.contract_id,
                status: "open",
              };
              setActiveContract(contract);
              setLastError(null);
              // subscribe to open contract (skip if bot buy — less WS traffic)
              if (!skipAutoSubscribe.current) {
                ws.send(
                  JSON.stringify({
                    proposal_open_contract: 1,
                    contract_id: b.contract_id,
                    subscribe: 1,
                    req_id: String(nextReqId++),
                  }),
                );
              }
              // Resolve pending buy — try by reqId first, then resolve all (only one should be pending)
              const resolve = reqId ? pendingBuys.current.get(reqId) : undefined;
              if (resolve) {
                pendingBuys.current.delete(reqId!);
                resolve(contract);
              } else if (pendingBuys.current.size > 0) {
                // Deriv may not echo reqId — resolve the most recent pending buy
                const entries = Array.from(pendingBuys.current.entries());
                const [lastId, lastResolve] = entries[entries.length - 1];
                pendingBuys.current.delete(lastId);
                lastResolve(contract);
              }
            } else {
              const err = msg.error as Record<string, unknown> | undefined;
              const code = err && typeof err.code === "string" ? err.code : undefined;
              const message = err && typeof err.message === "string" ? err.message : undefined;
              const errorMsg = message ?? (code ? `Buy error: ${code}` : "Buy failed");
              console.error("Buy error:", code, message, "full:", JSON.stringify(msg));
              setLastError(errorMsg);
              const resolve = reqId ? pendingBuys.current.get(reqId) : undefined;
              if (resolve) {
                pendingBuys.current.delete(reqId!);
                resolve(null);
              }
            }
            return;
          }

          // proposal_open_contract
          if (msg.msg_type === "proposal_open_contract") {
            const c = msg.proposal_open_contract as
              | {
                  contract_id?: string;
                  status?: string;
                  profit?: number;
                  buy_price?: number;
                  payout?: number;
                  entry_tick?: number;
                  current_tick?: number;
                  exit_tick?: number;
                  is_sold?: boolean;
                  contract_type?: string;
                  underlying?: string;
                  tick_count?: number;
                  barrier?: string;
                }
              | undefined;
            if (c) {
              const oc: OpenContract = {
                contract_id: c.contract_id ?? "",
                status: (c.status as OpenContract["status"]) ?? "open",
                profit: typeof c.profit === "number" ? c.profit : Number(c.profit) || 0,
                buy_price: typeof c.buy_price === "number" ? c.buy_price : Number(c.buy_price) || 0,
                payout: typeof c.payout === "number" ? c.payout : Number(c.payout) || 0,
                entry_tick: typeof c.entry_tick === "number" ? c.entry_tick : Number(c.entry_tick) || undefined,
                current_tick: typeof c.current_tick === "number" ? c.current_tick : Number(c.current_tick) || undefined,
                exit_tick: typeof c.exit_tick === "number" ? c.exit_tick : Number(c.exit_tick) || undefined,
                is_sold: c.is_sold,
                contract_type: c.contract_type,
                underlying: c.underlying,
                tick_count: c.tick_count,
                barrier: c.barrier,
              };
              setActiveContract(oc);
              // Notify subscribers (used by bot)
              const subscriber = contractSubscribers.current.get(oc.contract_id);
              if (subscriber) subscriber(oc);
              if (oc.is_sold || oc.status === "won" || oc.status === "lost" || oc.status === "expired" || oc.status === "sold") {
                contractSubscribers.current.delete(oc.contract_id);
                const finalStatus =
                  oc.status === "won"
                    ? ("won" as const)
                    : oc.status === "lost"
                      ? ("lost" as const)
                      : oc.status === "sold"
                        ? ("sold" as const)
                        : ("expired" as const);
                const result: TradeResult = {
                  contract_id: oc.contract_id,
                  status: finalStatus,
                  profit: oc.profit ?? 0,
                  payout: oc.payout ?? 0,
                  buy_price: oc.buy_price ?? 0,
                };
                setLastResult(result);
                setTradeHistory((prev) => {
                  const record: TradeRecord = {
                    id: oc.contract_id,
                    contract_type: oc.contract_type ?? "",
                    symbol: oc.underlying ?? "",
                    stake: oc.buy_price ?? 0,
                    payout: oc.payout ?? 0,
                    profit: oc.profit ?? 0,
                    status: finalStatus,
                    digit_prediction: Number(oc.barrier ?? 0),
                    duration_ticks: oc.tick_count ?? 0,
                    timestamp: Date.now(),
                  };
                  return [record, ...prev].slice(0, 20);
                });
                setTimeout(() => setActiveContract(null), 3000);
              }
            }
            return;
          }

          // error (catch-all)
          if (msg.error) {
            const err = msg.error as Record<string, unknown>;
            // Deriv errors can be: { code, message }, { code, message, details }, or just a string
            const code = typeof err.code === "string" ? err.code : undefined;
            const message = typeof err.message === "string"
              ? err.message
              : typeof err === "string"
                ? err
                : undefined;
            // Try to extract from nested structures
            const details = typeof err.details === "object" && err.details !== null
              ? JSON.stringify(err.details)
              : undefined;
            const errorMsg = message ?? details ?? (code ? `Deriv error: ${code}` : `Deriv error: ${JSON.stringify(err)}`);
            console.error("Deriv WS error:", code, message, err);
            setLastError(errorMsg);
          }
        };

        ws.onerror = (event) => {
          console.error("Deriv trading WebSocket error:", event);
          // Don't overwrite if we already have a more specific error
          setLastError((prev) => prev ?? "WebSocket connection error — check that your account has trading access");
        };

        ws.onclose = (event) => {
          const code = event.code;
          const reason = event.reason;
          const attempt = reconnectAttempts.current;
          console.log(`WebSocket closed: code=${code} reason=${reason} attempt=${attempt}`);
          // Only set disconnected if we weren't already in an error state
          setConnectionStatus((prev) => prev === "error" ? prev : "disconnected");
          // Don't overwrite specific errors with generic reconnection message
          if (code !== 1000 && code !== 1001) {
            // abnormal closure — attempt reconnect with exponential backoff + jitter
            if (attempt < MAX_RECONNECT_ATTEMPTS) {
              reconnectAttempts.current = attempt + 1;
              const delay = jitteredDelay(attempt);
              setConnectionStatus("reconnecting");
              setLastError(`Reconnecting in ${Math.round(delay / 1000)}s… (attempt ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS})`);
              reconnectTimer.current = setTimeout(() => {
                void connect(activeAccountId);
              }, delay);
            } else {
              setLastError(`Connection lost after ${MAX_RECONNECT_ATTEMPTS} attempts. Try switching accounts or refreshing the page.`);
            }
          }
        };
      } catch (err) {
        console.error("Failed to connect trading WebSocket:", err);
        setConnectionStatus("error");
        setLastError(err instanceof Error ? err.message : "Connection failed");
      }
    },
    [],
  );

  /* ---- propose ---- */
  const proposalSeqRef = useRef(0);
  const proposeRef = useRef<(req: ProposalRequest) => Promise<Proposal | null>>(undefined);

  const propose = useCallback(
    (req: ProposalRequest): Promise<Proposal | null> => {
      return new Promise((resolve) => {
        const seq = ++proposalSeqRef.current;
        setProposalLoading(true);
        setLastError(null);
        const msg: Record<string, unknown> = {
          proposal: 1,
          amount: req.amount,
          basis: "stake",
          contract_type: req.contract_type,
          currency: req.currency,
          duration: req.duration_ticks,
          duration_unit: "t",
          underlying_symbol: req.symbol,
        };
        if (req.barrier !== undefined) {
          msg.barrier = req.barrier;
        }
        const id = send(msg);
        if (!id) {
          setProposalLoading(false);
          setLastError("WebSocket not connected — cannot request proposal");
          resolve(null);
          return;
        }
        pendingProposals.current.set(id, resolve);
        // timeout after 6s — only set error if no newer proposal is in-flight
        setTimeout(() => {
          if (pendingProposals.current.has(id)) {
            pendingProposals.current.delete(id);
            // Only show error if this is still the latest proposal request
            if (seq === proposalSeqRef.current) {
              setProposalLoading(false);
              setLastError("Proposal request timed out — retrying");
              // Auto-retry once via ref to avoid stale closure
              proposeRef.current?.(req);
            }
            resolve(null);
          }
        }, 6000);
      });
    },
    [send],
  );

  // Keep ref current for retry without stale closure
  proposeRef.current = propose;

  /* ---- buy ---- */

  const buy = useCallback(
    (proposalId: string, price: number): Promise<OpenContract | null> => {
      return new Promise((resolve) => {
        setLastError(null);
        const msg: Record<string, unknown> = {
          buy: proposalId,
          price,
        };
        const id = send(msg);
        if (!id) {
          setLastError("WebSocket not connected — cannot buy");
          resolve(null);
          return;
        }
        pendingBuys.current.set(id, resolve);
        setTimeout(() => {
          if (pendingBuys.current.has(id)) {
            pendingBuys.current.delete(id);
            setLastError("Buy request timed out");
            resolve(null);
          }
        }, 8000);
      });
    },
    [send],
  );

  /* ---- buy (bot — no auto-subscribe, reduces WS traffic) ---- */
  const buyBot = useCallback(
    (proposalId: string, price: number): Promise<OpenContract | null> => {
      return new Promise((resolve) => {
        skipAutoSubscribe.current = true;
        const msg: Record<string, unknown> = { buy: proposalId, price };
        const id = send(msg);
        skipAutoSubscribe.current = false;
        if (!id) { resolve(null); return; }
        pendingBuys.current.set(id, resolve);
        setTimeout(() => {
          if (pendingBuys.current.has(id)) {
            pendingBuys.current.delete(id);
            resolve(null);
          }
        }, 8000);
      });
    },
    [send],
  );

  /* ---- sell ---- */

  const sell = useCallback(
    (contractId: string): void => {
      send({
        sell: contractId,
        req_id: String(nextReqId++),
      });
    },
    [send],
  );

  /* ---- disconnect on unmount ---- */

  useEffect(() => {
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, []);

  /* ---- contract subscription (for bot) ---- */

  const subscribeToContract = useCallback(
    (contractId: string, cb: (c: OpenContract) => void) => {
      contractSubscribers.current.set(contractId, cb);
      // Also subscribe via WS so Deriv pushes updates
      send({ proposal_open_contract: 1, contract_id: contractId });
    },
    [send],
  );

  const unsubscribeFromContract = useCallback((contractId: string) => {
    contractSubscribers.current.delete(contractId);
  }, []);

  /* ---- clear last result / error ---- */

  /* ---- manual balance refresh ---- */
  const refreshBalance = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ balance: 1, subscribe: 1, req_id: String(nextReqId++) }));
    }
  }, []);

  const clearLastResult = useCallback(() => setLastResult(null), []);
  const clearError = useCallback(() => setLastError(null), []);

  return {
    connectionStatus,
    balance,
    balanceCurrency,
    activeContract,
    currentProposal,
    proposalLoading,
    lastResult,
    lastError,
    tradeHistory,
    connect,
    propose,
    buy,
    buyBot,
    sell,
    subscribeToContract,
    unsubscribeFromContract,
    refreshBalance,
    clearLastResult,
    clearError,
  };
}
