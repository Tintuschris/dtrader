/**
 * Strategy Analyzer — analyzes Blockly workspace blocks to produce
 * a human-readable summary for the strategy preview panel.
 */

import type * as Blockly from "blockly/core";

/* ---- Types ---- */

export type BlockCategory =
  | "trade"
  | "purchase"
  | "proposal"
  | "sell"
  | "after"
  | "stake"
  | "ticks"
  | "logic"
  | "math"
  | "text"
  | "variables"
  | "tools"
  | "unknown";

export type CategoryInfo = {
  name: string;
  count: number;
  color: string;
  blockTypes: string[];
};

export type StrategyAnalysis = {
  totalBlocks: number;
  uniqueBlockTypes: number;
  categories: CategoryInfo[];
  rootBlocks: string[];
  complexity: "simple" | "moderate" | "advanced" | "complex";
  complexityScore: number; // 0-100
  hasLoop: boolean;
  hasConditionals: boolean;
  hasVariables: boolean;
  hasMathOperations: boolean;
  nestingDepth: number;
  warnings: string[];
};

/* ---- Category mapping ---- */

const CATEGORY_MAP: Record<string, { name: string; category: BlockCategory; color: string }> = {
  // Trade definition
  trade_definition: { name: "Trade Definition", category: "trade", color: "#2196F3" },
  trade_definition_market: { name: "Market", category: "trade", color: "#2196F3" },
  trade_definition_tradetype: { name: "Trade Type", category: "trade", color: "#2196F3" },
  trade_definition_contracttype: { name: "Contract Type", category: "trade", color: "#2196F3" },
  trade_definition_tradeoptions: { name: "Trade Options", category: "trade", color: "#2196F3" },
  trade_definition_restartonerror: { name: "Restart on Error", category: "trade", color: "#2196F3" },
  trade_definition_restartbuysell: { name: "Restart Buy/Sell", category: "trade", color: "#2196F3" },
  trade_definition_candleinterval: { name: "Candle Interval", category: "trade", color: "#2196F3" },

  // Purchase
  before_purchase: { name: "Before Purchase", category: "purchase", color: "#4CAF50" },
  purchase: { name: "Purchase", category: "purchase", color: "#4CAF50" },
  purchase_by_type: { name: "Purchase by Type", category: "purchase", color: "#4CAF50" },

  // Proposal
  get_proposal_id: { name: "Get Proposal ID", category: "proposal", color: "#66BB6A" },
  get_ask_price: { name: "Get Ask Price", category: "proposal", color: "#66BB6A" },
  get_payout: { name: "Get Payout", category: "proposal", color: "#66BB6A" },
  get_profit: { name: "Get Profit", category: "proposal", color: "#66BB6A" },
  get_spot: { name: "Get Spot", category: "proposal", color: "#66BB6A" },
  get_proposal_valid: { name: "Proposal Valid", category: "proposal", color: "#66BB6A" },

  // Sell
  during_purchase: { name: "During Purchase", category: "sell", color: "#CDDC39" },
  sell_at_market: { name: "Sell at Market", category: "sell", color: "#CDDC39" },
  should_sell: { name: "Should Sell", category: "sell", color: "#CDDC39" },
  get_contract_profit: { name: "Contract Profit", category: "sell", color: "#CDDC39" },
  get_contract_status: { name: "Contract Status", category: "sell", color: "#CDDC39" },
  get_entry_tick: { name: "Entry Tick", category: "sell", color: "#CDDC39" },
  get_current_tick: { name: "Current Tick", category: "sell", color: "#CDDC39" },
  get_exit_tick: { name: "Exit Tick", category: "sell", color: "#CDDC39" },
  get_tick_count: { name: "Tick Count", category: "sell", color: "#CDDC39" },
  get_contract_duration: { name: "Contract Duration", category: "sell", color: "#CDDC39" },

  // After purchase
  after_purchase: { name: "After Purchase", category: "after", color: "#F44336" },
  trade_again: { name: "Trade Again", category: "after", color: "#F44336" },
  check_result: { name: "Check Result", category: "after", color: "#F44336" },
  get_total_profit: { name: "Total Profit", category: "after", color: "#F44336" },
  get_total_stake: { name: "Total Stake", category: "after", color: "#F44336" },
  get_loss_count: { name: "Loss Count", category: "after", color: "#F44336" },
  get_win_count: { name: "Win Count", category: "after", color: "#F44336" },
  get_trade_count: { name: "Trade Count", category: "after", color: "#F44336" },

  // Stake management
  set_stake: { name: "Set Stake", category: "stake", color: "#FF9800" },
  multiply_stake: { name: "Multiply Stake", category: "stake", color: "#FF9800" },
  reset_stake: { name: "Reset Stake", category: "stake", color: "#FF9800" },

  // Tick analysis
  tick_analysis: { name: "Tick Analysis", category: "ticks", color: "#9C27B0" },
  get_last_digit: { name: "Last Digit", category: "ticks", color: "#9C27B0" },
  get_last_digit_candle: { name: "Last Digit Candle", category: "ticks", color: "#9C27B0" },
  get_balance: { name: "Get Balance", category: "ticks", color: "#9C27B0" },

  // Logic
  controls_if: { name: "If", category: "logic", color: "#607D8B" },
  logic_compare: { name: "Compare", category: "logic", color: "#607D8B" },
  logic_operation: { name: "And/Or", category: "logic", color: "#607D8B" },
  logic_boolean: { name: "Boolean", category: "logic", color: "#607D8B" },
  logic_negate: { name: "Not", category: "logic", color: "#607D8B" },
  controls_if_ext: { name: "If", category: "logic", color: "#607D8B" },

  // Math
  math_number: { name: "Number", category: "math", color: "#795548" },
  math_arithmetic: { name: "Arithmetic", category: "math", color: "#795548" },
  math_single: { name: "Math Function", category: "math", color: "#795548" },
  math_modulo: { name: "Modulo", category: "math", color: "#795548" },
  math_random_int: { name: "Random Int", category: "math", color: "#795548" },
  math_round: { name: "Round", category: "math", color: "#795548" },
  math_constrain: { name: "Constrain", category: "math", color: "#795548" },

  // Text
  text: { name: "Text", category: "text", color: "#00BCD4" },
  text_join: { name: "Join Text", category: "text", color: "#00BCD4" },
  text_length: { name: "Text Length", category: "text", color: "#00BCD4" },

  // Variables
  variables_set: { name: "Set Variable", category: "variables", color: "#FF5722" },
  variables_get: { name: "Get Variable", category: "variables", color: "#FF5722" },
  variables_getOrDefault: { name: "Get Variable", category: "variables", color: "#FF5722" },

  // Tools
  bot_log: { name: "Log", category: "tools", color: "#3F51B5" },
  wait_ticks: { name: "Wait Ticks", category: "tools", color: "#3F51B5" },
  notify: { name: "Notify", category: "tools", color: "#3F51B5" },

  // Loops
  controls_repeat_ext: { name: "Repeat", category: "logic", color: "#607D8B" },
  controls_whileUntil: { name: "While/Until", category: "logic", color: "#607D8B" },
  controls_for: { name: "For Loop", category: "logic", color: "#607D8B" },
  controls_forRange: { name: "For Range", category: "logic", color: "#607D8B" },

  // Lists
  lists_create_empty: { name: "Empty List", category: "math", color: "#795548" },
  lists_length: { name: "List Length", category: "math", color: "#795548" },
};

