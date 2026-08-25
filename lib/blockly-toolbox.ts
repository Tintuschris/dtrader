/* eslint-disable @typescript-eslint/no-explicit-any */

/** Blockly toolbox definition for DTrader bot builder. */
export const DTRADER_TOOLBOX: any = {
  kind: "categoryToolbox",
  contents: [
    /* ---- Trade Definition ---- */
    {
      kind: "category",
      name: "Trade",
      colour: "#2196F3",
      contents: [
        { kind: "block", type: "trade_definition" },
        { kind: "block", type: "trade_definition_market" },
        { kind: "block", type: "trade_definition_tradetype" },
        { kind: "block", type: "trade_definition_contracttype" },
        { kind: "block", type: "trade_definition_tradeoptions" },
        { kind: "block", type: "trade_definition_restartonerror" },
        { kind: "block", type: "trade_definition_restartbuysell" },
        { kind: "block", type: "trade_definition_candleinterval" },
      ],
    },
    /* ---- Purchase ---- */
    {
      kind: "category",
      name: "Purchase",
      colour: "#4CAF50",
      contents: [
        { kind: "block", type: "before_purchase" },
        { kind: "block", type: "purchase" },
        { kind: "block", type: "purchase_by_type" },
      ],
    },
    /* ---- Proposal / Read State ---- */
    {
      kind: "category",
      name: "Proposal",
      colour: "#66BB6A",
      contents: [
        { kind: "block", type: "get_proposal_id" },
        { kind: "block", type: "get_ask_price" },
        { kind: "block", type: "get_payout" },
        { kind: "block", type: "get_profit" },
        { kind: "block", type: "get_spot" },
        { kind: "block", type: "get_proposal_valid" },
      ],
    },
    /* ---- Sell / During ---- */
    {
      kind: "category",
      name: "Sell",
      colour: "#CDDC39",
      contents: [
        { kind: "block", type: "during_purchase" },
        { kind: "block", type: "sell_at_market" },
        { kind: "block", type: "should_sell" },
        { kind: "block", type: "get_contract_profit" },
        { kind: "block", type: "get_contract_status" },
        { kind: "block", type: "get_entry_tick" },
        { kind: "block", type: "get_current_tick" },
        { kind: "block", type: "get_exit_tick" },
        { kind: "block", type: "get_tick_count" },
        { kind: "block", type: "get_contract_duration" },
      ],
    },
    /* ---- After Purchase ---- */
    {
      kind: "category",
      name: "After",
      colour: "#F44336",
      contents: [
        { kind: "block", type: "after_purchase" },
        { kind: "block", type: "trade_again" },
        { kind: "block", type: "check_result" },
        { kind: "block", type: "get_total_profit" },
        { kind: "block", type: "get_total_stake" },
        { kind: "block", type: "get_loss_count" },
        { kind: "block", type: "get_win_count" },
        { kind: "block", type: "get_trade_count" },
      ],
    },
    /* ---- Stake Management ---- */
    {
      kind: "category",
      name: "Stake",
      colour: "#FF9800",
      contents: [
        { kind: "block", type: "set_stake" },
        { kind: "block", type: "multiply_stake" },
        { kind: "block", type: "reset_stake" },
      ],
    },
    /* ---- Tick Analysis ---- */
    {
      kind: "category",
      name: "Ticks",
      colour: "#9C27B0",
      contents: [
        { kind: "block", type: "tick_analysis" },
        { kind: "block", type: "get_last_digit" },
        { kind: "block", type: "get_last_digit_candle" },
        { kind: "block", type: "get_balance" },
      ],
    },
    /* ---- Logic ---- */
    {
      kind: "category",
      name: "Logic",
      colour: "#607D8B",
      contents: [
        { kind: "block", type: "controls_if" },
        { kind: "block", type: "logic_compare" },
        { kind: "block", type: "logic_operation" },
        { kind: "block", type: "logic_boolean" },
        { kind: "block", type: "logic_negate" },
      ],
    },
    /* ---- Math ---- */
    {
      kind: "category",
      name: "Math",
      colour: "#795548",
      contents: [
        { kind: "block", type: "math_number", fields: { NUM: 0 } },
        { kind: "block", type: "math_arithmetic" },
        { kind: "block", type: "math_single" },
        { kind: "block", type: "math_modulo" },
        { kind: "block", type: "math_random_int" },
      ],
    },
    /* ---- Text ---- */
    {
      kind: "category",
      name: "Text",
      colour: "#00BCD4",
      contents: [
        { kind: "block", type: "text", fields: { TEXT: "" } },
        { kind: "block", type: "text_join" },
        { kind: "block", type: "text_length" },
      ],
    },
    /* ---- Variables ---- */
    {
      kind: "category",
      name: "Variables",
      custom: "VARIABLE",
      colour: "#FF5722",
    },
    /* ---- Tools ---- */
    {
      kind: "category",
      name: "Tools",
      colour: "#3F51B5",
      contents: [
        { kind: "block", type: "bot_log" },
        { kind: "block", type: "wait_ticks" },
        { kind: "block", type: "notify" },
      ],
    },
  ],
};

/**
 * Default workspace XML — pre-loads the 4 mandatory root blocks
 * with sensible defaults for a basic digit-over strategy.
 */
export const DEFAULT_WORKSPACE_XML = `
<xml xmlns="http://www.w3.org/1999/xhtml">
  <block type="trade_definition" x="20" y="20">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" deletable="false" movable="false">
        <field name="MARKET">volatility</field>
        <field name="SYMBOL">1HZ100V</field>
        <next>
          <block type="trade_definition_tradetype" deletable="false" movable="false">
            <field name="TRADETYPECAT">digits</field>
            <field name="TRADETYPE">DIGITOVER</field>
            <next>
              <block type="trade_definition_contracttype" deletable="false" movable="false">
                <field name="CONTRACT_TYPE">both</field>
                <next>
                  <block type="trade_definition_tradeoptions" deletable="false" movable="false">
                    <field name="BASIS">stake</field>
                    <field name="DURATION_UNIT">t</field>
                    <field name="PREDICTION">4</field>
                    <value name="STAKE">
                      <shadow type="math_number">
                        <field name="NUM">1</field>
                      </shadow>
                    </value>
                    <value name="DURATION">
                      <shadow type="math_number">
                        <field name="NUM">5</field>
                      </shadow>
                    </value>
                  </block>
                </next>
              </block>
            </next>
          </block>
        </next>
      </block>
    </statement>
    <statement name="INITIALIZATION"></statement>
  </block>
  <block type="before_purchase" x="500" y="20">
    <statement name="STACK">
      <block type="purchase"></block>
    </statement>
  </block>
  <block type="during_purchase" x="500" y="220">
    <statement name="STACK">
      <block type="controls_if">
        <value name="IF0">
          <block type="logic_compare">
            <field name="OP">GT</field>
            <value name="A">
              <block type="get_contract_profit"></block>
            </value>
            <value name="B">
              <block type="math_number">
                <field name="NUM">0.5</field>
              </block>
            </value>
          </block>
        </value>
        <statement name="DO0">
          <block type="sell_at_market"></block>
        </statement>
      </block>
    </statement>
  </block>
  <block type="after_purchase" x="500" y="500">
    <statement name="STACK">
      <block type="trade_again">
        <field name="AGAIN">TRUE</field>
      </block>
    </statement>
  </block>
</xml>
`;
