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

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useDerivTrading() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttempts = useRef(0);
  const pendingProposals = useRef<Map<string, (p: Proposal) => void>>(new Map());
  const pendingBuys = useRef<Map<string, (c: OpenContract) => void>>(new Map());

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
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      if (reconnectTimer.current) {
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = null;
      }

      setConnectionStatus("authenticating");

      try {
        const res = await fetch("/api/deriv/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accountId }),
        });
        if (!res.ok) throw new Error("OTP request failed");
        const data = await res.json();
        const wsUrl: string | undefined = data.url;
        if (!wsUrl) throw new Error("No WebSocket URL returned");

        setConnectionStatus("connecting");
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
          setConnectionStatus("connected");
          reconnectAttempts.current = 0;
          // subscribe to balance
          ws.send(JSON.stringify({ balance: 1, subscribe: 1, req_id: String(nextReqId++) }));
        };

        ws.onmessage = (event) => {
          const msg = JSON.parse(event.data) as Record<string, unknown>;

          // balance
          if (msg.msg_type === "balance") {
            const b = msg.balance as { balance?: number; currency?: string } | undefined;
            if (b) {
              setBalance(b.balance ?? null);
              setBalanceCurrency(b.currency ?? "USD");
            }
            return;
          }

          // proposal
          if (msg.msg_type === "proposal") {
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
            const reqId = msg.req_id as string | undefined;
            if (p?.id) {
              const proposal: Proposal = {
                id: p.id,
                ask_price: p.ask_price ?? 0,
                payout: p.payout ?? 0,
                profit: p.profit ?? 0,
                spot: p.spot ?? 0,
                display_name: p.display_name,
              };
              setCurrentProposal(proposal);
              setProposalLoading(false);
              const resolve = reqId ? pendingProposals.current.get(reqId) : undefined;
              if (resolve) {
                pendingProposals.current.delete(reqId!);
                resolve(proposal);
              }
            } else {
              setProposalLoading(false);
            }
            return;
          }

          // buy
          if (msg.msg_type === "buy") {
            const b = msg.buy as
              | {
                  contract_id?: string;
                  purchase_time?: number;
                }
              | undefined;
            const reqId = msg.req_id as string | undefined;
            if (b?.contract_id) {
              const contract: OpenContract = {
                contract_id: b.contract_id,
                status: "open",
              };
              setActiveContract(contract);
              // subscribe to open contract
              ws.send(
                JSON.stringify({
                  proposal_open_contract: 1,
                  contract_id: b.contract_id,
                  subscribe: 1,
                  req_id: String(nextReqId++),
                }),
              );
              const resolve = reqId ? pendingBuys.current.get(reqId) : undefined;
              if (resolve) {
                pendingBuys.current.delete(reqId!);
                resolve(contract);
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
                profit: c.profit,
                buy_price: c.buy_price,
                payout: c.payout,
                entry_tick: c.entry_tick,
                current_tick: c.current_tick,
                exit_tick: c.exit_tick,
                is_sold: c.is_sold,
                contract_type: c.contract_type,
                underlying: c.underlying,
                tick_count: c.tick_count,
                barrier: c.barrier,
              };
              setActiveContract(oc);
              if (oc.is_sold || oc.status === "won" || oc.status === "lost" || oc.status === "expired" || oc.status === "sold") {
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
                // add to history
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
                // clear active after a delay
                setTimeout(() => setActiveContract(null), 3000);
              }
            }
            return;
          }

          // error
          if (msg.error) {
            const err = msg.error as { code?: string; message?: string };
            console.error("Deriv WS error:", err.code, err.message);
          }
        };

        ws.onerror = () => {
          console.error("Deriv trading WebSocket error");
        };

        ws.onclose = () => {
          setConnectionStatus("disconnected");
          // auto-reconnect with backoff
          if (reconnectAttempts.current < 5) {
            const delay = Math.min(
              1000 * Math.pow(2, reconnectAttempts.current),
              30000,
            );
            reconnectAttempts.current += 1;
            reconnectTimer.current = setTimeout(() => {
              void connect(accountId);
            }, delay);
          }
        };
      } catch (err) {
        console.error("Failed to connect trading WebSocket:", err);
        setConnectionStatus("error");
      }
    },
    [],
  );

  /* ---- propose ---- */

  const propose = useCallback(
    (req: ProposalRequest): Promise<Proposal | null> => {
      return new Promise((resolve) => {
        setProposalLoading(true);
        setCurrentProposal(null);
        const msg: Record<string, unknown> = {
          proposal: 1,
          amount: req.amount,
          basis: "stake",
          contract_type: req.contract_type,
          currency: req.currency,
          duration_unit: "t",
          tick_count: req.duration_ticks,
          underlying_symbol: req.symbol,
        };
        if (req.barrier !== undefined) {
          msg.barrier = req.barrier;
        }
        const id = send(msg);
        if (!id) {
          setProposalLoading(false);
          resolve(null);
          return;
        }
        pendingProposals.current.set(id, resolve);
        // timeout after 5s
        setTimeout(() => {
          if (pendingProposals.current.has(id)) {
            pendingProposals.current.delete(id);
            setProposalLoading(false);
            resolve(null);
          }
        }, 5000);
      });
    },
    [send],
  );

  /* ---- buy ---- */

  const buy = useCallback(
    (proposalId: string, price: number): Promise<OpenContract | null> => {
      return new Promise((resolve) => {
        const msg: Record<string, unknown> = {
          buy: proposalId,
          price,
        };
        const id = send(msg);
        if (!id) {
          resolve(null);
          return;
        }
        pendingBuys.current.set(id, resolve);
        setTimeout(() => {
          if (pendingBuys.current.has(id)) {
            pendingBuys.current.delete(id);
            resolve(null);
          }
        }, 5000);
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

  /* ---- clear last result ---- */

  const clearLastResult = useCallback(() => setLastResult(null), []);

  return {
    connectionStatus,
    balance,
    balanceCurrency,
    activeContract,
    currentProposal,
    proposalLoading,
    lastResult,
    tradeHistory,
    connect,
    propose,
    buy,
    sell,
    clearLastResult,
  };
}