const CATEGORY_NAMES: Record<BlockCategory, string> = {
  trade: "Trade",
  purchase: "Purchase",
  proposal: "Proposal",
  sell: "Sell",
  after: "After Purchase",
  stake: "Stake",
  ticks: "Ticks",
  logic: "Logic",
  math: "Math",
  text: "Text",
  variables: "Variables",
  tools: "Tools",
  unknown: "Other",
};

/* ---- Complexity scoring ---- */

function computeComplexityScore(analysis: Omit<StrategyAnalysis, "complexity" | "complexityScore">): number {
  let score = 0;

  // Block count contribution (0-30)
  score += Math.min(30, analysis.totalBlocks * 1.5);

  // Category diversity (0-20)
  score += Math.min(20, analysis.categories.length * 3);

  // Nesting depth (0-20)
  score += Math.min(20, analysis.nestingDepth * 5);

  // Logic blocks (0-15)
  const logicBlocks = analysis.categories.find((c) => c.name === "Logic");
  score += Math.min(15, (logicBlocks?.count ?? 0) * 3);

  // Variable usage (0-10)
  if (analysis.hasVariables) score += 5;

  // Math operations (0-5)
  if (analysis.hasMathOperations) score += 5;

  return Math.min(100, Math.round(score));
}

function scoreToLevel(score: number): StrategyAnalysis["complexity"] {
  if (score < 20) return "simple";
  if (score < 45) return "moderate";
  if (score < 70) return "advanced";
  return "complex";
}

