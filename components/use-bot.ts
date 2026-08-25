"use client";

import { useCallback, useRef, useState } from "react";
import type { Proposal, OpenContract } from "./use-deriv-ws";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type BotStrategy =
  | "martingale"
  | "anti_martingale"
  | "digit_match"
  | "digit_differs"
  | "even_odd"
  | "constant";

export type BotConfig = {
  id: string;
  name: string;
  strategy: BotStrategy;
  symbol: string;
  contract_type: string;
  stake: number;
  currency: string;
  duration_ticks: number;
  barrier?: string;
  max_stake?: number;
  take_profit?: number;
  stop_loss?: number;
  max_trades?: number;
  martingale_multiplier?: number;
  prediction_digit?: number;
  dryRun?: boolean;
};

export type BotTrade = {
  id: string;
  contract_id: string;
  stake: number;
  payout: number;
  profit: number;
  status: "pending" | "won" | "lost" | "error" | "open";
  timestamp: number;
  contract_type: string;
  error?: string;
};

export type BotStatus = "idle" | "running" | "paused" | "stopped" | "completed";

export type BotState = {
  config: BotConfig;
  status: BotStatus;
  trades: BotTrade[];
  totalProfit: number;
  totalTrades: number;
  wins: number;
  losses: number;
  currentStake: number;
  lastTradeResult: "won" | "lost" | null;
  startTime: number;
  error: string | null;
};

export type BotTemplate = {
  id: string;
  name: string;
  description: string;
  strategy: BotStrategy;
  icon: string;
  defaultConfig: Partial<BotConfig>;
};

/* ------------------------------------------------------------------ */
/*  WS callback interface — passed from parent                         */
/* ------------------------------------------------------------------ */

export type BotWSDeps = {
  propose: (req: {
    contract_type: string;
    symbol: string;
    amount: number;
    currency: string;
    duration_ticks: number;
    barrier?: string;
  }) => Promise<Proposal | null>;
  buy: (proposalId: string, price: number) => Promise<OpenContract | null>;
  buyBot: (proposalId: string, price: number) => Promise<OpenContract | null>;
  subscribeToContract: (contractId: string, cb: (c: OpenContract) => void) => void;
  unsubscribeFromContract: (contractId: string) => void;
  refreshBalance: () => void;
  connected: boolean;
};

/* ------------------------------------------------------------------ */
/*  Bot Templates                                                      */
/* ------------------------------------------------------------------ */

