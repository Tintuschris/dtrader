/**
 * JavaScript code generator for DTrader custom blocks.
 * Translates Blockly workspace into executable trading bot code.
 *
 * Each block registers a generator function that returns either:
 * - A string (for statement blocks)
 * - A [string, number] tuple (for value/expression blocks)
 */
import * as Blockly from "blockly/core";

type BlockGenerator = (
  block: Blockly.Block,
  generator: Blockly.Generator,
) => string | [string, number];

const generators: Record<string, BlockGenerator> = {};

/* ================================================================== */
/*  Trade Definition                                                    */
/* ================================================================== */

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

generators["trade_definition_tradetype"] = (block) => {
  const tradeType = block.getFieldValue("TRADETYPE");
  return `Bot.setTradeType('${tradeType}');\n`;
};

generators["trade_definition_contracttype"] = (block) => {
  const contractType = block.getFieldValue("CONTRACT_TYPE");
  return `Bot.setContractType('${contractType}');\n`;
};

generators["trade_definition_restartonerror"] = (block) => {
  const restart = block.getFieldValue("RESTART") === "TRUE";
  return `Bot.setRestartOnError(${restart});\n`;
};

generators["trade_definition_restartbuysell"] = (block) => {
  const enabled = block.getFieldValue("ENABLED") === "TRUE";
  return `Bot.setTimeMachineEnabled(${enabled});\n`;
};

generators["trade_definition_candleinterval"] = (block) => {
  const interval = block.getFieldValue("INTERVAL");
  return `Bot.setCandleInterval(${interval});\n`;
};

generators["trade_definition_tradeoptions"] = (block, generator) => {
  const stake = generator.valueToCode(block, "STAKE", 0) || "1";
  const duration = generator.valueToCode(block, "DURATION", 0) || "5";
  const basis = block.getFieldValue("BASIS") || "stake";
  const durationUnit = block.getFieldValue("DURATION_UNIT") || "t";
  const prediction = block.getFieldValue("PREDICTION");
  const minStake = generator.valueToCode(block, "MIN_STAKE", 0);
  const maxStake = generator.valueToCode(block, "MAX_STAKE", 0);
  const takeProfit = generator.valueToCode(block, "TAKE_PROFIT", 0);
  const stopLoss = generator.valueToCode(block, "STOP_LOSS", 0);

  let code = `
    Bot.setAmount(${stake});
    Bot.setBasis('${basis}');
    Bot.setDuration(${duration});
    Bot.setDurationUnit('${durationUnit}');
  `;

  if (prediction && prediction !== "-1") {
    code += `Bot.setPrediction(${prediction});\n`;
  }
  if (minStake) {
    code += `Bot.setMinStake(${minStake});\n`;
  }
  if (maxStake) {
    code += `Bot.setMaxStake(${maxStake});\n`;
  }
  if (takeProfit) {
    code += `Bot.setTakeProfit(${takeProfit});\n`;
  }
  if (stopLoss) {
    code += `Bot.setStopLoss(${stopLoss});\n`;
  }

  code += `BinaryBotPrivateHasCalledTradeOptions = true;\n`;
  return code;
};

/* ================================================================== */
/*  Before Purchase                                                     */
/* ================================================================== */

generators["before_purchase"] = (block, generator) => {
  const stack = generator.statementToCode(block, "STACK");
  return `
    BinaryBotPrivateBeforePurchase = function() {
      ${stack.trim()}
    };
  `;
};

/* ================================================================== */
/*  Purchase                                                            */
/* ================================================================== */

generators["purchase"] = () => {
  return `Bot.purchase();\n`;
};

generators["purchase_by_type"] = (block) => {
  const contract = block.getFieldValue("CONTRACT");
  return `Bot.purchase('${contract}');\n`;
};

/* ================================================================== */
/*  Proposal state readers                                               */
/* ================================================================== */

generators["get_proposal_id"] = () => {
  return ["Bot.getProposalId()", 0];
};

generators["get_ask_price"] = () => {
  return ["Bot.getAskPrice()", 0];
};

generators["get_payout"] = () => {
  return ["Bot.getPayout()", 0];
};

generators["get_profit"] = () => {
  return ["Bot.getPayout() - Bot.getAskPrice()", 0];
};

generators["get_spot"] = () => {
  return ["Bot.getSpotPrice()", 0];
};

generators["get_proposal_valid"] = () => {
  return ["Bot.isProposalValid()", 0];
};

/* ================================================================== */
/*  During Purchase                                                     */
/* ================================================================== */

generators["during_purchase"] = (block, generator) => {
  const stack = generator.statementToCode(block, "STACK");
  return `
    BinaryBotPrivateDuringPurchase = function() {
      ${stack.trim()}
    };
  `;
};

