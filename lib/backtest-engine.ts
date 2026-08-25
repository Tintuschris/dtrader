/**
 * Backtest Engine
 *
 * Fetches historical tick data from Deriv's public WebSocket API,
 * then replays those ticks through a BotTradingAdapter that simulates
 * proposals and contract outcomes based on real historical prices.
 *
 * This lets users test Blockly strategies against real market data
 * without risking real money.
 */
import {
  type BotTradingAdapter,
  type AdapterProposal,
  type AdapterContract,
  type ContractUpdateCb,
  type BotCallbacks,
} from "./bot-sandbox";

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

export type BacktestTick = {
  time: number;
  epoch: number;
  quote: number;
};

export type BacktestTrade = {
  id: string;
  symbol: string;
  contract_type: string;
  stake: number;
  entry_tick: number;
  exit_tick: number;
  tick_count: number;
  profit: number;
  payout: number;
  status: "won" | "lost";
  timestamp: number;
};

export type BacktestStats = {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfit: number;
  totalStake: number;
  maxDrawdown: number;
  profitFactor: number;
  averageProfit: number;
  averageStake: number;
  peakBalance: number;
  balanceCurve: number[];
};

export type BacktestConfig = {
  symbol: string;
  contractType: string;
  durationTicks: number;
  stake: number;
  barrier: number;
  initialBalance: number;
  speed: number; // 1x, 2x, 5x, 10x, 100x
};

export type BacktestTickCallback = (tick: BacktestTick, index: number) => void;

/* ------------------------------------------------------------------ */
/*  Fetch historical ticks                                              */
/* ------------------------------------------------------------------ */

export async function fetchHistoricalTicks(
  symbol: string,
  count: number = 5000,
): Promise<BacktestTick[]> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("wss://ws.derivws.com/websockets/v3?app_id=1089");
    const ticks: BacktestTick[] = [];
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        ws.close();
        // Return what we have if partial
        resolve(ticks);
      }
    }, 15000);

    ws.onopen = () => {
      // First request: get tick history (paginated)
      ws.send(
        JSON.stringify({
          ticks_history: symbol,
          adjust_start_time: 1,
          count: Math.min(count, 5000),
          end: "latest",
          style: "ticks",
          req_id: "history",
        })
      );
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);

      if (msg.req_id === "history" && msg.tick_history) {
        const history = msg.tick_history;
        if (history.prices && history.times) {
          for (let i = 0; i < history.prices.length; i++) {
            ticks.push({
              time: history.times[i],
              epoch: history.times[i],
              quote: Number(history.prices[i]),
            });
          }
        }

        // If we got fewer than requested, also subscribe to live ticks
        if (ticks.length < count) {
          ws.send(
            JSON.stringify({
              ticks: symbol,
              subscribe: 1,
              req_id: "live",
            })
          );
        } else {
          resolved = true;
          clearTimeout(timeout);
          ws.close();
          resolve(ticks);
        }
        return;
      }

      // Live tick subscriptions (additional ticks)
      if (msg.tick) {
        ticks.push({
          time: msg.tick.epoch,
          epoch: msg.tick.epoch,
          quote: Number(msg.tick.quote),
        });
        if (ticks.length >= count) {
          resolved = true;
          clearTimeout(timeout);
          ws.close();
          resolve(ticks);
        }
      }
    };

    ws.onerror = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        // Return whatever ticks we got
        resolve(ticks);
      }
    };

    ws.onclose = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(ticks);
      }
    };
  });
}

/* ------------------------------------------------------------------ */
/*  Backtest Adapter                                                    */
/* ------------------------------------------------------------------ */

let backtestProposalId = 1;
let backtestContractId = 1;

/**
 * Creates a BotTradingAdapter that simulates trading using historical tick data.
 * Instead of connecting to a real WS, it uses the tick buffer and simulates
 * proposal pricing and contract outcomes.
 */
