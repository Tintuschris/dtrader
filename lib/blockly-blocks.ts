/**
 * Comprehensive custom Blockly block definitions for DTrader bot builder.
 *
 * Designed to closely match Deriv Bot's official block structure:
 * - Trade Definition root block with cascading market→type→contract dropdowns
 * - Trade Options with duration units, stake basis, barriers, restart settings
 * - Before/During/After Purchase lifecycle blocks
 * - Rich sell conditions (profit threshold, loss threshold, tick counting)
 * - After-purchase result checks and stake management
 */
import * as Blockly from "blockly/core";

/* ================================================================== */
/*  Trade Definition — root block (non-deletable)                      */
/* ================================================================== */

Blockly.Blocks["trade_definition"] = {
  init() {
    this.appendDummyInput()
      .appendField("📋")
      .appendField("Trade Parameters");
    this.appendStatementInput("TRADE_OPTIONS")
      .setCheck(["trade_definition_market", "trade_definition_tradetype",
                 "trade_definition_contracttype", "trade_definition_tradeoptions",
                 "trade_definition_restartonerror", "trade_definition_restartbuysell",
                 "trade_definition_candleinterval"]);
    this.appendDummyInput()
      .appendField("▶ Run once at start:");
    this.appendStatementInput("INITIALIZATION")
      .setCheck(null);
    this.setColour(230);
    this.setTooltip(
      "The root trade block. Define your market, trade type, contract type, " +
      "and trade options here. This block is required and cannot be deleted."
    );
    this.setDeletable(false);
    this.setMovable(true);
  },
};

/* ================================================================== */
/*  Market Selection                                                    */
/* ================================================================== */

/** Volatility indices (synthetic) */
const VOLATILITY_SYMBOLS: [string, string][] = [
  ["Volatility 10 (1s) Index", "1HZ10V"],
  ["Volatility 25 (1s) Index", "1HZ25V"],
  ["Volatility 50 (1s) Index", "1HZ50V"],
  ["Volatility 75 (1s) Index", "1HZ75V"],
  ["Volatility 100 (1s) Index", "1HZ100V"],
  ["Volatility 75 Index", "R75"],
  ["Volatility 100 Index", "R100"],
  ["Volatility 200 Index", "R200"],
  ["Volatility 250 Index", "R250"],
];

/** Crash/Boom indices */
const CRASH_BOOM_SYMBOLS: [string, string][] = [
  ["Boom 500 Index", "BOOM500"],
  ["Boom 1000 Index", "BOOM1000"],
  ["Crash 500 Index", "CRASH500"],
  ["Crash 1000 Index", "CRASH1000"],
];

/** Range break indices */
const RANGE_BREAK_SYMBOLS: [string, string][] = [
  ["Bull Market Index", "RDBULL"],
  ["Bear Market Index", "RDBEAR"],
];

/** Forex major pairs */
const FOREX_SYMBOLS: [string, string][] = [
  ["EUR/USD", "frxEURUSD"],
  ["GBP/USD", "frxGBPUSD"],
  ["USD/JPY", "frxUSDJPY"],
  ["AUD/USD", "frxAUDUSD"],
  ["EUR/GBP", "frxEURGBP"],
  ["EUR/JPY", "frxEURJPY"],
];

/** Market category → symbols mapping */
const MARKET_OPTIONS: [string, string][] = [
  ["Volatility Indices", "volatility"],
  ["Crash / Boom", "crash_boom"],
  ["Range Break", "range_break"],
  ["Forex", "forex"],
];

function getSymbolsForMarket(market: string): [string, string][] {
  switch (market) {
    case "volatility": return VOLATILITY_SYMBOLS;
    case "crash_boom": return CRASH_BOOM_SYMBOLS;
    case "range_break": return RANGE_BREAK_SYMBOLS;
    case "forex": return FOREX_SYMBOLS;
    default: return VOLATILITY_SYMBOLS;
  }
}

