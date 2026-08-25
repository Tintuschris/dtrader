/**
 * Custom Blockly block definitions for DTrader bot builder.
 * Registers blocks on Blockly.Blocks so they appear in the workspace.
 */
import * as Blockly from "blockly/core";

/* ------------------------------------------------------------------ */
/*  Trade Definition — root block                                      */
/* ------------------------------------------------------------------ */

Blockly.Blocks["trade_definition"] = {
  init() {
    this.appendDummyInput().appendField("📋 Trade Parameters");
    this.appendStatementInput("TRADE_OPTIONS").setCheck(null);
    this.appendDummyInput().appendField("▶ Run once at start");
    this.appendStatementInput("INITIALIZATION").setCheck(null);
    this.setColour(230);
    this.setTooltip("Define your trade parameters: market, type, and options.");
    this.setDeletable(false);
    this.setMovable(true);
  },
};

Blockly.Blocks["trade_definition_market"] = {
  init() {
    this.appendDummyInput()
      .appendField("Market")
      .appendField(
        new Blockly.FieldDropdown([
          ["Volatility 100 (1s)", "1HZ100V"],
          ["Volatility 75 (1s)", "1HZ75V"],
          ["Volatility 50 (1s)", "1HZ50V"],
          ["Volatility 25 (1s)", "1HZ25V"],
          ["Volatility 10 (1s)", "1HZ10V"],
          ["Boom 500", "BOOM500"],
          ["Boom 1000", "BOOM1000"],
          ["Crash 500", "CRASH500"],
          ["Crash 1000", "CRASH1000"],
        ]),
        "SYMBOL"
      );
    this.setColour(230);
    this.setTooltip("Select the market to trade on.");
    this.setDeletable(false);
  },
};

Blockly.Blocks["trade_definition_contracttype"] = {
  init() {
    this.appendDummyInput()
      .appendField("Contract")
      .appendField(
        new Blockly.FieldDropdown([
          ["Over", "DIGITOVER"],
          ["Under", "DIGITUNDER"],
          ["Match", "DIGITMATCH"],
          ["Differs", "DIGITDIFF"],
          ["Even", "DIGITEVEN"],
          ["Odd", "DIGITODD"],
        ]),
        "CONTRACT_TYPE"
      );
    this.setColour(230);
    this.setTooltip("Select the contract type.");
    this.setDeletable(false);
  },
};

Blockly.Blocks["trade_definition_tradeoptions"] = {
  init() {
    this.appendDummyInput().appendField("Trade Options");
    this.appendValueInput("STAKE")
      .setCheck("Number")
      .appendField("Stake (USD)");
    this.appendValueInput("DURATION")
      .setCheck("Number")
      .appendField("Duration (ticks)");
    this.appendDummyInput()
      .appendField("Barrier")
      .appendField(new Blockly.FieldNumber(0, 0, 9), "BARRIER");
    this.setColour(230);
    this.setTooltip("Set stake amount, duration, and barrier.");
    this.setDeletable(false);
  },
};

/* ------------------------------------------------------------------ */
/*  Before Purchase                                                    */
/* ------------------------------------------------------------------ */

Blockly.Blocks["before_purchase"] = {
  init() {
    this.appendDummyInput().appendField("🟢 Before Purchase");
    this.appendStatementInput("STACK").setCheck(null);
    this.setColour(160);
    this.setTooltip("Logic that runs before each purchase decision.");
    this.setDeletable(false);
    this.setMovable(true);
  },
};

Blockly.Blocks["purchase"] = {
  init() {
    this.appendDummyInput()
      .appendField("Buy")
      .appendField(
        new Blockly.FieldDropdown([
          ["the proposed contract", "PROPOSED"],
          ["Over", "DIGITOVER"],
          ["Under", "DIGITUNDER"],
          ["Match", "DIGITMATCH"],
          ["Differs", "DIGITDIFF"],
          ["Even", "DIGITEVEN"],
          ["Odd", "DIGITODD"],
        ]),
        "CONTRACT"
      );
    this.setColour(160);
    this.setTooltip("Purchase a contract.");
  },
};

/* ------------------------------------------------------------------ */
/*  During Purchase                                                    */
/* ------------------------------------------------------------------ */

Blockly.Blocks["during_purchase"] = {
  init() {
    this.appendDummyInput().appendField("🟡 During Purchase");
    this.appendStatementInput("STACK").setCheck(null);
    this.setColour(65);
    this.setTooltip("Logic that runs while a contract is open (e.g. sell checks).");
    this.setDeletable(false);
    this.setMovable(true);
  },
};