export const BOT_TEMPLATES: BotTemplate[] = [
  {
    id: "martingale",
    name: "Martingale",
    description:
      "Double stake after each loss. Recover losses with one win. Higher risk, higher reward.",
    strategy: "martingale",
    icon: "🎰",
    defaultConfig: {
      contract_type: "DIGITOVER",
      duration_ticks: 5,
      barrier: "1",
      stake: 1,
      martingale_multiplier: 2,
      max_stake: 100,
      max_trades: 50,
    },
  },
  {
    id: "anti_martingale",
    name: "Anti-Martingale",
    description:
      "Double stake after each win. Ride winning streaks. Lower risk than Martingale.",
    strategy: "anti_martingale",
    icon: "📈",
    defaultConfig: {
      contract_type: "DIGITOVER",
      duration_ticks: 5,
      barrier: "1",
      stake: 1,
      martingale_multiplier: 2,
      max_stake: 100,
      max_trades: 50,
    },
  },
  {
    id: "digit_match",
    name: "Digit Match Hunter",
    description:
      "Hunt for specific digit matches. High payout per win but low hit rate.",
    strategy: "digit_match",
    icon: "🎯",
    defaultConfig: {
      contract_type: "DIGITMATCH",
      duration_ticks: 10,
      barrier: "7",
      stake: 1,
      max_trades: 100,
    },
  },
  {
    id: "digit_differs",
    name: "Digit Differs",
    description:
      "Bet that last digit won't match. Higher hit rate, lower payout per win.",
    strategy: "digit_differs",
    icon: "🎲",
    defaultConfig: {
      contract_type: "DIGITDIFF",
      duration_ticks: 5,
      barrier: "7",
      stake: 10,
      max_trades: 100,
    },
  },
  {
    id: "even_odd",
    name: "Even/Odd Streak",
    description:
      "Trade even/odd streaks. Simple binary prediction with consistent payouts.",
    strategy: "even_odd",
    icon: "⚖️",
    defaultConfig: {
      contract_type: "DIGITEVEN",
      duration_ticks: 5,
      stake: 5,
      max_trades: 100,
    },
  },
  {
    id: "constant",
    name: "Constant Stake",
    description:
      "Fixed stake on every trade. Simple, predictable, no progression.",
    strategy: "constant",
    icon: "📊",
    defaultConfig: {
      contract_type: "DIGITOVER",
      duration_ticks: 5,
      barrier: "1",
      stake: 5,
      max_trades: 100,
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Strategy Logic                                                     */
/* ------------------------------------------------------------------ */

function calculateNextStake(
  strategy: BotStrategy,
  currentStake: number,
  baseStake: number,
  lastResult: "won" | "lost" | null,
  multiplier: number,
  maxStake: number,
): number {
  switch (strategy) {
    case "martingale":
      return lastResult === "lost"
        ? Math.min(currentStake * multiplier, maxStake)
        : baseStake;
    case "anti_martingale":
      return lastResult === "won"
        ? Math.min(currentStake * multiplier, maxStake)
        : baseStake;
    default:
      return baseStake;
  }
}

/** Delay between trades — must be long enough for WS to reconnect after 1006 close */
function tradeDelay(): number {
  return 5000 + Math.random() * 2000; // 5-7s between trades
}

/** Wait for WS to be connected (polls every 500ms, max 15s) */
function waitForConnected(getConnected: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    if (getConnected()) return resolve(true);
    let attempts = 0;
    const check = setInterval(() => {
      attempts++;
      if (getConnected() || attempts > 30) {
        clearInterval(check);
        resolve(getConnected());
      }
    }, 500);
  });
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

let botIdCounter = 1;

export function useBot(deps: BotWSDeps) {
  const [bots, setBots] = useState<BotState[]>([]);
  const [activeBotId, setActiveBotId] = useState<string | null>(null);
  const botTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map(),
  );
  const botRefs = useRef<Map<string, BotState>>(new Map());
  const depsRef = useRef(deps);
  depsRef.current = deps;

  const updateBot = useCallback((id: string, updates: Partial<BotState>) => {
    setBots((prev) =>
      prev.map((b) => {
        if (b.config.id !== id) return b;
        const updated = { ...b, ...updates };
        botRefs.current.set(id, updated);
        return updated;
      }),
    );
  }, []);

  /** Finalise a single trade result and schedule next */
  const finaliseTrade = useCallback(
    (
      id: string,
      result: { profit: number; payout: number; status: "won" | "lost" | "error"; contract_id: string; error?: string },
    ) => {
      const b = botRefs.current.get(id);
      if (!b || b.status !== "running") return;

      const stake = b.currentStake;
      const lastResult = result.status === "won" ? ("won" as const) : ("lost" as const);
      const newTotalProfit = b.totalProfit + result.profit;
      const nextStake = calculateNextStake(
        b.config.strategy,
        stake,
        b.config.stake,
        lastResult,
        b.config.martingale_multiplier ?? 2,
        b.config.max_stake ?? 100,
      );

      const trade: BotTrade = {
        id: `btrade_${Date.now()}`,
        contract_id: result.contract_id,
        stake,
        payout: result.payout,
        profit: result.profit,
        status: result.status,
        timestamp: Date.now(),
        contract_type: b.config.contract_type,
        error: result.error,
      };

      // Check stop conditions
      let shouldStop = false;
      let stopReason = "";
      if (b.config.take_profit && newTotalProfit >= b.config.take_profit) {
        shouldStop = true;
        stopReason = `Take profit reached ($${newTotalProfit.toFixed(2)})`;
      }
      if (b.config.stop_loss && newTotalProfit <= -b.config.stop_loss) {
        shouldStop = true;
        stopReason = `Stop loss reached ($${newTotalProfit.toFixed(2)})`;
      }
      if (b.config.max_trades && b.totalTrades + 1 >= b.config.max_trades) {
        shouldStop = true;
        stopReason = `Max trades reached (${b.totalTrades + 1})`;
      }
      if (b.config.max_stake && nextStake > b.config.max_stake) {
        shouldStop = true;
        stopReason = `Max stake exceeded ($${nextStake.toFixed(2)})`;
      }

      updateBot(id, {
        trades: [...b.trades, trade].slice(-200),
        totalProfit: newTotalProfit,
        totalTrades: b.totalTrades + 1,
        wins: b.wins + (lastResult === "won" ? 1 : 0),
        losses: b.losses + (lastResult === "won" ? 0 : 1),
        currentStake: nextStake,
        lastTradeResult: lastResult,
        status: shouldStop ? "stopped" : "running",
        error: shouldStop ? stopReason : null,
      });

      // Refresh balance after each trade
      depsRef.current.refreshBalance();

      // Schedule next trade
      if (!shouldStop) {
        const timer = setTimeout(() => executeTrade(id), tradeDelay());
        botTimers.current.set(id, timer);
      }
    },
    [updateBot],
  );

  /** Execute one real trade via Deriv WS, then schedule next */
  const executeTrade = useCallback(
    (id: string) => {
      const bot = botRefs.current.get(id);
      if (!bot || bot.status !== "running") return;

      // Wait for WS connection before each trade
      waitForConnected(() => depsRef.current.connected).then((ok) => {
        const b = botRefs.current.get(id);
        if (!b || b.status !== "running") return;

        if (!ok) {
          console.error("[Bot] WS not connected after waiting, retrying...");
          const timer = setTimeout(() => executeTrade(id), 5000);
          botTimers.current.set(id, timer);
          return;
        }

      const stake = b.currentStake;

      // 1. Request proposal
      depsRef.current
        .propose({
          contract_type: bot.config.contract_type,
          symbol: bot.config.symbol,
          amount: stake,
          currency: bot.config.currency,
          duration_ticks: bot.config.duration_ticks,
          barrier: bot.config.barrier,
        })
        .then((proposal) => {
          const b = botRefs.current.get(id);
          if (!b || b.status !== "running") return;

          if (!proposal) {
            finaliseTrade(id, {
              profit: -stake,
              payout: 0,
              status: "error",
              contract_id: "",
              error: "Proposal failed",
            });
            return;
          }

          // DRY-RUN MODE: use real proposal pricing but simulate outcome
          if (b.config.dryRun) {
            const payout = Number(proposal.payout) || 0;
            const askPrice = Number(proposal.ask_price) || stake;
            // Win probability derived from payout ratio (higher payout = lower win chance)
            const winChance = askPrice > 0 ? askPrice / payout : 0.5;
            const won = Math.random() < winChance;
            const profit = won ? payout - askPrice : -askPrice;
            console.log(`[Bot Dry Run] Proposal: stake=$${askPrice}, payout=$${payout}, winChance=${(winChance * 100).toFixed(1)}%, result=${won ? 'WIN' : 'LOSS'}, profit=$${profit.toFixed(2)}`);
            finaliseTrade(id, {
              profit,
              payout: won ? payout : 0,
              status: won ? "won" : "lost",
              contract_id: `dry_${Date.now()}`,
            });
            return;
          }

          // 2. Buy the proposal (use buyBot to skip auto-subscribe, less WS traffic)
          return depsRef.current
            .buyBot(proposal.id, Number(proposal.ask_price))
            .then((openContract) => {
              const b2 = botRefs.current.get(id);
              if (!b2 || b2.status !== "running") return;

              if (!openContract) {
                finaliseTrade(id, {
                  profit: -stake,
                  payout: 0,
                  status: "error",
                  contract_id: "",
                  error: "Buy request failed",
                });
                return;
              }

              const contractId = openContract.contract_id;

              // If contract already settled in the buy response
              const s = openContract.status;
              if (s === "won" || s === "lost" || s === "sold" || s === "expired") {
                const won = s === "won";
                finaliseTrade(id, {
                  profit: Number(openContract.profit ?? 0),
                  payout: Number(openContract.payout ?? 0),
                  status: won ? "won" : "lost",
                  contract_id: contractId,
                });
                return;
              }

              // 3. Wait for contract to settle (duration_ticks * ~1.2s per tick + buffer)
              // The buy response already contains the payout info for short contracts.
              // For digit contracts, they settle quickly. Use the proposal payout to estimate result.
              const settleTime = (b2.config.duration_ticks + 3) * 1200; // ticks * 1.2s + 3s buffer
              const settleTimer = setTimeout(() => {
                const b3 = botRefs.current.get(id);
                if (b3 && b3.status === "running") {
                  // Contract should have settled by now — check via the WS contract update
                  // The terminal's WS handler picks up contract_open_contract messages
                  // If we still don't have a result, mark as timeout
                  finaliseTrade(id, {
                    profit: 0,
                    payout: 0,
                    status: "error",
                    contract_id: contractId,
                    error: "Contract result unknown — check trade history",
                  });
                }
              }, settleTime);
              botTimers.current.set(id + "_timeout", settleTimer);
            });
        })
        .catch((err) => {
          console.error("[Bot] Trade execution error:", err);
          finaliseTrade(id, {
            profit: -(botRefs.current.get(id)?.currentStake ?? stake),
            payout: 0,
            status: "error",
            contract_id: "",
            error: String(err),
          });
        });
      }); // end waitForConnected
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [finaliseTrade],
  );

  const createBot = useCallback(
    (config: BotConfig): string => {
      const id = `bot_${botIdCounter++}`;
      const state: BotState = {
        config: { ...config, id },
        status: "idle",
        trades: [],
        totalProfit: 0,
        totalTrades: 0,
        wins: 0,
        losses: 0,
        currentStake: config.stake,
        lastTradeResult: null,
        startTime: 0,
        error: null,
      };
      botRefs.current.set(id, state);
      setBots((prev) => [...prev, state]);
      return id;
    },
    [],
  );

  const startBot = useCallback(
    (id: string) => {
      const bot = botRefs.current.get(id);
      if (!bot) return;

      updateBot(id, {
        status: "running",
        startTime: Date.now(),
        error: null,
      });
      setActiveBotId(id);

      const timer = setTimeout(() => executeTrade(id), 1000);
      botTimers.current.set(id, timer);
    },
    [updateBot, executeTrade],
  );

  const stopBot = useCallback(
    (id: string) => {
      const timer = botTimers.current.get(id);
      if (timer) {
        clearTimeout(timer);
        botTimers.current.delete(id);
      }
      // Also clear the safety timeout
      const safety = botTimers.current.get(id + "_timeout");
      if (safety) {
        clearTimeout(safety);
        botTimers.current.delete(id + "_timeout");
      }
      updateBot(id, { status: "stopped", error: "Manually stopped" });
      if (activeBotId === id) setActiveBotId(null);
    },
    [updateBot, activeBotId],
  );

  const pauseBot = useCallback(
    (id: string) => {
      const timer = botTimers.current.get(id);
      if (timer) {
        clearTimeout(timer);
        botTimers.current.delete(id);
      }
      updateBot(id, { status: "paused" });
    },
    [updateBot],
  );

  const resumeBot = useCallback(
    (id: string) => {
      updateBot(id, { status: "running" });
      const timer = setTimeout(() => executeTrade(id), 1000);
      botTimers.current.set(id, timer);
    },
    [updateBot, executeTrade],
  );

  const deleteBot = useCallback(
    (id: string) => {
      stopBot(id);
      botRefs.current.delete(id);
      setBots((prev) => prev.filter((b) => b.config.id !== id));
    },
    [stopBot],
  );

  return {
    bots,
    activeBotId,
    createBot,
    startBot,
    stopBot,
    pauseBot,
    resumeBot,
    deleteBot,
    BOT_TEMPLATES,
  };
}