Blockly.Blocks["trade_definition_market"] = {
  init() {
    this.appendDummyInput()
      .appendField("Market:")
      .appendField(new Blockly.FieldDropdown(MARKET_OPTIONS), "MARKET")
      .appendField("Symbol:")
      .appendField(
        new Blockly.FieldDropdown(() => {
          // Access parent block to get current market value
          const block = this as unknown as Blockly.Block;
          const parent = block.getParent();
          const marketField = parent?.getFieldValue("MARKET") || "volatility";
          return getSymbolsForMarket(marketField as string);
        }),
        "SYMBOL"
      );
    this.setColour(230);
    this.setTooltip("Select the market and symbol to trade on.");
    this.setDeletable(false);
    this.setMovable(false);
  },
};

/* ================================================================== */
/*  Trade Type                                                          */
/* ================================================================== */

const TRADETYPE_CATEGORIES: [string, string][] = [
  ["Digits", "digits"],
  ["Up / Down", "updown"],
  ["Asians", "asians"],
  ["Digits (Differs)", "digits_differs"],
];

const DIGIT_TRADETYPES: [string, string][] = [
  ["Over", "DIGITOVER"],
  ["Under", "DIGITUNDER"],
  ["Matches", "DIGITMATCH"],
];

const DIGIT_DIFFERS_TRADETYPES: [string, string][] = [
  ["Differs", "DIGITDIFF"],
  ["Even", "DIGITEVEN"],
  ["Odd", "DIGITODD"],
];

const UPDOWN_TRADETYPES: [string, string][] = [
  ["Rise", "CALL"],
  ["Fall", "PUT"],
];

const ASIAN_TRADETYPES: [string, string][] = [
  ["Asian Up", "ASIANU"],
  ["Asian Down", "ASIAND"],
];

function getTradeTypesForCategory(category: string): [string, string][] {
  switch (category) {
    case "digits": return DIGIT_TRADETYPES;
    case "digits_differs": return DIGIT_DIFFERS_TRADETYPES;
    case "updown": return UPDOWN_TRADETYPES;
    case "asians": return ASIAN_TRADETYPES;
    default: return DIGIT_TRADETYPES;
  }
}

Blockly.Blocks["trade_definition_tradetype"] = {
  init() {
    this.appendDummyInput()
      .appendField("Type:")
      .appendField(new Blockly.FieldDropdown(TRADETYPE_CATEGORIES), "TRADETYPECAT")
      .appendField(new Blockly.FieldDropdown(() => {
        const block = this as unknown as Blockly.Block;
        const parent = block.getParent();
        const cat = parent?.getFieldValue("TRADETYPECAT") || "digits";
        return getTradeTypesForCategory(cat as string);
      }), "TRADETYPE");
    this.setColour(230);
    this.setTooltip("Select the trade type category and specific type.");
    this.setDeletable(false);
    this.setMovable(false);
  },
};

/* ================================================================== */
/*  Contract Type (Both / Up only / Down only)                         */
/* ================================================================== */

Blockly.Blocks["trade_definition_contracttype"] = {
  init() {
    this.appendDummyInput()
      .appendField("Contract:")
      .appendField(
        new Blockly.FieldDropdown([
          ["Both (alternating)", "both"],
          ["Up only", "DIGITOVER"],
          ["Down only", "DIGITUNDER"],
          ["Match only", "DIGITMATCH"],
          ["Differs only", "DIGITDIFF"],
          ["Even only", "DIGITEVEN"],
          ["Odd only", "DIGITODD"],
        ]),
        "CONTRACT_TYPE"
      );
    this.setColour(230);
    this.setTooltip(
      "Choose 'Both' to alternate between up/down contracts, " +
      "or pick a specific direction."
    );
    this.setDeletable(false);
    this.setMovable(false);
  },
};

/* ================================================================== */
/*  Restart Options                                                     */
/* ================================================================== */

Blockly.Blocks["trade_definition_restartonerror"] = {
  init() {
    this.appendDummyInput()
      .appendField("On error:")
      .appendField(
        new Blockly.FieldDropdown([
          ["Restart trade", "TRUE"],
          ["Stop bot", "FALSE"],
        ]),
        "RESTART"
      );
    this.setColour(230);
    this.setTooltip("What to do when a trade error occurs.");
    this.setDeletable(false);
    this.setMovable(false);
  },
};