Blockly.Blocks["check_sell"] = {
  init() {
    this.appendDummyInput().appendField("Should sell?");
    this.setOutput(true, "Boolean");
    this.setColour(65);
    this.setTooltip("Returns true if the contract should be sold early.");
  },
};

Blockly.Blocks["sell_at_market"] = {
  init() {
    this.appendDummyInput().appendField("Sell at market");
    this.setColour(65);
    this.setTooltip("Sell the currently open contract at market price.");
  },
};

/* ------------------------------------------------------------------ */
/*  After Purchase                                                     */
/* ------------------------------------------------------------------ */

Blockly.Blocks["after_purchase"] = {
  init() {
    this.appendDummyInput().appendField("🔴 After Purchase");
    this.appendStatementInput("STACK").setCheck(null);
    this.setColour(0);
    this.setTooltip("Logic that runs after a contract settles.");
    this.setDeletable(false);
    this.setMovable(true);
  },
};

Blockly.Blocks["trade_again"] = {
  init() {
    this.appendDummyInput()
      .appendField("Trade again?")
      .appendField(
        new Blockly.FieldDropdown([
          ["Yes", "TRUE"],
          ["No — stop bot", "FALSE"],
        ]),
        "AGAIN"
      );
    this.setColour(0);
    this.setTooltip("Whether to place another trade after this one settles.");
  },
};

/* ------------------------------------------------------------------ */
/*  Tick Analysis                                                      */
/* ------------------------------------------------------------------ */

Blockly.Blocks["tick_analysis"] = {
  init() {
    this.appendDummyInput().appendField("📊 Tick Analysis");
    this.appendStatementInput("STACK").setCheck(null);
    this.setColour(290);
    this.setTooltip("Custom logic that runs on every new tick.");
    this.setMovable(true);
  },
};

Blockly.Blocks["get_last_digit"] = {
  init() {
    this.appendDummyInput().appendField("Last digit");
    this.setOutput(true, "Number");
    this.setColour(290);
    this.setTooltip("Returns the last digit of the current tick price.");
  },
};

Blockly.Blocks["get_tick_count"] = {
  init() {
    this.appendDummyInput().appendField("Tick count");
    this.setOutput(true, "Number");
    this.setColour(290);
    this.setTooltip("Returns the number of ticks since the bot started.");
  },
};

/* ------------------------------------------------------------------ */
/*  Payout / Profit                                                    */
/* ------------------------------------------------------------------ */

Blockly.Blocks["get_payout"] = {
  init() {
    this.appendDummyInput().appendField("Payout");
    this.setOutput(true, "Number");
    this.setColour(160);
    this.setTooltip("Returns the payout of the current proposal.");
  },
};

Blockly.Blocks["get_ask_price"] = {
  init() {
    this.appendDummyInput().appendField("Ask price (cost)");
    this.setOutput(true, "Number");
    this.setColour(160);
    this.setTooltip("Returns the ask price (cost) of the current proposal.");
  },
};

Blockly.Blocks["get_profit"] = {
  init() {
    this.appendDummyInput().appendField("Profit");
    this.setOutput(true, "Number");
    this.setColour(0);
    this.setTooltip("Returns the profit/loss of the last settled contract.");
  },
};

Blockly.Blocks["get_balance"] = {
  init() {
    this.appendDummyInput().appendField("Balance");
    this.setOutput(true, "Number");
    this.setColour(230);
    this.setTooltip("Returns the current account balance.");
  },
};

/* ------------------------------------------------------------------ */
/*  Utility blocks                                                     */
/* ------------------------------------------------------------------ */

Blockly.Blocks["bot_log"] = {
  init() {
    this.appendValueInput("MSG").appendField("Log");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour(290);
    this.setTooltip("Log a message to the bot journal.");
  },
};

Blockly.Blocks["wait_ticks"] = {
  init() {
    this.appendValueInput("TICKS")
      .setCheck("Number")
      .appendField("Wait");
    this.appendDummyInput().appendField("ticks");
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour(290);
    this.setTooltip("Wait for a number of ticks before continuing.");
  },
};

/** Register all blocks — call once at app startup. */
export function registerAllBlocks(): void {
  // Blocks are registered via Blockly.Blocks[...] above.
  // This function exists as an explicit call point.
}
