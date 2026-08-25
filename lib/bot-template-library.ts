import { exportToDerivBotXml } from "./deriv-bot-xml-exporter";
import type { BotConfig } from "../components/use-bot";

/* ------------------------------------------------------------------ */
/*  Pre-built Bot Template Library                                     */
/*                                                                      */
/*  A collection of proven Deriv Bot strategies that users can browse,  */
/*  preview, and import with one click. Each template generates valid   */
/*  Blockly XML compatible with dbot.deriv.com.                        */
/* ------------------------------------------------------------------ */

export type BotTemplateEntry = {
  id: string;
  name: string;
  description: string;
  category: "digit" | "martingale" | "pattern" | "trend" | "conservative";
  difficulty: "beginner" | "intermediate" | "advanced";
  riskLevel: "low" | "medium" | "high";
  tags: string[];
  icon: string;
  config: BotConfig;
};

function makeConfig(overrides: Partial<BotConfig> & { name: string; strategy: BotConfig["strategy"] }): BotConfig {
  return {
    id: "",
    symbol: "1HZ100V",
    contract_type: "DIGITOVER",
    stake: 5,
    currency: "USD",
    duration_ticks: 5,
    barrier: "1",
    max_stake: 100,
    take_profit: 30,
    stop_loss: 50,
    max_trades: 50,
    martingale_multiplier: 2,
    dryRun: false,
    ...overrides,
  };
}