Blockly.Blocks["trade_definition_restartbuysell"] = {
  init() {
    this.appendDummyInput()
      .appendField("Time machine:")
      .appendField(
        new Blockly.FieldDropdown([
          ["Enabled (restart on buy/sell)", "TRUE"],
          ["Disabled", "FALSE"],
        ]),
        "ENABLED"
      );
    this.setColour(230);
    this.setTooltip(
      "Enable time machine to restart trade logic when a buy or sell occurs."
    );
    this.setDeletable(false);
    this.setMovable(false);
  },
};

/* ================================================================== */
/*  Candle Interval                                                     */
/* ================================================================== */

Blockly.Blocks["trade_definition_candleinterval"] = {
  init() {
    this.appendDummyInput()
      .appendField("Candle interval:")
      .appendField(
        new Blockly.FieldDropdown([
          ["1 minute", "60"],
          ["2 minutes", "120"],
          ["5 minutes", "300"],
          ["15 minutes", "900"],
          ["30 minutes", "1800"],
          ["1 hour", "3600"],
          ["4 hours", "14400"],
          ["8 hours", "28800"],
          ["1 day", "86400"],
        ]),
        "INTERVAL"
      );
    this.setColour(230);
    this.setTooltip("Candle interval for chart-based indicators.");
    this.setDeletable(false);
    this.setMovable(false);
  },
};

/* ================================================================== */
/*  Trade Options (stake, duration, barriers, min/max)                 */
/* ================================================================== */

const DURATION_UNITS: [string, string][] = [
  ["ticks", "t"],
  ["seconds", "s"],
  ["minutes", "m"],
  ["hours", "h"],
  ["days", "d"],
];

const STAKE_BASIS: [string, string][] = [
  ["Stake", "stake"],
  ["Payout", "payout"],
];

Blockly.Blocks["trade_definition_tradeoptions"] = {
  init() {
    this.appendDummyInput().appendField("⚙ Trade Options");
    this.appendValueInput("STAKE")
      .setCheck("Number")
      .appendField("Amount")
      .appendField(new Blockly.FieldDropdown(STAKE_BASIS), "BASIS");
    this.appendValueInput("DURATION")
      .setCheck("Number")
      .appendField("Duration")
      .appendField(new Blockly.FieldDropdown(DURATION_UNITS), "DURATION_UNIT");
    this.appendDummyInput()
      .appendField("Prediction:")
      .appendField(
        new Blockly.FieldDropdown([
          ["Any (auto)", "-1"],
          ["0", "0"],
          ["1", "1"],
          ["2", "2"],
          ["3", "3"],
          ["4", "4"],
          ["5", "5"],
          ["6", "6"],
          ["7", "7"],
          ["8", "8"],
          ["9", "9"],
        ]),
        "PREDICTION"
      );
    this.appendValueInput("MIN_STAKE")
      .setCheck("Number")
      .appendField("Min stake ($)");
    this.appendValueInput("MAX_STAKE")
      .setCheck("Number")
      .appendField("Max stake ($)");
    this.appendValueInput("TAKE_PROFIT")
      .setCheck("Number")
      .appendField("Take profit ($)");
    this.appendValueInput("STOP_LOSS")
      .setCheck("Number")
      .appendField("Stop loss ($)");
    this.setColour(230);
    this.setTooltip(
      "Configure stake amount, duration, prediction digit, " +
      "and risk management (min/max stake, take profit, stop loss)."
    );
    this.setDeletable(false);
    this.setMovable(false);
  },
};

/* ================================================================== */
/*  Before Purchase — root block                                        */
/* ================================================================== */

Blockly.Blocks["before_purchase"] = {
  init() {
    this.appendDummyInput()
      .appendField("🟢")
      .appendField("Before Purchase");
    this.appendStatementInput("STACK")
      .setCheck(null);
    this.setColour(160);
    this.setTooltip(
      "Runs before each purchase. Check proposals, compare ask prices, " +
      "and decide whether to buy."
    );
    this.setDeletable(false);
    this.setMovable(true);
  },
};

/* ================================================================== */
/*  Purchase blocks                                                     */
/* ================================================================== */