/* ================================================================== */
/*  Sell blocks                                                         */
/* ================================================================== */

generators["sell_at_market"] = () => {
  return `Bot.sell();\n`;
};

generators["should_sell"] = () => {
  return ["Bot.shouldSell()", 0];
};

generators["get_contract_profit"] = () => {
  return ["Bot.getContractProfit()", 0];
};

generators["get_contract_status"] = () => {
  return ["Bot.getContractStatus()", 0];
};

generators["get_entry_tick"] = () => {
  return ["Bot.getEntryTick()", 0];
};

generators["get_current_tick"] = () => {
  return ["Bot.getCurrentTick()", 0];
};

generators["get_exit_tick"] = () => {
  return ["Bot.getExitTick()", 0];
};

generators["get_tick_count"] = () => {
  return ["Bot.getTickCount()", 0];
};

generators["get_contract_duration"] = () => {
  return ["Bot.getContractDuration()", 0];
};

/* ================================================================== */
/*  After Purchase                                                      */
/* ================================================================== */

generators["after_purchase"] = (block, generator) => {
  const stack = generator.statementToCode(block, "STACK");
  return `
    BinaryBotPrivateAfterPurchase = function() {
      ${stack.trim()}
    };
  `;
};

/* ================================================================== */
/*  After-purchase result checks                                         */
/* ================================================================== */

generators["check_result"] = (block) => {
  const result = block.getFieldValue("RESULT");
  switch (result) {
    case "won":
      return ["Bot.getContractStatus() === 'won'", 0];
    case "lost":
      return ["Bot.getContractStatus() === 'lost'", 0];
    case "not_expired":
      return ["['won', 'lost', 'sold'].includes(Bot.getContractStatus())", 0];
    default:
      return ["false", 0];
  }
};

generators["get_total_profit"] = () => {
  return ["Bot.getTotalProfit()", 0];
};

generators["get_total_stake"] = () => {
  return ["Bot.getTotalStake()", 0];
};

generators["get_loss_count"] = () => {
  return ["Bot.getConsecutiveLosses()", 0];
};

generators["get_win_count"] = () => {
  return ["Bot.getWinCount()", 0];
};

generators["get_trade_count"] = () => {
  return ["Bot.getTradeCount()", 0];
};

/* ================================================================== */
/*  Trade Again                                                         */
/* ================================================================== */

generators["trade_again"] = (block) => {
  const again = block.getFieldValue("AGAIN");
  return `return ${again === "TRUE"};\n`;
};

/* ================================================================== */
/*  Stake Management                                                    */
/* ================================================================== */

generators["set_stake"] = (block, generator) => {
  const stake = generator.valueToCode(block, "STAKE", 0) || "1";
  return `Bot.setAmount(${stake});\n`;
};

generators["multiply_stake"] = (block, generator) => {
  const multiplier = generator.valueToCode(block, "MULTIPLIER", 0) || "2";
  return `Bot.setAmount(Bot.getAmount() * ${multiplier});\n`;
};

generators["reset_stake"] = () => {
  return `Bot.resetAmount();\n`;
};

/* ================================================================== */
/*  Tick Analysis                                                       */
/* ================================================================== */

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

generators["get_last_digit_candle"] = (block) => {
  const field = block.getFieldValue("FIELD");
  return [`Bot.getCandle('${field}')`, 0];
};

/* ================================================================== */
/*  Balance                                                             */
/* ================================================================== */

generators["get_balance"] = () => {
  return ["Bot.getBalance()", 0];
};

/* ================================================================== */
/*  Utility blocks                                                      */
/* ================================================================== */

generators["bot_log"] = (block, generator) => {
  const msg = generator.valueToCode(block, "MSG", 0) || "'empty'";
  return `Bot.log(${msg});\n`;
};

generators["wait_ticks"] = (block, generator) => {
  const ticks = generator.valueToCode(block, "TICKS", 0) || "1";
  return `Bot.waitTicks(${ticks});\n`;
};

generators["notify"] = (block, generator) => {
  const msg = generator.valueToCode(block, "MSG", 0) || "'notification'";
  const sound = block.getFieldValue("SOUND") || "info";
  return `Bot.notify(${msg}, '${sound}');\n`;
};

/* ================================================================== */
/*  Blockly Built-in Block Generators                                   */
/* ================================================================== */

/**
 * Register the DTrader code generator with Blockly.
 * Must be called after Blockly is loaded.
 */
