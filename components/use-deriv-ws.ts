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

export type AccountInfo = {
  loginid: string;
  account_type: string;
  currency: string;
  is_disabled: boolean;
  landing_company_name: string;
  trading_type?: string;
};

/* ------------------------------------------------------------------ */
/*  WS request ID counter & timing constants                           */
/* ------------------------------------------------------------------ */

let nextReqId = 1;

const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_DELAY = 1000;
const MAX_DELAY = 30000;
const PING_INTERVAL_MS = 15_000; // Keep WebSocket alive

function jitteredDelay(attempt: number): number {
  const base = Math.min(BASE_DELAY * Math.pow(2, attempt), MAX_DELAY);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useDerivTrading() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectAttempts = useRef(0);
  const accountIdRef = useRef<string | undefined>(undefined);
  const pendingProposals = useRef<Map<string, (p: Proposal | null) => void>>(new Map());
  const proposalRef = useRef<Proposal | null>(null);
  const pendingBuys = useRef<Map<string, (c: OpenContract | null) => void>>(new Map());
  const pendingPortfolio = useRef<(data: { positions: unknown[] } | null) => void>(null);
  const pendingProfitTable = useRef<(data: { transactions: unknown[]; count: number } | null) => void>(null);
  const contractSubscribers = useRef<Map<string, (c: OpenContract) => void>>(new Map());
  const skipAutoSubscribe = useRef(false);
  const proposalSubscriptionIdRef = useRef<string | null>(null);
  const proposalSeqRef = useRef(0);
  const proposeRef = useRef<(req: ProposalRequest) => Promise<Proposal | null>>(undefined);
  const lastProposalParamsRef = useRef<ProposalRequest | null>(null);

  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("disconnected");
  const [balance, setBalance] = useState<number | null>(null);
  const [balanceCurrency, setBalanceCurrency] = useState("USD");
  const [activeContract, setActiveContract] = useState<OpenContract | null>(null);
  const [lastResult, setLastResult] = useState<TradeResult | null>(null);
  const [tradeHistory, setTradeHistory] = useState<TradeRecord[]>([]);
  const [currentProposal, setCurrentProposal] = useState<Proposal | null>(null);
  const [proposalLoading, setProposalLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<AccountInfo[]>([]);

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

  const stopPing = useCallback(() => {
    if (pingTimer.current) {
      clearInterval(pingTimer.current);
      pingTimer.current = null;
    }
  }, []);

  const startPing = useCallback(() => {
    stopPing();
    pingTimer.current = setInterval(() => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ ping: 1 }));
      }
    }, PING_INTERVAL_MS);
  }, [stopPing]);

  /* ---- connect ---- */

  const connect = useCallback(
    async (accountId?: string) => {
      if (accountId !== undefined) accountIdRef.current = accountId;
      const activeAccountId = accountId ?? accountIdRef.current;

      stopPing();

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
        if (!wsUrl) throw new Error("No WebSocket URL returned");

        try {
          const debugUrl = new URL(wsUrl);
          console.log(`Connecting to Deriv WS: ${debugUrl.origin}${debugUrl.pathname}`);
        } catch { /* ignore */ }

        setConnectionStatus("connecting");
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnectionStatus("connected");
          setLastError(null);
          reconnectAttempts.current = 0;
          startPing();
          // subscribe to balance
          ws.send(JSON.stringify({ balance: 1, subscribe: 1, req_id: String(nextReqId++) }));
          // Fetch all accounts linked to this login
          ws.send(JSON.stringify({ account_list: 1, req_id: String(nextReqId++) }));
          // Re-subscribe to proposal if we had active params
          if (lastProposalParamsRef.current) {
            setTimeout(() => resubscribeProposal(), 200);
          }
        };

        ws.onmessage = (event) => {
          let msg: Record<string, unknown>;
          try {
            msg = JSON.parse(event.data) as Record<string, unknown>;
          } catch {
            return;
          }

          // Ignore keepalive ping responses
          if (msg.msg_type === "ping") {
            return;
          }

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
          if (msg.msg_type === "portfolio") {
            const pf = msg.portfolio as { contracts?: unknown[] } | undefined;
            const resolve = pendingPortfolio.current;
            if (resolve) {
              pendingPortfolio.current = null;
              resolve(pf ? { positions: pf.contracts ?? [] } : null);
            }
            return;
          }

          if (msg.msg_type === "profit_table") {
            const pt = msg.profit_table as { transactions?: unknown[]; count?: number } | undefined;
            const resolve = pendingProfitTable.current;
            if (resolve) {
              pendingProfitTable.current = null;
              resolve(pt ? { transactions: pt.transactions ?? [], count: pt.count ?? 0 } : null);
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
              proposalRef.current = proposal;
              // Only update React state if values actually changed to avoid
              // unnecessary re-renders that cause payout flickering
              setCurrentProposal((prev) => {
                if (prev && prev.id === proposal.id && prev.payout === proposal.payout && prev.ask_price === proposal.ask_price) {
                  return prev; // Same values — skip re-render
                }
                return proposal;
              });
              setProposalLoading(false);
              if (msg.id) {
                proposalSubscriptionIdRef.current = String(msg.id);
              }

              setLastError(null);
              const resolve = reqId ? pendingProposals.current.get(reqId) : undefined;
              if (resolve) {
                pendingProposals.current.delete(reqId!);
                resolve(proposal);
              } else if (pendingProposals.current.size > 0) {
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
            console.log("[WS] Buy response received:", JSON.stringify(msg.buy).substring(0, 200));
            const reqId = msg.req_id as string | undefined;
            const b = msg.buy as
              | {
                  contract_id?: string;
                  purchase_time?: number;
                }
              | undefined;

            if (b?.contract_id) {
              console.log("[WS] Buy SUCCESS — contract_id:", b.contract_id, "Setting active contract");
              const contract: OpenContract = {
                contract_id: b.contract_id,
                status: "open",
              };
              setActiveContract(contract);
              setLastError(null);
              if (!skipAutoSubscribe.current) {
                console.log("[WS] Sending proposal_open_contract subscription for:", b.contract_id);
                ws.send(
                  JSON.stringify({
                    proposal_open_contract: 1,
                    contract_id: b.contract_id,
                    subscribe: 1,
                    req_id: String(nextReqId++),
                  }),
                );
              }
              const resolve = reqId ? pendingBuys.current.get(reqId) : undefined;
              if (resolve) {
                pendingBuys.current.delete(reqId!);
                resolve(contract);
              } else if (pendingBuys.current.size > 0) {
                const entries = Array.from(pendingBuys.current.entries());
                const [lastId, lastResolve] = entries[entries.length - 1];
                pendingBuys.current.delete(lastId);
                lastResolve(contract);
              }
            } else {
              console.error("[WS] Buy FAILED — no contract_id. Full response:", JSON.stringify(msg).substring(0, 300));
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
            const poc = msg.proposal_open_contract as Record<string, unknown> | undefined;
            console.log("[WS] proposal_open_contract received:", poc ? "contract_id=" + poc.contract_id + " status=" + poc.status + " current_tick=" + poc.current_tick + " is_sold=" + poc.is_sold : "null");
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
                entry_tick: c.entry_tick != null ? Number(c.entry_tick) : undefined,
                current_tick: c.current_tick != null ? Number(c.current_tick) : undefined,
                exit_tick: c.exit_tick != null ? Number(c.exit_tick) : undefined,
                is_sold: c.is_sold,
                contract_type: c.contract_type,
                underlying: c.underlying,
                tick_count: c.tick_count,
                barrier: c.barrier,
              };
              setActiveContract(oc);
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
                console.log("[WS] Trade settled:", finalStatus, "profit:", oc.profit, "payout:", oc.payout);
                setLastResult(result);
                // Pre-warm new proposal immediately before clearing old
                // so the buy button has minimal downtime
                const lastParams = lastProposalParamsRef.current;
                if (lastParams) {
                  const freshMsg: Record<string, unknown> = {
                    proposal: 1,
                    amount: lastParams.amount,
                    basis: "stake",
                    contract_type: lastParams.contract_type,
                    currency: lastParams.currency,
                    duration: lastParams.duration_ticks,
                    duration_unit: "t",
                    underlying_symbol: lastParams.symbol,
                  };
                  if (lastParams.barrier !== undefined) freshMsg.barrier = lastParams.barrier;
                  send(freshMsg);
                }
                // Clear proposal after a short delay to allow fresh proposal to arrive
                setTimeout(() => {
                  proposalRef.current = null;
                  setCurrentProposal(null);
                }, 50);
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
                // Reduced settle delay: 800ms for 1-tick trades (just enough to see result), 2s for multi-tick
                const settleDelay = (oc.tick_count && oc.tick_count <= 1) ? 800 : 2000;
                setTimeout(() => { console.log("[WS] Clearing active contract after", settleDelay, "ms"); setActiveContract(null); }, settleDelay);
                // Pre-warm proposal re-subscription immediately from WS handler
                // instead of waiting for React effect cycle (saves ~200-400ms)
                if (proposalSubscriptionIdRef.current) {
                  ws.send(JSON.stringify({ forget: proposalSubscriptionIdRef.current }));
                  proposalSubscriptionIdRef.current = null;
                }
              }
            }
            return;
          }

          // account_list
          if (msg.msg_type === "account_list") {
            const al = msg.account_list as Array<Record<string, unknown>> | undefined;
            if (Array.isArray(al)) {
              const parsed: AccountInfo[] = al.map((a) => ({
                loginid: String(a.loginid ?? ""),
                account_type: String(a.account_type ?? ""),
                currency: String(a.currency ?? "USD"),
                is_disabled: !!a.is_disabled,
                landing_company_name: String(a.landing_company_name ?? ""),
                trading_type: String(a.trading_type ?? ""),
              }));
              setAccounts(parsed);
              console.log("[WS] Account list:", parsed.map(a => a.loginid + " (" + a.account_type + ")"));
            }
            return;
          }

          // error (catch-all)
          if (msg.error) {
            const err = msg.error as Record<string, unknown>;
            const code = typeof err.code === "string" ? err.code : undefined;
            const message = typeof err.message === "string"
              ? err.message
              : typeof err === "string"
                ? err
                : undefined;
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
          setLastError((prev) => prev ?? "WebSocket connection error — check that your account has trading access");
        };

        ws.onclose = (event) => {
          stopPing();
          const code = event.code;
          const reason = event.reason;
          const attempt = reconnectAttempts.current;
          console.log(`WebSocket closed: code=${code} reason=${reason} attempt=${attempt}`);
          setConnectionStatus((prev) => prev === "error" ? prev : "disconnected");
          if (code !== 1000 && code !== 1001) {
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
    [startPing, stopPing],
  );

  /* ---- proposal subscription ---- */
  const subscribeProposal = useCallback(
    (req: ProposalRequest) => {
      lastProposalParamsRef.current = req;
      if (proposalSubscriptionIdRef.current) {
        send({ forget: proposalSubscriptionIdRef.current });
        proposalSubscriptionIdRef.current = null;
      }
      if (!proposalRef.current) setProposalLoading(true);
      setLastError(null);
      const subMsg: Record<string, unknown> = {
        proposal: 1,
        subscribe: 1,
        amount: req.amount,
        basis: "stake",
        contract_type: req.contract_type,
        currency: req.currency,
        duration: req.duration_ticks,
        duration_unit: "t",
        underlying_symbol: req.symbol,
      };
      if (req.barrier !== undefined) {
        subMsg.barrier = req.barrier;
      }
      send(subMsg);
    },
    [send],
  );

  
  /* ---- re-subscribe to proposal (used after reconnect / trade settle) ---- */
  const resubscribeProposal = useCallback(() => {
    const req = lastProposalParamsRef.current;
    if (!req) return;
    if (proposalSubscriptionIdRef.current) {
      send({ forget: proposalSubscriptionIdRef.current });
      proposalSubscriptionIdRef.current = null;
    }
    const subMsg: Record<string, unknown> = {
      proposal: 1,
      subscribe: 1,
      amount: req.amount,
      basis: "stake",
      contract_type: req.contract_type,
      currency: req.currency,
      duration: req.duration_ticks,
      duration_unit: "t",
      underlying_symbol: req.symbol,
    };
    if (req.barrier !== undefined) subMsg.barrier = req.barrier;
    setProposalLoading(true);
    send(subMsg);
  }, [send]);

  // Cleanup subscription on unmount
  useEffect(() => {
    return () => {
      if (proposalSubscriptionIdRef.current) {
        send({ forget: proposalSubscriptionIdRef.current });
      }
    };
  }, [send]);

  /* ---- propose ---- */
  const propose = useCallback(
    (req: ProposalRequest): Promise<Proposal | null> => {
      return new Promise((resolve) => {
        const seq = ++proposalSeqRef.current;
        if (!proposalRef.current) setProposalLoading(true);
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
        setTimeout(() => {
          if (pendingProposals.current.has(id)) {
            pendingProposals.current.delete(id);
            if (seq === proposalSeqRef.current) {
              setProposalLoading(false);
              setLastError("Proposal request timed out — retrying");
              proposeRef.current?.(req);
            }
            resolve(null);
          }
        }, 6000);
      });
    },
    [send],
  );

  proposeRef.current = propose;

  /* ---- buy ---- */

  const buy = useCallback(
    (proposalId: string, price: number): Promise<OpenContract | null> => {
      return new Promise((resolve) => {
        setLastError(null);
        // Don't clear proposal here — it wastes a re-render while waiting
        // for WS response. Clear it only after buy succeeds (in the msg handler).
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
      stopPing();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [stopPing]);

  /* ---- contract subscription (for bot) ---- */

  const subscribeToContract = useCallback(
    (contractId: string, cb: (c: OpenContract) => void) => {
      contractSubscribers.current.set(contractId, cb);
      send({ proposal_open_contract: 1, contract_id: contractId });
    },
    [send],
  );

  const unsubscribeFromContract = useCallback((contractId: string) => {
    contractSubscribers.current.delete(contractId);
  }, []);

  /* ---- manual balance & account refresh ---- */
  const refreshAccounts = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ account_list: 1, req_id: String(nextReqId++) }));
    }
  }, []);

  const refreshBalance = useCallback(() => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ balance: 1, subscribe: 1, req_id: String(nextReqId++) }));
    }
  }, []);


  /* ---- fetchProfitTable ---- */
  const fetchProfitTable = useCallback(
    (opts?: { limit?: number; offset?: number }): Promise<{ transactions: unknown[]; count: number } | null> => {
      return new Promise((resolve) => {
        setLastError(null);
        if (pendingProfitTable.current) {
          pendingProfitTable.current(null);
        }
        const id = send({
          profit_table: 1,
          description: 1,
          limit: opts?.limit ?? 50,
          offset: opts?.offset ?? 0,
          sort: "DESC",
        });
        if (!id) {
          setLastError("WebSocket not connected — cannot fetch profit table");
          resolve(null);
          return;
        }
        pendingProfitTable.current = resolve;
        setTimeout(() => {
          if (pendingProfitTable.current) {
            pendingProfitTable.current = null;
            setLastError("Profit table request timed out");
            resolve(null);
          }
        }, 15000);
      });
    },
    [send],
  );


  /* ---- fetchPortfolio ---- */
  const fetchPortfolio = useCallback(
    (): Promise<{ positions: unknown[] } | null> => {
      return new Promise((resolve) => {
        setLastError(null);
        if (pendingPortfolio.current) {
          pendingPortfolio.current(null);
        }
        const id = send({ portfolio: 1 });
        if (!id) {
          setLastError('WebSocket not connected — cannot fetch portfolio');
          resolve(null);
          return;
        }
        pendingPortfolio.current = resolve;
        setTimeout(() => {
          if (pendingPortfolio.current) {
            pendingPortfolio.current = null;
            setLastError('Portfolio request timed out');
            resolve(null);
          }
        }, 15000);
      });
    },
    [send],
  );

  const clearLastResult = useCallback(() => setLastResult(null), []);
  const clearError = useCallback(() => setLastError(null), []);

  return {
    connectionStatus,
    balance,
    balanceCurrency,
    activeContract,
    currentProposal,
    proposalRef,
    proposalLoading,
    lastResult,
    lastError,
    tradeHistory,
    connect,
    propose,
    subscribeProposal,
    buy,
    buyBot,
    sell,
    subscribeToContract,
    unsubscribeFromContract,
    refreshBalance,
    fetchProfitTable,
    fetchPortfolio,
    refreshAccounts,
    clearProposal: () => {
      if (proposalSubscriptionIdRef.current) {
        send({ forget: proposalSubscriptionIdRef.current });
        proposalSubscriptionIdRef.current = null;
      }
      proposalRef.current = null;
      setCurrentProposal(null);
      setProposalLoading(false);
    },
    accounts,
    clearLastResult,
    clearError,
  };
}