Blockly.Blocks["purchase"] = {
  init() {
    this.appendDummyInput()
      .appendField("Buy the proposed contract");
    this.setColour(160);
    this.setTooltip("Buy whichever contract the proposal system has selected.");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
  },
};

Blockly.Blocks["purchase_by_type"] = {
  init() {
    this.appendDummyInput()
      .appendField("Buy")
      .appendField(
        new Blockly.FieldDropdown([
          ["Over", "DIGITOVER"],
          ["Under", "DIGITUNDER"],
          ["Match", "DIGITMATCH"],
          ["Differs", "DIGITDIFF"],
          ["Even", "DIGITEVEN"],
          ["Odd", "DIGITODD"],
          ["Rise", "CALL"],
          ["Fall", "PUT"],
        ]),
        "CONTRACT"
      );
    this.setColour(160);
    this.setTooltip("Buy a specific contract type by name.");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
  },
};

/* ================================================================== */
/*  Proposal state readers                                              */
/* ================================================================== */

Blockly.Blocks["get_proposal_id"] = {
  init() {
    this.appendDummyInput().appendField("Proposal ID");
    this.setOutput(true, "String");
    this.setColour(160);
    this.setTooltip("The ID of the current proposal, needed to execute a purchase.");
  },
};

Blockly.Blocks["get_ask_price"] = {
  init() {
    this.appendDummyInput().appendField("Ask price");
    this.setOutput(true, "Number");
    this.setColour(160);
    this.setTooltip("The cost to buy the current proposal.");
  },
};

Blockly.Blocks["get_payout"] = {
  init() {
    this.appendDummyInput().appendField("Payout");
    this.setOutput(true, "Number");
    this.setTooltip("The total payout if the contract wins.");
    this.setOutput(true, "Number");
    this.setColour(160);
  },
};

Blockly.Blocks["get_profit"] = {
  init() {
    this.appendDummyInput().appendField("Potential profit");
    this.setOutput(true, "Number");
    this.setColour(160);
    this.setTooltip("Payout minus ask price (potential profit on win).");
  },
};

Blockly.Blocks["get_spot"] = {
  init() {
    this.appendDummyInput().appendField("Spot price");
    this.setOutput(true, "Number");
    this.setColour(160);
    this.setTooltip("The current spot price at the time of the proposal.");
  },
};

Blockly.Blocks["get_proposal_valid"] = {
  init() {
    this.appendDummyInput().appendField("Proposal is valid?");
    this.setOutput(true, "Boolean");
    this.setColour(160);
    this.setTooltip("True if a valid proposal exists and can be purchased.");
  },
};

/* ================================================================== */
/*  During Purchase — root block                                        */
/* ================================================================== */

Blockly.Blocks["during_purchase"] = {
  init() {
    this.appendDummyInput()
      .appendField("🟡")
      .appendField("During Purchase");
    this.appendStatementInput("STACK")
      .setCheck(null);
    this.setColour(65);
    this.setTooltip(
      "Runs while a contract is open. Monitor ticks, check profit, " +
      "and decide whether to sell early."
    );
    this.setDeletable(false);
    this.setMovable(true);
  },
};

/* ================================================================== */
/*  Sell blocks                                                         */
/* ================================================================== */

Blockly.Blocks["sell_at_market"] = {
  init() {
    this.appendDummyInput().appendField("Sell at market");
    this.setColour(65);
    this.setTooltip("Immediately sell the currently open contract at market price.");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
  },
};

Blockly.Blocks["should_sell"] = {
  init() {
    this.appendDummyInput().appendField("Should sell?");
    this.setOutput(true, "Boolean");
    this.setColour(65);
    this.setTooltip("True if the contract is eligible to be sold (is_sold === false).");
  },
};

Blockly.Blocks["get_contract_profit"] = {
  init() {
    this.appendDummyInput().appendField("Open contract profit");
    this.setOutput(true, "Number");
    this.setColour(65);
    this.setTooltip("The current unrealized profit/loss of the open contract.");
  },
};

Blockly.Blocks["get_contract_status"] = {
  init() {
    this.appendDummyInput().appendField("Contract status");
    this.setOutput(true, "String");
    this.setColour(65);
    this.setTooltip('Returns "pending", "open", "won", "lost", "sold", or "expired".');
  },
};

