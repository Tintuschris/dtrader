/**
 * JavaScript code generator for DTrader custom blocks.
 * Translates Blockly workspace into executable trading bot code.
 */
import * as Blockly from "blockly/core";

/** Custom code generators for each block type. */
type BlockGenerator = (
  block: Blockly.Block,
  generator: Blockly.Generator,
) => string | [string, number];
const generators: Record<string, BlockGenerator> = {};

/* ------------------------------------------------------------------ */
/*  Trade Definition                                                   */
/* ------------------------------------------------------------------ */

generators["trade_definition"] = (block, generator) => {
  const tradeOptions = generator.statementToCode(block, "TRADE_OPTIONS");
  const initialization = generator.statementToCode(block, "INITIALIZATION");
  return `
    BinaryBotPrivateInit = function() {
      ${tradeOptions.trim()}
      ${initialization.trim()}
    };
  `;
};

generators["trade_definition_market"] = (block) => {
  const symbol = block.getFieldValue("SYMBOL");
  return `Bot.setSymbol('${symbol}');\n`;
};

generators["trade_definition_contracttype"] = (block) => {
  const contractType = block.getFieldValue("CONTRACT_TYPE");
  return `Bot.setContractType('${contractType}');\n`;
};

generators["trade_definition_tradeoptions"] = (block, generator) => {
  const stake = generator.valueToCode(block, "STAKE", 0) || "1";
  const duration = generator.valueToCode(block, "DURATION", 0) || "5";
  const barrier = block.getFieldValue("BARRIER");
  return `
    Bot.setStake(${stake});
    Bot.setDuration(${duration});
    Bot.setBarrier(${barrier});
  `;
};

/* ------------------------------------------------------------------ */
/*  Before Purchase                                                    */
/* ------------------------------------------------------------------ */

generators["before_purchase"] = (block, generator) => {
  const stack = generator.statementToCode(block, "STACK");
  return `
    BinaryBotPrivateBeforePurchase = function() {
      ${stack.trim()}
    };
  `;
};

generators["purchase"] = (block) => {
  const contract = block.getFieldValue("CONTRACT");
  if (contract === "PROPOSED") {
    return `Bot.purchase();\n`;
  }
  return `Bot.purchase('${contract}');\n`;
};

/* ------------------------------------------------------------------ */
/*  During Purchase                                                    */
/* ------------------------------------------------------------------ */

generators["during_purchase"] = (block, generator) => {
  const stack = generator.statementToCode(block, "STACK");
  return `
    BinaryBotPrivateDuringPurchase = function() {
      ${stack.trim()}
    };
  `;
};

generators["check_sell"] = () => {
  return ["Bot.checkSell()", 0];
};

generators["sell_at_market"] = () => {
  return `Bot.sell();\n`;
};

/* ------------------------------------------------------------------ */
/*  After Purchase                                                     */
/* ------------------------------------------------------------------ */

generators["after_purchase"] = (block, generator) => {
  const stack = generator.statementToCode(block, "STACK");
  return `
    BinaryBotPrivateAfterPurchase = function() {
      ${stack.trim()}
    };
  `;
};

generators["trade_again"] = (block) => {
  const again = block.getFieldValue("AGAIN");
  return `return ${again === "TRUE"};\n`;
};

/* ------------------------------------------------------------------ */
/*  Tick Analysis                                                      */
/* ------------------------------------------------------------------ */

generators["tick_analysis"] = (block, generator) => {
  const stack = generator.statementToCode(block, "STACK");
  return `
    BinaryBotPrivateTickAnalysisList.push(function() {
      ${stack.trim()}
    });
  `;
};

generators["get_last_digit"] = () => {
  return ["Bot.getLastDigit()", 0];
};

generators["get_tick_count"] = () => {
  return ["Bot.getTickCount()", 0];
};

/* ------------------------------------------------------------------ */
/*  Payout / Profit                                                    */
/* ------------------------------------------------------------------ */

generators["get_payout"] = () => {
  return ["Bot.getPayout()", 0];
};

generators["get_ask_price"] = () => {
  return ["Bot.getAskPrice()", 0];
};

generators["get_profit"] = () => {
  return ["Bot.getProfit()", 0];
};

generators["get_balance"] = () => {
  return ["Bot.getBalance()", 0];
};

/* ------------------------------------------------------------------ */
/*  Utility blocks                                                     */
/* ------------------------------------------------------------------ */

generators["bot_log"] = (block, generator) => {
  const msg = generator.valueToCode(block, "MSG", 0) || "'empty'";
  return `Bot.log(${msg});\n`;
};

generators["wait_ticks"] = (block, generator) => {
  const ticks = generator.valueToCode(block, "TICKS", 0) || "1";
  return `Bot.waitTicks(${ticks});\n`;
};

/**
 * Register the DTrader code generator with Blockly.
 * Must be called after Blockly is loaded.
 */