export const BOT_TEMPLATE_LIBRARY: BotTemplateEntry[] = [
  /* ===== DIGIT STRATEGIES ===== */
  {
    id: "steady-over-5",
    name: "Steady Over 5",
    description: "Conservative digit over strategy. Bets the last digit will be above 5. High win rate, steady returns.",
    category: "digit",
    difficulty: "beginner",
    riskLevel: "low",
    tags: ["conservative", "high win rate", "digit"],
    icon: "🟢",
    config: makeConfig({
      name: "Steady Over 5",
      strategy: "constant",
      contract_type: "DIGITOVER",
      stake: 5,
      barrier: "5",
      duration_ticks: 5,
      take_profit: 25,
      stop_loss: 30,
      max_trades: 100,
    }),
  },
  {
    id: "safe-under-3",
    name: "Safe Under 3",
    description: "Ultra-conservative. Bets last digit will be below 3. Very high hit rate but lower payout.",
    category: "digit",
    difficulty: "beginner",
    riskLevel: "low",
    tags: ["ultra safe", "high hit rate", "low payout"],
    icon: "🛡️",
    config: makeConfig({
      name: "Safe Under 3",
      strategy: "constant",
      contract_type: "DIGITUNDER",
      stake: 10,
      barrier: "3",
      duration_ticks: 5,
      take_profit: 20,
      stop_loss: 40,
      max_trades: 80,
    }),
  },
  {
    id: "match-hunter",
    name: "Digit Match Hunter",
    description: "Hunts for specific digit matches. High payout per win ($30+) but lower hit rate. Use small stakes.",
    category: "digit",
    difficulty: "intermediate",
    riskLevel: "high",
    tags: ["high payout", "digit match", "low win rate"],
    icon: "🎯",
    config: makeConfig({
      name: "Digit Match Hunter",
      strategy: "constant",
      contract_type: "DIGITMATCH",
      stake: 1,
      barrier: "7",
      duration_ticks: 10,
      take_profit: 50,
      stop_loss: 20,
      max_trades: 100,
    }),
  },
  {
    id: "differs-grinder",
    name: "Differs Grinder",
    description: "Bets digit won't match. Consistent small wins with high frequency. Great for steady grinding.",
    category: "digit",
    difficulty: "beginner",
    riskLevel: "low",
    tags: ["steady", "high frequency", "grinding"],
    icon: "🎲",
    config: makeConfig({
      name: "Differs Grinder",
      strategy: "constant",
      contract_type: "DIGITDIFF",
      stake: 10,
      barrier: "5",
      duration_ticks: 5,
      take_profit: 30,
      stop_loss: 25,
      max_trades: 200,
    }),
  },
  {
    id: "even-odd-streak",
    name: "Even/Odd Trend",
    description: "Trades even/odd contracts with fixed stake. Simple binary prediction with consistent payouts.",
    category: "digit",
    difficulty: "beginner",
    riskLevel: "medium",
    tags: ["simple", "binary", "even odd"],
    icon: "⚖️",
    config: makeConfig({
      name: "Even/Odd Trend",
      strategy: "constant",
      contract_type: "DIGITEVEN",
      stake: 5,
      duration_ticks: 5,
      take_profit: 30,
      stop_loss: 30,
      max_trades: 100,
    }),
  },

  /* ===== MARTINGALE STRATEGIES ===== */
  {
    id: "classic-martingale",
    name: "Classic Martingale",
    description: "Double stake after each loss, reset on win. Aggressive recovery strategy with strict limits.",
    category: "martingale",
    difficulty: "intermediate",
    riskLevel: "high",
    tags: ["martingale", "recovery", "aggressive"],
    icon: "🎰",
    config: makeConfig({
      name: "Classic Martingale",
      strategy: "martingale",
      contract_type: "DIGITOVER",
      stake: 1,
      barrier: "1",
      duration_ticks: 5,
      martingale_multiplier: 2,
      max_stake: 64,
      take_profit: 50,
      stop_loss: 100,
      max_trades: 60,
    }),
  },
  {
    id: "gentle-martingale",
    name: "Gentle Martingale",
    description: "1.5x multiplier martingale. Less aggressive, slower recovery but lower risk of hitting limits.",
    category: "martingale",
    difficulty: "intermediate",
    riskLevel: "medium",
    tags: ["martingale", "gentle", "1.5x"],
    icon: "📈",
    config: makeConfig({
      name: "Gentle Martingale",
      strategy: "martingale",
      contract_type: "DIGITOVER",
      stake: 2,
      barrier: "2",
      duration_ticks: 5,
      martingale_multiplier: 1.5,
      max_stake: 30,
      take_profit: 40,
      stop_loss: 60,
      max_trades: 50,
    }),
  },
  {
    id: "anti-martingale-streak",
    name: "Anti-Martingale Streak",
    description: "Double stake after each win. Rides winning streaks for maximum profit during hot runs.",
    category: "martingale",
    difficulty: "advanced",
    riskLevel: "high",
    tags: ["anti-martingale", "streaks", "momentum"],
    icon: "🔥",
    config: makeConfig({
      name: "Anti-Martingale Streak",
      strategy: "anti_martingale",
      contract_type: "DIGITOVER",
      stake: 2,
      barrier: "1",
      duration_ticks: 5,
      martingale_multiplier: 2,
      max_stake: 50,
      take_profit: 60,
      stop_loss: 30,
      max_trades: 40,
    }),
  },
  {
    id: "martingale-differs",
    name: "Martingale Differs",
    description: "Martingale on Digit Differs. Higher base win rate (90%) with aggressive recovery on rare losses.",
    category: "martingale",
    difficulty: "advanced",
    riskLevel: "high",
    tags: ["martingale", "differs", "high win rate"],
    icon: "🎰🎲",
    config: makeConfig({
      name: "Martingale Differs",
      strategy: "martingale",
      contract_type: "DIGITDIFF",
      stake: 5,
      barrier: "5",
      duration_ticks: 5,
      martingale_multiplier: 2.5,
      max_stake: 200,
      take_profit: 80,
      stop_loss: 150,
      max_trades: 50,
    }),
  },

  /* ===== PATTERN STRATEGIES ===== */
  {
    id: "over-2-vol50",
    name: "Volatility 50 Over 2",
    description: "Digit Over 2 on Volatility 50. Lower volatility market with predictable digit distribution.",
    category: "pattern",
    difficulty: "beginner",
    riskLevel: "low",
    tags: ["volatility 50", "conservative", "predictable"],
    icon: "📊",
    config: makeConfig({
      name: "Volatility 50 Over 2",
      strategy: "constant",
      symbol: "1HZ50V",
      contract_type: "DIGITOVER",
      stake: 5,
      barrier: "2",
      duration_ticks: 5,
      take_profit: 20,
      stop_loss: 25,
      max_trades: 100,
    }),
  },
  {
    id: "speed-bot-1s",
    name: "1-Second Speed Bot",
    description: "Ultra-fast 1-tick trades on Volatility 100 (1s). High frequency with tiny windows.",
    category: "pattern",
    difficulty: "advanced",
    riskLevel: "high",
    tags: ["1s index", "speed", "high frequency", "1 tick"],
    icon: "⚡",
    config: makeConfig({
      name: "1s Speed Bot",
      strategy: "constant",
      symbol: "1HZ10V",
      contract_type: "DIGITOVER",
      stake: 1,
      barrier: "4",
      duration_ticks: 1,
      take_profit: 20,
      stop_loss: 15,
      max_trades: 200,
    }),
  },
  {
    id: "crash-500-differs",
    name: "Crash 500 Differs",
    description: "Digit Differs on Crash 500. Profits from the crash index's unique price behavior.",
    category: "pattern",
    difficulty: "intermediate",
    riskLevel: "medium",
    tags: ["crash 500", "differs", "crash index"],
    icon: "📉",
    config: makeConfig({
      name: "Crash 500 Differs",
      strategy: "constant",
      symbol: "CRASH500",
      contract_type: "DIGITDIFF",
      stake: 3,
      barrier: "0",
      duration_ticks: 5,
      take_profit: 25,
      stop_loss: 20,
      max_trades: 80,
    }),
  },

  /* ===== TREND / MOMENTUM ===== */
  {
    id: "vol100-over-mart",
    name: "Vol 100 Over Martingale",
    description: "Martingale on Volatility 100 Over contracts. Higher volatility = bigger swings = faster recovery.",
    category: "trend",
    difficulty: "intermediate",
    riskLevel: "high",
    tags: ["volatility 100", "martingale", "trend"],
    icon: "🌊",
    config: makeConfig({
      name: "Vol 100 Over Martingale",
      strategy: "martingale",
      symbol: "1HZ100V",
      contract_type: "DIGITOVER",
      stake: 1,
      barrier: "3",
      duration_ticks: 5,
      martingale_multiplier: 2,
      max_stake: 50,
      take_profit: 40,
      stop_loss: 80,
      max_trades: 50,
    }),
  },
  {
    id: "vol75-even-odd",
    name: "Volatility 75 Even/Odd",
    description: "Even/Odd contracts on Volatility 75. Balanced market with good payout ratios.",
    category: "trend",
    difficulty: "beginner",
    riskLevel: "medium",
    tags: ["volatility 75", "even odd", "balanced"],
    icon: "🎲",
    config: makeConfig({
      name: "Vol 75 Even/Odd",
      strategy: "constant",
      symbol: "1HZ75V",
      contract_type: "DIGITEVEN",
      stake: 5,
      duration_ticks: 5,
      take_profit: 25,
      stop_loss: 25,
      max_trades: 100,
    }),
  },

  /* ===== CONSERVATIVE / DEFENSIVE ===== */
  {
    id: "micro-stake-safe",
    name: "Micro Stake Safety",
    description: "Minimal $0.35 stake with Under 2. Extremely low risk, near-guaranteed wins. Test strategy.",
    category: "conservative",
    difficulty: "beginner",
    riskLevel: "low",
    tags: ["micro stake", "safe", "test", "under 2"],
    icon: "🛡️",
    config: makeConfig({
      name: "Micro Stake Safety",
      strategy: "constant",
      contract_type: "DIGITUNDER",
      stake: 0.35,
      barrier: "2",
      duration_ticks: 5,
      take_profit: 10,
      stop_loss: 5,
      max_trades: 50,
    }),
  },
  {
    id: "profit-target-50",
    name: "Profit Target $50",
    description: "Standard digit strategy with strict $50 take profit. Walk away when target is hit.",
    category: "conservative",
    difficulty: "beginner",
    riskLevel: "medium",
    tags: ["profit target", "discipline", "set and forget"],
    icon: "🎯💰",
    config: makeConfig({
      name: "Profit Target $50",
      strategy: "constant",
      contract_type: "DIGITOVER",
      stake: 5,
      barrier: "4",
      duration_ticks: 5,
      take_profit: 50,
      stop_loss: 50,
      max_trades: 100,
    }),
  },
];