Blockly.Blocks["get_entry_tick"] = {
  init() {
    this.appendDummyInput().appendField("Entry tick");
    this.setOutput(true, "Number");
    this.setColour(65);
    this.setTooltip("The tick price at which the contract was purchased.");
  },
};

Blockly.Blocks["get_current_tick"] = {
  init() {
    this.appendDummyInput().appendField("Current tick");
    this.setOutput(true, "Number");
    this.setColour(65);
    this.setTooltip("The latest tick price while the contract is open.");
  },
};

Blockly.Blocks["get_exit_tick"] = {
  init() {
    this.appendDummyInput().appendField("Exit tick");
    this.setOutput(true, "Number");
    this.setColour(65);
    this.setTooltip("The tick price at which the contract settled (available after close).");
  },
};

Blockly.Blocks["get_tick_count"] = {
  init() {
    this.appendDummyInput().appendField("Ticks elapsed");
    this.setOutput(true, "Number");
    this.setColour(65);
    this.setTooltip("Number of ticks elapsed since the contract was purchased.");
  },
};

Blockly.Blocks["get_contract_duration"] = {
  init() {
    this.appendDummyInput().appendField("Contract duration (ticks)");
    this.setOutput(true, "Number");
    this.setColour(65);
    this.setTooltip("The total duration of the open contract in ticks.");
  },
};

/* ================================================================== */
/*  After Purchase — root block                                         */
/* ================================================================== */

Blockly.Blocks["after_purchase"] = {
  init() {
    this.appendDummyInput()
      .appendField("🔴")
      .appendField("After Purchase");
    this.appendStatementInput("STACK")
      .setCheck(null);
    this.setColour(0);
    this.setTooltip(
      "Runs after a contract settles. Check the result, update stakes, " +
      "and decide whether to trade again."
    );
    this.setDeletable(false);
    this.setMovable(true);
  },
};

/* ================================================================== */
/*  After-purchase result checks                                        */
/* ================================================================== */

Blockly.Blocks["check_result"] = {
  init() {
    this.appendDummyInput()
      .appendField("Result:")
      .appendField(
        new Blockly.FieldDropdown([
          ["Won", "won"],
          ["Lost", "lost"],
          ["Any (not expired)", "not_expired"],
        ]),
        "RESULT"
      );
    this.setOutput(true, "Boolean");
    this.setColour(0);
    this.setTooltip("Check whether the last contract won, lost, or settled at all.");
  },
};

Blockly.Blocks["get_total_profit"] = {
  init() {
    this.appendDummyInput().appendField("Total profit");
    this.setOutput(true, "Number");
    this.setColour(0);
    this.setTooltip("Cumulative profit/loss across all settled contracts.");
  },
};

Blockly.Blocks["get_total_stake"] = {
  init() {
    this.appendDummyInput().appendField("Total staked");
    this.setOutput(true, "Number");
    this.setColour(0);
    this.setTooltip("Total amount staked across all trades so far.");
  },
};

Blockly.Blocks["get_loss_count"] = {
  init() {
    this.appendDummyInput().appendField("Consecutive losses");
    this.setOutput(true, "Number");
    this.setColour(0);
    this.setTooltip("Number of consecutive losses (useful for martingale).");
  },
};

Blockly.Blocks["get_win_count"] = {
  init() {
    this.appendDummyInput().appendField("Total wins");
    this.setOutput(true, "Number");
    this.setColour(0);
    this.setTooltip("Total number of won contracts.");
  },
};

Blockly.Blocks["get_trade_count"] = {
  init() {
    this.appendDummyInput().appendField("Total trades");
    this.setOutput(true, "Number");
    this.setColour(0);
    this.setTooltip("Total number of settled contracts.");
  },
};

/* ================================================================== */
/*  Trade Again                                                         */
/* ================================================================== */