export function createBacktestAdapter(
  ticks: BacktestTick[],
  config: BacktestConfig,
  onTick: BacktestTickCallback,
): {
  adapter: BotTradingAdapter;
  getTrades: () => BacktestTrade[];
  getStats: () => BacktestStats;
  getCurrentTick: () => BacktestTick | null;
  getTickIndex: () => number;
  getTickBuffer: () => BacktestTick[];
  advanceTick: () => boolean;
  reset: () => void;
} {
  let currentTickIndex = 0;
  let currentBalance = config.initialBalance;
  let peakBalance = config.initialBalance;
  let maxDrawdown = 0;
  let totalProfit = 0;
  let totalStake = 0;
  let wins = 0;
  let losses = 0;
  const trades: BacktestTrade[] = [];
  const balanceCurve: number[] = [currentBalance];
  const contractSubscribers = new Map<string, ContractUpdateCb>();
  const openContracts = new Map<string, AdapterContract>();

  function getCurrentTick(): BacktestTick | null {
    return ticks[currentTickIndex] ?? null;
  }

  function advanceTick(): boolean {
    if (currentTickIndex >= ticks.length - 1) return false;
    currentTickIndex++;
    const tick = ticks[currentTickIndex];
    if (tick) onTick(tick, currentTickIndex);

    // Update open contracts with new tick
    for (const [id, contract] of openContracts) {
      if (contract.is_sold || contract.status === "won" || contract.status === "lost") continue;

      contract.current_tick = tick.quote;
      contract.tick_count = (contract.tick_count || 0) + 1;

      // Check if contract has expired
      if ((contract.tick_count || 0) >= (config.durationTicks)) {
        // Determine win/loss based on contract type
        const entryPrice = contract.entry_tick || 0;
        const exitPrice = tick.quote;
        const barrier = config.barrier;
        const contractType = config.contractType.toUpperCase();

        let won = false;

        if (contractType.includes("DIGITOVER") || contractType === "DIGITOVER") {
          // Win if last digit of exit > barrier
          const lastDigit = Math.floor(Math.abs(exitPrice) * 100) % 10;
          won = lastDigit > barrier;
        } else if (contractType.includes("DIGITUNDER") || contractType === "DIGITUNDER") {
          const lastDigit = Math.floor(Math.abs(exitPrice) * 100) % 10;
          won = lastDigit < barrier;
        } else if (contractType.includes("DIGITDIFF") || contractType === "DIGITDIFF") {
          const lastDigit = Math.floor(Math.abs(exitPrice) * 100) % 10;
          won = lastDigit !== barrier;
        } else if (contractType.includes("DIGITEVEN") || contractType === "DIGITEVEN") {
          const lastDigit = Math.floor(Math.abs(exitPrice) * 100) % 10;
          won = lastDigit % 2 === 0;
        } else if (contractType.includes("DIGITODD") || contractType === "DIGITODD") {
          const lastDigit = Math.floor(Math.abs(exitPrice) * 100) % 10;
          won = lastDigit % 2 !== 0;
        } else {
          // Default: random win based on payout ratio
          won = Math.random() < 0.5;
        }

        // Calculate payout using Deriv's formula for digit contracts
        // For digit over/under: payout ≈ stake * 9 (approximate, varies by prediction)
        const stake = contract.buy_price || config.stake;
        const predictedDigit = config.barrier;
        // Payout multiplier depends on how many digits win
        // Over/Under with 1 winning digit out of 10 = ~9x
        const payoutMultiplier = 10 - 1; // 9x for single digit prediction
        const payout = stake * payoutMultiplier;
        const profit = won ? payout - stake : -stake;

        contract.exit_tick = exitPrice;
        contract.is_sold = true;
        contract.payout = won ? payout : 0;
        contract.profit = profit;
        contract.status = won ? "won" : "lost";

        // Update balances
        currentBalance += profit;
        totalProfit += profit;
        totalStake += stake;
        if (won) {
          wins++;
        } else {
          losses++;
        }
        if (currentBalance > peakBalance) peakBalance = currentBalance;
        const drawdown = peakBalance - currentBalance;
        if (drawdown > maxDrawdown) maxDrawdown = drawdown;

        // Record trade
        const trade: BacktestTrade = {
          id: `bt_${backtestContractId++}`,
          symbol: config.symbol,
          contract_type: contractType,
          stake,
          entry_tick: entryPrice,
          exit_tick: exitPrice,
          tick_count: contract.tick_count || config.durationTicks,
          profit,
          payout: won ? payout : 0,
          status: won ? "won" : "lost",
          timestamp: tick.epoch,
        };
        trades.push(trade);
        balanceCurve.push(currentBalance);

        // Notify subscriber
        const cb = contractSubscribers.get(id);
        if (cb) {
          cb({ ...contract });
          contractSubscribers.delete(id);
        }
        openContracts.delete(id);
      } else {
        // Contract still open — notify subscriber of tick update
        const cb = contractSubscribers.get(id);
        if (cb) cb({ ...contract });
      }
    }

    return true;
  }

  function reset(): void {
    currentTickIndex = 0;
    currentBalance = config.initialBalance;
    peakBalance = config.initialBalance;
    maxDrawdown = 0;
    totalProfit = 0;
    totalStake = 0;
    wins = 0;
    losses = 0;
    trades.length = 0;
    balanceCurve.length = 0;
    balanceCurve.push(currentBalance);
    contractSubscribers.clear();
    openContracts.clear();
  }

  function getTrades(): BacktestTrade[] {
    return [...trades];
  }

  function getStats(): BacktestStats {
    const totalTrades = wins + losses;
    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const grossProfit = trades.filter((t) => t.profit > 0).reduce((s, t) => s + t.profit, 0);
    const grossLoss = Math.abs(trades.filter((t) => t.profit < 0).reduce((s, t) => s + t.profit, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    return {
      totalTrades,
      wins,
      losses,
      winRate,
      totalProfit,
      totalStake,
      maxDrawdown,
      profitFactor,
      averageProfit: totalTrades > 0 ? totalProfit / totalTrades : 0,
      averageStake: totalTrades > 0 ? totalStake / totalTrades : 0,
      peakBalance,
      balanceCurve: [...balanceCurve],
    };
  }

  function getTickBuffer(): BacktestTick[] {
    return ticks;
  }

  // Create the adapter
  const adapter: BotTradingAdapter = {
    propose: async (req) => {
      const tick = getCurrentTick();
      if (!tick) return null;

      // Simulate proposal based on current tick
      const stake = req.amount || config.stake;
      const payoutMultiplier = 9; // Approximate for digit contracts
      const payout = stake * payoutMultiplier;

      return {
        id: `bt_prop_${backtestProposalId++}`,
        ask_price: stake,
        payout,
        profit: payout - stake,
        spot: tick.quote,
      };
    },

    buy: async (proposalId, price) => {
      const tick = getCurrentTick();
      if (!tick) return null;

      const contractId = `bt_contract_${backtestContractId++}`;
      const contract: AdapterContract = {
        contract_id: contractId,
        status: "open",
        profit: 0,
        buy_price: price || config.stake,
        payout: 0,
        entry_tick: tick.quote,
        current_tick: tick.quote,
        exit_tick: undefined,
        tick_count: 0,
        is_sold: false,
        contract_type: config.contractType,
        underlying: config.symbol,
        barrier: String(config.barrier),
      };

      openContracts.set(contractId, contract);
      return contract;
    },

    buyBot: undefined, // Use buy()

    sell: (contractId) => {
      const contract = openContracts.get(contractId);
      if (contract && !contract.is_sold) {
        const tick = getCurrentTick();
        if (tick) {
          // Early sell — always at a loss (approximate)
          const stake = contract.buy_price || config.stake;
          contract.exit_tick = tick.quote;
          contract.is_sold = true;
          contract.profit = -stake * 0.5; // Approximate early sell loss
          contract.payout = stake * 0.5;
          contract.status = "lost";

          currentBalance += contract.profit;
          totalProfit += contract.profit;
          totalStake += stake;
          losses++;
          if (currentBalance > peakBalance) peakBalance = currentBalance;
          balanceCurve.push(currentBalance);

          trades.push({
            id: `bt_${backtestContractId++}`,
            symbol: config.symbol,
            contract_type: config.contractType,
            stake,
            entry_tick: contract.entry_tick || 0,
            exit_tick: tick.quote,
            tick_count: contract.tick_count || 1,
            profit: contract.profit,
            payout: contract.payout || 0,
            status: "lost",
            timestamp: tick.epoch,
          });

          const cb = contractSubscribers.get(contractId);
          if (cb) {
            cb({ ...contract });
            contractSubscribers.delete(contractId);
          }
          openContracts.delete(contractId);
        }
      }
    },

    subscribeToContract: (contractId, cb) => {
      contractSubscribers.set(contractId, cb);
    },

    unsubscribeFromContract: (contractId) => {
      contractSubscribers.delete(contractId);
    },

    getBalance: () => currentBalance,
    isConnected: () => true, // Always "connected" in backtest mode
  };

  return {
    adapter,
    getTrades,
    getStats,
    getCurrentTick,
    getTickIndex: () => currentTickIndex,
    getTickBuffer: getTickBuffer,
    advanceTick,
    reset,
  };
}