/* ---- Main analysis ---- */

export function analyzeWorkspace(workspace: Blockly.WorkspaceSvg): StrategyAnalysis {
  const blocks = workspace.getAllBlocks(false);
  const allBlocks = workspace.getAllBlocks(true);

  // Count blocks by type
  const typeCounts = new Map<string, number>();
  const categoryMap = new Map<string, { count: number; blockTypes: Set<string>; color: string }>();
  const rootBlocks: string[] = [];

  for (const block of allBlocks) {
    const type = block.type;
    typeCounts.set(type, (typeCounts.get(type) ?? 0) + 1);

    const info = CATEGORY_MAP[type];
    const catKey = info?.category ?? "unknown";
    const catName = CATEGORY_NAMES[catKey];

    if (!categoryMap.has(catKey)) {
      categoryMap.set(catKey, { count: 0, blockTypes: new Set(), color: info?.color ?? "#666" });
    }
    const cat = categoryMap.get(catKey)!;
    cat.count++;
    cat.blockTypes.add(type);

    // Check if root block (no parent)
    if (!block.getParent()) {
      const blockName = info?.name ?? type;
      if (!rootBlocks.includes(blockName)) rootBlocks.push(blockName);
    }
  }

  // Convert to CategoryInfo[]
  const categories: CategoryInfo[] = [];
  for (const [key, cat] of categoryMap) {
    categories.push({
      name: CATEGORY_NAMES[key as BlockCategory] ?? key,
      count: cat.count,
      color: cat.color,
      blockTypes: Array.from(cat.blockTypes),
    });
  }
  categories.sort((a, b) => b.count - a.count);

  // Feature detection
  const hasLoop = blocks.some((b) =>
    ["controls_repeat_ext", "controls_whileUntil", "controls_for", "controls_forRange"].includes(b.type),
  );
  const hasConditionals = blocks.some((b) =>
    ["controls_if", "controls_if_ext", "logic_compare"].includes(b.type),
  );
  const hasVariables = blocks.some((b) =>
    ["variables_set", "variables_get", "variables_getOrDefault"].includes(b.type),
  );
  const hasMathOperations = blocks.some((b) =>
    ["math_arithmetic", "math_single", "math_modulo", "math_random_int"].includes(b.type),
  );

  // Nesting depth
  let maxDepth = 0;
  for (const block of allBlocks) {
    let depth = 0;
    let current = block.getParent();
    while (current) {
      depth++;
      current = current.getParent();
    }
    maxDepth = Math.max(maxDepth, depth);
  }

  // Warnings
  const warnings: string[] = [];
  if (!typeCounts.has("trade_definition")) {
    warnings.push("Missing Trade Definition block — strategy won't run without it");
  }
  if (!typeCounts.has("before_purchase")) {
    warnings.push("Missing Before Purchase block");
  }
  if (!typeCounts.has("after_purchase")) {
    warnings.push("Missing After Purchase block");
  }
  if (blocks.length === 0) {
    warnings.push("Workspace is empty");
  }
  if (hasLoop && !hasConditionals) {
    warnings.push("Loop without conditions may run indefinitely");
  }

  const totalBlocks = allBlocks.length;
  const uniqueBlockTypes = typeCounts.size;

  const partialAnalysis = {
    totalBlocks,
    uniqueBlockTypes,
    categories,
    rootBlocks,
    hasLoop,
    hasConditionals,
    hasVariables,
    hasMathOperations,
    nestingDepth: maxDepth,
    warnings,
  };

  const complexityScore = computeComplexityScore(partialAnalysis);
  const complexity = scoreToLevel(complexityScore);

  return {
    ...partialAnalysis,
    complexity,
    complexityScore,
  };
}