Blockly.Blocks["trade_again"] = {
  init() {
    this.appendDummyInput()
      .appendField("Trade again:")
      .appendField(
        new Blockly.FieldDropdown([
          ["Yes", "TRUE"],
          ["No — stop bot", "FALSE"],
        ]),
        "AGAIN"
      );
    this.setColour(0);
    this.setTooltip("Whether to place another trade after this one settles.");
    this.setPreviousStatement(true, null);
  },
};

/* ================================================================== */
/*  Stake Management (for martingale / anti-martingale)                 */
/* ================================================================== */

Blockly.Blocks["set_stake"] = {
  init() {
    this.appendValueInput("STAKE")
      .setCheck("Number")
      .appendField("Set stake to");
    this.setColour(230);
    this.setTooltip("Override the stake amount for the next trade.");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
  },
};

Blockly.Blocks["multiply_stake"] = {
  init() {
    this.appendValueInput("MULTIPLIER")
      .setCheck("Number")
      .appendField("Multiply stake by");
    this.setColour(230);
    this.setTooltip("Multiply the current stake (e.g. 2 for martingale).");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
  },
};

Blockly.Blocks["reset_stake"] = {
  init() {
    this.appendDummyInput().appendField("Reset stake to initial");
    this.setColour(230);
    this.setTooltip("Reset the stake back to the original configured amount.");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
  },
};

/* ================================================================== */
/*  Tick Analysis                                                       */
/* ================================================================== */

Blockly.Blocks["tick_analysis"] = {
  init() {
    this.appendDummyInput()
      .appendField("📊")
      .appendField("Tick Analysis");
    this.appendStatementInput("STACK")
      .setCheck(null);
    this.setColour(290);
    this.setTooltip(
      "Custom logic that runs on every new tick, " +
      "before the Before Purchase block."
    );
    this.setMovable(true);
  },
};

Blockly.Blocks["get_last_digit"] = {
  init() {
    this.appendDummyInput().appendField("Last digit");
    this.setOutput(true, "Number");
    this.setColour(290);
    this.setTooltip("The last digit (0-9) of the current tick price.");
  },
};

Blockly.Blocks["get_last_digit_candle"] = {
  init() {
    this.appendDummyInput()
      .appendField("Candle")
      .appendField(
        new Blockly.FieldDropdown([
          ["Open", "open"],
          ["High", "high"],
          ["Low", "low"],
          ["Close", "close"],
        ]),
        "FIELD"
      );
    this.setOutput(true, "Number");
    this.setColour(290);
    this.setTooltip("The specified OHLC field of the latest candle.");
  },
};

/* ================================================================== */
/*  Balance                                                             */
/* ================================================================== */

Blockly.Blocks["get_balance"] = {
  init() {
    this.appendDummyInput().appendField("Account balance");
    this.setOutput(true, "Number");
    this.setColour(230);
    this.setTooltip("The current account balance in the account currency.");
  },
};

/* ================================================================== */
/*  Utility blocks                                                      */
/* ================================================================== */

Blockly.Blocks["bot_log"] = {
  init() {
    this.appendValueInput("MSG")
      .appendField("📝 Log");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290);
    this.setTooltip("Log a message to the bot journal.");
  },
};

Blockly.Blocks["wait_ticks"] = {
  init() {
    this.appendValueInput("TICKS")
      .setCheck("Number")
      .appendField("⏱ Wait");
    this.appendDummyInput().appendField("ticks");
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290);
    this.setTooltip("Pause the bot for a number of ticks.");
  },
};

Blockly.Blocks["notify"] = {
  init() {
    this.appendValueInput("MSG")
      .setCheck("String")
      .appendField("🔔 Notify:");
    this.appendDummyInput()
      .appendField("Sound:")
      .appendField(
        new Blockly.FieldDropdown([
          ["Info", "info"],
          ["Alert", "alert"],
          ["Error", "error"],
          ["Silent", "silent"],
        ]),
        "SOUND"
      );
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(290);
    this.setTooltip("Show a notification with an optional sound.");
  },
};

/* ================================================================== */
/*  Register all                                                        */
/* ================================================================== */

/** Call once at app startup to ensure all blocks are registered. */
export function registerAllBlocks(): void {
  // All blocks are registered via Blockly.Blocks[...] above.
  // This function exists as an explicit initialization call point.
}