export function registerDTraderGenerator(): void {
  const dtraderGen = new Blockly.Generator("DTrader");

  // Use Blockly's built-in generators for standard blocks
  dtraderGen.scrub_ = (block, code, thisOnly) => {
    const nextBlock =
      block.nextConnection && block.nextConnection.targetBlock();
    if (nextBlock && !thisOnly) {
      return code + dtraderGen.blockToCode(nextBlock);
    }
    return code;
  };

  // Register custom generators
  for (const [type, fn] of Object.entries(generators)) {
    dtraderGen.forBlock[type] = fn;
  }

  // Register standard block types with the basic generator
  dtraderGen.forBlock["math_number"] = (block) => {
    const num = block.getFieldValue("NUM");
    return [String(num), 0];
  };

  dtraderGen.forBlock["math_arithmetic"] = (block, generator) => {
    const op = block.getFieldValue("OP");
    const left = generator.valueToCode(block, "A", 0) || "0";
    const right = generator.valueToCode(block, "B", 0) || "0";
    const ops: Record<string, string> = {
      ADD: "+",
      MINUS: "-",
      MULTIPLY: "*",
      DIVIDE: "/",
      MODULO: "%",
    };
    return [`(${left} ${ops[op] || "+"} ${right})`, 0];
  };

  dtraderGen.forBlock["math_number_positive"] = (block) => {
    const num = block.getFieldValue("NUM");
    return [String(num), 0];
  };

  dtraderGen.forBlock["logic_compare"] = (block, generator) => {
    const op = block.getFieldValue("OP");
    const left = generator.valueToCode(block, "A", 0) || "0";
    const right = generator.valueToCode(block, "B", 0) || "0";
    const ops: Record<string, string> = {
      EQ: "==",
      NEQ: "!=",
      LT: "<",
      LTE: "<=",
      GT: ">",
      GTE: ">=",
    };
    return [`(${left} ${ops[op] || "=="} ${right})`, 0];
  };

  dtraderGen.forBlock["logic_boolean"] = (block) => {
    const val = block.getFieldValue("BOOL");
    return [val === "TRUE" ? "true" : "false", 0];
  };

  dtraderGen.forBlock["controls_if"] = (block, generator) => {
    const cond = generator.valueToCode(block, "IF0", 0) || "false";
    const then = generator.statementToCode(block, "DO0");
    const elseIf = generator.statementToCode(block, "ELSE");
    let code = `if (${cond}) {\n${then}}`;
    if (elseIf) {
      code += ` else {\n${elseIf}}`;
    }
    return code;
  };

  dtraderGen.forBlock["controls_whileUntil"] = (block, generator) => {
    const mode = block.getFieldValue("MODE");
    const cond = generator.valueToCode(block, "BOOL", 0) || "true";
    const body = generator.statementToCode(block, "DO");
    return mode === "UNTIL"
      ? `while (!(${cond})) {\n${body}}\n`
      : `while (${cond}) {\n${body}}\n`;
  };

  dtraderGen.forBlock["variables_get"] = (block) => {
    const varName = block.getFieldValue("VAR") || "variable";
    return [`${varName}`, 0];
  };

  dtraderGen.forBlock["variables_set"] = (block, generator) => {
    const varName = block.getFieldValue("VAR") || "variable";
    const val = generator.valueToCode(block, "VALUE", 0) || "0";
    return `${varName} = ${val};\n`;
  };

  dtraderGen.forBlock["math_change"] = (block, generator) => {
    const varName = block.getFieldValue("VAR") || "variable";
    const delta = generator.valueToCode(block, "DELTA", 0) || "1";
    return `${varName} += ${delta};\n`;
  };

  // Store generator for use in generateBotCode
  (globalThis as Record<string, unknown>).__dtraderGen = dtraderGen;
}

/**
 * Generate JavaScript code from a Blockly workspace.
 */
export function generateBotCode(workspace: Blockly.Workspace): string {
  const gen = (globalThis as Record<string, unknown>).__dtraderGen as Blockly.Generator | undefined;
  if (!gen) {
    return "// Error: DTrader generator not registered";
  }
  return gen.workspaceToCode(workspace);
}

/** Returns the wrapped bot execution code with the main loop. */
export function wrapInExecutionLoop(userCode: string): string {
  return `
var BinaryBotPrivateInit;
var BinaryBotPrivateStart;
var BinaryBotPrivateBeforePurchase;
var BinaryBotPrivateDuringPurchase;
var BinaryBotPrivateAfterPurchase;
var BinaryBotPrivateLastTickTime;
var BinaryBotPrivateTickAnalysisList = [];
var BinaryBotPrivateHasCalledTradeOptions = false;

function BinaryBotPrivateRun(f, arg) {
  if (f) return f(arg);
  return false;
}

function BinaryBotPrivateTickAnalysis() {
  var currentTickTime = Bot.getLastTick(true);
  if (currentTickTime === 'MarketIsClosed') return;
  currentTickTime = currentTickTime.epoch;
  if (currentTickTime === BinaryBotPrivateLastTickTime) return;
  BinaryBotPrivateLastTickTime = currentTickTime;
  for (var i = 0; i < BinaryBotPrivateTickAnalysisList.length; i++) {
    BinaryBotPrivateRun(BinaryBotPrivateTickAnalysisList[i]);
  }
}

// --- User-generated code ---
${userCode}
// --- End user code ---

BinaryBotPrivateRun(BinaryBotPrivateInit);
while (true) {
  BinaryBotPrivateTickAnalysis();
  BinaryBotPrivateRun(BinaryBotPrivateStart);
  if (!BinaryBotPrivateHasCalledTradeOptions) { sleep(1); continue; }
  while (watch('before')) {
    BinaryBotPrivateTickAnalysis();
    BinaryBotPrivateRun(BinaryBotPrivateBeforePurchase);
  }
  while (watch('during')) {
    BinaryBotPrivateTickAnalysis();
    BinaryBotPrivateRun(BinaryBotPrivateDuringPurchase);
  }
  BinaryBotPrivateTickAnalysis();
  if (!BinaryBotPrivateRun(BinaryBotPrivateAfterPurchase)) break;
}
  `;
}