export function registerDTraderGenerator(): void {
  const dtraderGen = new Blockly.Generator("DTrader");

  // Scrub: chain next blocks for statement blocks
  dtraderGen.scrub_ = (block, code, thisOnly) => {
    const nextBlock =
      block.nextConnection && block.nextConnection.targetBlock();
    if (nextBlock && !thisOnly) {
      return code + dtraderGen.blockToCode(nextBlock);
    }
    return code;
  };

  // Register all custom generators
  for (const [type, fn] of Object.entries(generators)) {
    dtraderGen.forBlock[type] = fn;
  }

  /* ---- Standard block generators ---- */

  dtraderGen.forBlock["math_number"] = (block) => {
    const num = block.getFieldValue("NUM");
    return [String(num), 0];
  };

  dtraderGen.forBlock["math_number_positive"] = (block) => {
    const num = block.getFieldValue("NUM");
    return [String(num), 0];
  };

  dtraderGen.forBlock["math_arithmetic"] = (block, generator) => {
    const op = block.getFieldValue("OP");
    const left = generator.valueToCode(block, "A", 0) || "0";
    const right = generator.valueToCode(block, "B", 0) || "0";
    const ops: Record<string, string> = {
      ADD: "+", MINUS: "-", MULTIPLY: "*",
      DIVIDE: "/", MODULO: "%", POWER: "**",
    };
    return [`(${left} ${ops[op] || "+"} ${right})`, 0];
  };

  dtraderGen.forBlock["math_single"] = (block, generator) => {
    const op = block.getFieldValue("OP");
    const val = generator.valueToCode(block, "NUM", 0) || "0";
    const ops: Record<string, string> = {
      ROOT: `Math.sqrt(${val})`,
      ABS: `Math.abs(${val})`,
      NEG: `(-${val})`,
      LN: `Math.log(${val})`,
      LOG10: `Math.log10(${val})`,
      EXP: `Math.exp(${val})`,
      POW10: `Math.pow(10, ${val})`,
    };
    return [ops[op as string] || val, 0];
  };

  dtraderGen.forBlock["math_random_int"] = (block, generator) => {
    const from = generator.valueToCode(block, "FROM", 0) || "0";
    const to = generator.valueToCode(block, "TO", 0) || "100";
    return [`Math.floor(Math.random() * (${to} - ${from} + 1) + ${from})`, 0];
  };

  dtraderGen.forBlock["math_modulo"] = (block, generator) => {
    const div = generator.valueToCode(block, "DIVIDEND", 0) || "0";
    const mod = generator.valueToCode(block, "DIVISOR", 0) || "1";
    return [`(${div} % ${mod})`, 0];
  };

  dtraderGen.forBlock["logic_compare"] = (block, generator) => {
    const op = block.getFieldValue("OP");
    const left = generator.valueToCode(block, "A", 0) || "0";
    const right = generator.valueToCode(block, "B", 0) || "0";
    const ops: Record<string, string> = {
      EQ: "==", NEQ: "!=", LT: "<", LTE: "<=", GT: ">", GTE: ">=",
    };
    return [`(${left} ${ops[op] || "=="} ${right})`, 0];
  };

  dtraderGen.forBlock["logic_boolean"] = (block) => {
    const val = block.getFieldValue("BOOL");
    return [val === "TRUE" ? "true" : "false", 0];
  };

  dtraderGen.forBlock["logic_operation"] = (block, generator) => {
    const op = block.getFieldValue("OP");
    const left = generator.valueToCode(block, "A", 0) || "true";
    const right = generator.valueToCode(block, "B", 0) || "true";
    return op === "AND"
      ? [`(${left} && ${right})`, 0]
      : [`(${left} || ${right})`, 0];
  };

  dtraderGen.forBlock["logic_negate"] = (block, generator) => {
    const val = generator.valueToCode(block, "BOOL", 0) || "true";
    return [`(!${val})`, 0];
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

  dtraderGen.forBlock["controls_for"] = (block, generator) => {
    const varName = block.getFieldValue("VAR") || "i";
    const from = generator.valueToCode(block, "FROM", 0) || "0";
    const to = generator.valueToCode(block, "TO", 0) || "10";
    const body = generator.statementToCode(block, "DO");
    return `for (var ${varName} = ${from}; ${varName} <= ${to}; ${varName}++) {\n${body}}\n`;
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

  dtraderGen.forBlock["text"] = (block) => {
    const text = block.getFieldValue("TEXT") || "";
    return [`'${text}'`, 0];
  };

  dtraderGen.forBlock["text_join"] = (block, generator) => {
    const items = [];
    for (let i = 0; i < block.inputList.length; i++) {
      const val = generator.valueToCode(block, `ADD${i}`, 0);
      if (val) items.push(val);
    }
    return [`[${items.join(" + ")}].join('')`, 0];
  };

  dtraderGen.forBlock["text_length"] = (block, generator) => {
    const val = generator.valueToCode(block, "VALUE", 0) || "''";
    return [`${val}.length`, 0];
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

/**
 * Wrap user-generated code in the standard Deriv Bot execution loop.
 */
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
