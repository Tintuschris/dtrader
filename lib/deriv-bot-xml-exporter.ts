import type { BotConfig } from "../components/use-bot";

/* ------------------------------------------------------------------ */
/*  Deriv Bot XML (Blockly) Exporter                                   */
/*                                                                      */
/*  Converts our BotConfig into Blockly XML that can be imported into   */
/*  dbot.deriv.com or shared with other Deriv Bot users.               */
/* ------------------------------------------------------------------ */

/** Generate a random Blockly-style ID */
function blockId(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?";
  let id = "";
  for (let i = 0; i < 20; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

/** Map our contract types to Deriv market categories */
function getMarketCategory(
  symbol: string,
): { market: string; submarket: string } {
  if (symbol.startsWith("1HZ")) {
    if (symbol.includes("CR") || symbol.includes("BOOM") || symbol.includes("DD")) {
      return { market: "synthetic_index", submarket: "random_index" };
    }
    if (symbol.includes("RB")) {
      return { market: "synthetic_index", submarket: "random_range" };
    }
    return { market: "synthetic_index", submarket: "random_index" };
  }
  // Forex pairs
  if (symbol.includes("_") || /^[A-Z]{6}$/.test(symbol)) {
    return { market: "forex", submarket: "major_pairs" };
  }
  return { market: "synthetic_index", submarket: "random_index" };
}

/** Map contract type to Deriv tradetype category */
function getTradetypeCategory(contractType: string): {
  category: string;
  tradetype: string;
} {
  if (contractType.startsWith("DIGIT")) {
    return { category: "digits", tradetype: "overunder" };
  }
  if (contractType === "RISE" || contractType === "FALL") {
    return { category: "callpute", tradetype: "rise_fall" };
  }
  return { category: "digits", tradetype: "overunder" };
}

/** Escape XML special characters */
function esc(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function exportToDerivBotXml(config: BotConfig): string {
  const ids = {
    tradeDef: blockId(),
    market: blockId(),
    tradetype: blockId(),
    contracttype: blockId(),
    candleinterval: blockId(),
    restartBuysell: blockId(),
    restartError: blockId(),
    tradeOptions: blockId(),
    durationBlock: blockId(),
    amountBlock: blockId(),
    predictionShadow: blockId(),
    beforePurchase: blockId(),
    purchase: blockId(),
    afterPurchase: blockId(),
    ifCheck: blockId(),
    checkResult: blockId(),
    tradeAgainWin: blockId(),
    tradeAgainLose: blockId(),
    // Init blocks
    varStake: blockId(),
    varLoss: blockId(),
    varTarget: blockId(),
    setStake: blockId(),
    setLoss: blockId(),
    setTarget: blockId(),
    mathStake: blockId(),
    mathLoss: blockId(),
    mathTarget: blockId(),
    varStake2: blockId(),
    setStake2: blockId(),
    mathStake2: blockId(),
    // Variable IDs
    varIdStake: "var_stake",
    varIdLoss: "var_loss",
    varIdTarget: "var_target",
    varIdStake2: "var_stake2",
  };

  const { market, submarket } = getMarketCategory(config.symbol);
  const { category, tradetype } = getTradetypeCategory(config.contract_type);
  const stake = config.stake ?? 5;
  const barrier = config.barrier ?? "5";
  const durationTicks = config.duration_ticks ?? 5;
  const takeProfit = config.take_profit ?? 0;
  const stopLoss = config.stop_loss ?? 0;
  const hasMartingale =
    config.strategy === "martingale" || config.strategy === "anti_martingale";
  const stake2 = hasMartingale
    ? Math.round(stake * (config.martingale_multiplier ?? 2))
    : stake;

  const xml = `<xml xmlns="https://developers.google.com/blockly/xml" is_dbot="true" collection="false">
<variables>
  <variable id="${ids.varIdStake}">Stake</variable>
  <variable id="${ids.varIdLoss}">Loss</variable>
  <variable id="${ids.varIdTarget}">Target Profit</variable>
  ${hasMartingale ? `<variable id="${ids.varIdStake2}">stake 2</variable>` : ""}
</variables>

<!-- ===== TRADE DEFINITION ===== -->
<block type="trade_definition" id="${ids.tradeDef}" deletable="false" x="0" y="110">
  <statement name="TRADE_OPTIONS">
    <block type="trade_definition_market" id="${ids.market}" deletable="false" movable="false">
      <field name="MARKET_LIST">${esc(market)}</field>
      <field name="SUBMARKET_LIST">${esc(submarket)}</field>
      <field name="SYMBOL_LIST">${esc(config.symbol)}</field>
      <next>
        <block type="trade_definition_tradetype" id="${ids.tradetype}" deletable="false" movable="false">
          <field name="TRADETYPECAT_LIST">${esc(category)}</field>
          <field name="TRADETYPE_LIST">${esc(tradetype)}</field>
          <next>
            <block type="trade_definition_contracttype" id="${ids.contracttype}" deletable="false" movable="false">
              <field name="TYPE_LIST">${esc(config.contract_type)}</field>
              <next>
                <block type="trade_definition_candleinterval" id="${ids.candleinterval}" deletable="false" movable="false">
                  <field name="CANDLEINTERVAL_LIST">60</field>
                  <next>
                    <block type="trade_definition_restartbuysell" id="${ids.restartBuysell}" deletable="false" movable="false">
                      <field name="TIME_MACHINE_ENABLED">FALSE</field>
                      <next>
                        <block type="trade_definition_restartonerror" id="${ids.restartError}" deletable="false" movable="false">
                          <field name="RESTARTONERROR">TRUE</field>
                        </block>
                      </next>
                    </block>
                  </next>
                </block>
              </next>
            </block>
          </next>
        </block>
      </next>
    </block>
  </statement>

  <!-- ===== INITIALIZATION (variable defaults) ===== -->
  <statement name="INITIALIZATION">
    <block type="variables_set" id="${ids.setStake}">
      <field name="VAR" id="${ids.varIdStake}">Stake</field>
      <value name="VALUE">
        <block type="math_number" id="${ids.mathStake}">
          <field name="NUM">${stake}</field>
        </block>
      </value>
      <next>
        <block type="variables_set" id="${ids.setLoss}">
          <field name="VAR" id="${ids.varIdLoss}">Loss</field>
          <value name="VALUE">
            <block type="math_number" id="${ids.mathLoss}">
              <field name="NUM">${stopLoss > 0 ? stopLoss : 100}</field>
            </block>
          </value>
          <next>
            <block type="variables_set" id="${ids.setTarget}">
              <field name="VAR" id="${ids.varIdTarget}">Target Profit</field>
              <value name="VALUE">
                <block type="math_number" id="${ids.mathTarget}">
                  <field name="NUM">${takeProfit > 0 ? takeProfit : 50}</field>
                </block>
              </value>
              ${hasMartingale ? `
              <next>
                <block type="variables_set" id="${ids.setStake2}">
                  <field name="VAR" id="${ids.varIdStake2}">stake 2</field>
                  <value name="VALUE">
                    <block type="math_number" id="${ids.mathStake2}">
                      <field name="NUM">${stake2}</field>
                    </block>
                  </value>
                </block>
              </next>` : ""}
            </block>
          </next>
        </block>
      </next>
    </block>
  </statement>

  <!-- ===== TRADE OPTIONS ===== -->
  <statement name="SUBMARKET">
    <block type="trade_definition_tradeoptions" id="${ids.tradeOptions}">
      <mutation xmlns="http://www.w3.org/1999/xhtml" has_first_barrier="false" has_second_barrier="false" has_prediction="${["DIGITOVER", "DIGITUNDER", "DIGITMATCH", "DIGITDIFF"].includes(config.contract_type)}"></mutation>
      <field name="DURATIONTYPE_LIST">t</field>
      <value name="DURATION">
        <block type="math_number" id="${ids.durationBlock}">
          <field name="NUM">${durationTicks}</field>
        </block>
      </value>
      <value name="AMOUNT">
        <block type="variables_get" id="${ids.amountBlock}">
          <field name="VAR" id="${ids.varIdStake}">Stake</field>
        </block>
      </value>
      ${["DIGITOVER", "DIGITUNDER", "DIGITMATCH", "DIGITDIFF"].includes(config.contract_type) ? `
      <value name="PREDICTION">
        <shadow type="math_number_positive" id="${ids.predictionShadow}">
          <field name="NUM">${barrier}</field>
        </shadow>
      </value>` : ""}
    </block>
  </statement>
</block>

<!-- ===== BEFORE PURCHASE ===== -->
<block type="before_purchase" id="${ids.beforePurchase}" collapsed="true" x="0" y="968">
  <statement name="BEFOREPURCHASE_STACK">
    <block type="purchase" id="${ids.purchase}">
      <field name="PURCHASE_LIST">${esc(config.contract_type)}</field>
    </block>
  </statement>
</block>

<!-- ===== AFTER PURCHASE ===== -->
<block type="after_purchase" id="${ids.afterPurchase}" x="714" y="256">
  <statement name="AFTERPURCHASE_STACK">
    <block type="controls_if" id="${ids.ifCheck}">
      <mutation xmlns="http://www.w3.org/1999/xhtml" else="1"></mutation>
      <value name="IF0">
        <block type="contract_check_result" id="${ids.checkResult}">
          <field name="CHECK_RESULT">win</field>
        </block>
      </value>
      <statement name="DO0">
        <block type="trade_again" id="${ids.tradeAgainWin}"></block>
      </statement>
      <statement name="ELSE">
        <block type="trade_again" id="${ids.tradeAgainLose}"></block>
      </statement>
    </block>
  </statement>
</block>
</xml>`;

  return xml;
}

/** Trigger a browser download of the XML file */
export function downloadBotXml(config: BotConfig): void {
  const xml = exportToDerivBotXml(config);
  const blob = new Blob([xml], { type: "application/xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${config.name.replace(/[^a-zA-Z0-9_-]/g, "_")}.xml`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
