/**
 * Blockly toolbox configuration for DTrader bot builder.
 * Defines the categories and blocks available in the sidebar.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

export const DTRADER_TOOLBOX: any = {
  kind: "categoryToolbox",
  contents: [
    {
      kind: "category",
      name: "Trade",
      colour: "#2196F3",
      contents: [
        { kind: "block", type: "trade_definition" },
        { kind: "block", type: "trade_definition_market" },
        { kind: "block", type: "trade_definition_contracttype" },
        { kind: "block", type: "trade_definition_tradeoptions" },
      ],
    },
    {
      kind: "category",
      name: "Purchase",
      colour: "#4CAF50",
      contents: [
        { kind: "block", type: "before_purchase" },
        { kind: "block", type: "purchase" },
      ],
    },
    {
      kind: "category",
      name: "During",
      colour: "#CDDC39",
      contents: [
        { kind: "block", type: "during_purchase" },
        { kind: "block", type: "check_sell" },
        { kind: "block", type: "sell_at_market" },
      ],
    },
    {
      kind: "category",
      name: "After",
      colour: "#F44336",
      contents: [
        { kind: "block", type: "after_purchase" },
        { kind: "block", type: "trade_again" },
      ],
    },
    {
      kind: "category",
      name: "Ticks",
      colour: "#9C27B0",
      contents: [
        { kind: "block", type: "tick_analysis" },
        { kind: "block", type: "get_last_digit" },
        { kind: "block", type: "get_tick_count" },
      ],
    },
    {
      kind: "category",
      name: "Data",
      colour: "#009688",
      contents: [
        { kind: "block", type: "get_payout" },
        { kind: "block", type: "get_ask_price" },
        { kind: "block", type: "get_profit" },
        { kind: "block", type: "get_balance" },
      ],
    },
    {
      kind: "category",
      name: "Logic",
      colour: "#607D8B",
      contents: [
        {
          kind: "block",
          type: "controls_if",
        },
        {
          kind: "block",
          type: "logic_compare",
          inputs: {
            OP: {
              shadow: {
                type: "logic_compare",
                fields: { OP: "GT" },
              },
            },
          },
        },
        {
          kind: "block",
          type: "logic_boolean",
        },
      ],
    },
    {
      kind: "category",
      name: "Math",
      colour: "#795548",
      contents: [
        {
          kind: "block",
          type: "math_number",
          fields: { NUM: 0 },
        },
        {
          kind: "block",
          type: "math_arithmetic",
        },
      ],
    },
    {
      kind: "category",
      name: "Variables",
      custom: "VARIABLE",
      colour: "#FF9800",
    },
    {
      kind: "category",
      name: "Tools",
      colour: "#3F51B5",
      contents: [
        { kind: "block", type: "bot_log" },
        { kind: "block", type: "wait_ticks" },
      ],
    },
  ],
};

/** Default workspace XML — pre-loads the 4 main root blocks. */
export const DEFAULT_WORKSPACE_XML = `
<xml xmlns="http://www.w3.org/1999/xhtml">
  <block type="trade_definition" x="20" y="20">
    <statement name="TRADE_OPTIONS">
      <block type="trade_definition_market" deletable="false" movable="false">
        <field name="SYMBOL">1HZ100V</field>
        <next>
          <block type="trade_definition_contracttype" deletable="false" movable="false">
            <field name="CONTRACT_TYPE">DIGITOVER</field>
          </block>
        </next>
      </block>
    </statement>
    <statement name="INITIALIZATION"></statement>
  </block>
  <block type="before_purchase" x="400" y="20">
    <statement name="STACK">
      <block type="purchase">
        <field name="CONTRACT">PROPOSED</field>
      </block>
    </statement>
  </block>
  <block type="during_purchase" x="400" y="200">
    <statement name="STACK"></statement>
  </block>
  <block type="after_purchase" x="400" y="380">
    <statement name="STACK">
      <block type="trade_again">
        <field name="AGAIN">TRUE</field>
      </block>
    </statement>
  </block>
</xml>
`;