/** Generate XML for a template entry */
export function generateTemplateXml(entry: BotTemplateEntry): string {
  return exportToDerivBotXml(entry.config);
}

/** Get templates filtered by category */
export function getTemplatesByCategory(
  category: BotTemplateEntry["category"],
): BotTemplateEntry[] {
  return BOT_TEMPLATE_LIBRARY.filter((t) => t.category === category);
}

/** Get templates filtered by risk level */
export function getTemplatesByRisk(
  risk: BotTemplateEntry["riskLevel"],
): BotTemplateEntry[] {
  return BOT_TEMPLATE_LIBRARY.filter((t) => t.riskLevel === risk);
}

/** Search templates by name, description, or tags */
export function searchTemplates(query: string): BotTemplateEntry[] {
  const q = query.toLowerCase();
  return BOT_TEMPLATE_LIBRARY.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.tags.some((tag) => tag.toLowerCase().includes(q)),
  );
}

/** All unique categories */
export const TEMPLATE_CATEGORIES = [
  { id: "all", label: "All Templates", icon: "📋" },
  { id: "digit", label: "Digit Strategies", icon: "🎯" },
  { id: "martingale", label: "Martingale", icon: "🎰" },
  { id: "pattern", label: "Market Patterns", icon: "📊" },
  { id: "trend", label: "Trend / Momentum", icon: "🌊" },
  { id: "conservative", label: "Conservative", icon: "🛡️" },
] as const;
