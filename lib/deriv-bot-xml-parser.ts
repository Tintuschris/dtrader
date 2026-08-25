import type { BotConfig, BotStrategy } from "../components/use-bot";

/* ------------------------------------------------------------------ */
/*  Deriv Bot XML (Blockly) Parser                                     */
/*                                                                      */
/*  Parses .xml files exported from dbot.deriv.com into our BotConfig.  */
/*  Extracts: market, symbol, contract type, stake, duration,          */
/*  prediction digit, and variable values (take profit, stop loss, etc.) */
/* ------------------------------------------------------------------ */

export type ParsedBot = {
  config: Partial<BotConfig>;
  variables: Record<string, number>;
  rawXml: string;
  xmlName: string;
  parseWarnings: string[];
};

type XmlElement = Element;

function getAttr(el: XmlElement | null, name: string): string {
  return el?.getAttribute(name) ?? "";
}

function getField(block: XmlElement, name: string): string {
  const field = block.querySelector(`field[name="${name}"]`);
  return field?.textContent?.trim() ?? "";
}

function getBlock(parent: XmlElement, type: string): XmlElement | null {
  return parent.querySelector(`block[type="${type}"]`);
}

function getBlocks(parent: XmlElement, type: string): XmlElement[] {
  return Array.from(parent.querySelectorAll(`block[type="${type}"]`));
}

function getBlockChain(parent: XmlElement, type: string): XmlElement[] {
  const chain: XmlElement[] = [];
  const first = getBlock(parent, type);
  if (!first) return chain;
  chain.push(first);
  let current: XmlElement | null = first;
  while (current) {
    const nextEl: XmlElement | null = current.querySelector(":scope > next > block");
    if (nextEl) chain.push(nextEl);
    current = nextEl;
  }
  return chain;
}

/** Extract a number value from a block's field or nested math_number */
function extractNumber(
  parent: XmlElement,
  valueName: string,
): number | null {
  const valueBlock = parent.querySelector(
    `value[name="${valueName}"] > block`,
  );
  if (!valueBlock) return null;

  // Direct math_number
  if (valueBlock.getAttribute("type") === "math_number") {
    const num = getField(valueBlock, "NUM");
    return num ? parseFloat(num) : null;
  }

  // Variable reference
  if (valueBlock.getAttribute("type") === "variables_get") {
    const varId = valueBlock.querySelector("field[name='VAR']")?.textContent;
    return varId ? null : null; // We resolve variables separately
  }

  // Shadow block
  const shadow = parent.querySelector(
    `value[name="${valueName}"] > shadow`,
  );
  if (shadow) {
    const num = getField(shadow, "NUM");
    return num ? parseFloat(num) : null;
  }

  return null;
}

/** Resolve variable values from INITIALIZATION block */
function resolveVariables(xml: XmlElement): Record<string, number> {
  const vars: Record<string, number> = {};
  const varDefs = xml.querySelectorAll("variables > variable");

  // Map variable IDs to names
  const varNames: Record<string, string> = {};
  varDefs.forEach((v) => {
    const id = v.getAttribute("id") ?? "";
    const name = v.textContent?.trim() ?? "";
    varNames[id] = name;
  });

  // Find initialization blocks
  const initBlocks = getBlocks(xml, "variables_set");
  initBlocks.forEach((block) => {
    const varField = block.querySelector("field[name='VAR']");
    const varId = varField?.getAttribute("id") ?? varField?.textContent ?? "";
    const name = varNames[varId] ?? varId;

    const numBlock = block.querySelector("value[name='VALUE'] > block");
    if (numBlock?.getAttribute("type") === "math_number") {
      const num = getField(numBlock, "NUM");
      if (num) vars[name] = parseFloat(num);
    }
  });

  return vars;
}

/** Map Deriv contract type to our strategy */
function inferStrategy(
  contractType: string,
  variables: Record<string, number>,
): BotStrategy {
  const hasLoss = variables["Loss"] !== undefined;
  const hasStake2 = variables["stake 2"] !== undefined;

  if (hasLoss && hasStake2) return "martingale";

  switch (contractType) {
    case "DIGITMATCH":
      return "digit_match";
    case "DIGITDIFF":
      return "digit_differs";
    case "DIGITEVEN":
    case "DIGITODD":
      return "even_odd";
    default:
      return "constant";
  }
}

/** Derive XML bot name from blocks or filename */
function deriveName(xml: XmlElement, filename: string): string {
  // Check for text_print blocks in INITIALIZATION for bot name
  const initBlocks = getBlocks(xml, "text_print");
  for (const block of initBlocks) {
    const text =
      block.querySelector("value[name='TEXT'] > shadow > field[name='TEXT']")
        ?.textContent ??
      block.querySelector("value[name='TEXT'] > block > field[name='TEXT']")
        ?.textContent ??
      "";
    if (text && text.length > 2 && text.length < 60) return text.trim();
  }

  // Check for text blocks with meaningful content
  const textBlocks = getBlocks(xml, "text");
  for (const block of textBlocks) {
    const text = getField(block, "TEXT");
    if (text && text.length > 2 && text.length < 60 && !text.startsWith(" ")) {
      return text.trim();
    }
  }

  // Fall back to filename
  return filename.replace(/\.xml$/i, "").replace(/[_-]/g, " ");
}

/** Convert DURATIONTYPE_LIST to duration_ticks */
function parseDuration(
  durationType: string,
  durationValue: number,
): { duration_ticks: number; duration_unit: string } {
  // Deriv uses: t=tick, s=second, m=minute, h=hour, d=day
  switch (durationType) {
    case "t":
      return { duration_ticks: Math.max(1, Math.round(durationValue)), duration_unit: "tick" };
    case "s":
      return { duration_ticks: Math.max(1, Math.round(durationValue)), duration_unit: "second" };
    case "m":
      return { duration_ticks: Math.max(1, Math.round(durationValue * 60)), duration_unit: "minute" };
    case "h":
      return { duration_ticks: Math.max(1, Math.round(durationValue * 3600)), duration_unit: "hour" };
    default:
      return { duration_ticks: Math.max(1, Math.round(durationValue)), duration_unit: "tick" };
  }
}

/* ------------------------------------------------------------------ */
/*  Main parser                                                        */
/* ------------------------------------------------------------------ */

export function parseDerivBotXml(xmlString: string, filename = "bot.xml"): ParsedBot {
  const warnings: string[] = [];
  const variables: Record<string, number> = {};

  // Parse XML
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "text/xml");

  // Check for parse errors
  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error(`Invalid XML: ${parseError.textContent?.slice(0, 200) ?? "unknown error"}`);
  }

  const xml = doc.documentElement;

  // Verify it's a Deriv Bot XML
  const isDbot = xml.getAttribute("is_dbot") === "true";
  if (!isDbot) {
    warnings.push("This XML may not be a Deriv Bot file (missing is_dbot attribute)");
  }

  // 1. Resolve variables from INITIALIZATION
  const initBlock = getBlock(xml, "trade_definition");
  if (initBlock) {
    const initStatement = initBlock.querySelector('statement[name="INITIALIZATION"]');
    if (initStatement) {
      Object.assign(variables, resolveVariables(initStatement));
    }
  }

  // 2. Parse trade definition
  const tradeDef = getBlock(xml, "trade_definition");
  let symbol = "1HZ100V";
  let marketCategory = "synthetic_index";
  let contractType = "DIGITOVER";
  let durationType = "t";
  let durationValue = 5;
  let stake = 5;
  let prediction = 5;
  let candleInterval = "60";

  if (tradeDef) {
    // Market
    const marketBlock = tradeDef.querySelector('block[type="trade_definition_market"]');
    if (marketBlock) {
      symbol = getField(marketBlock, "SYMBOL_LIST") || symbol;
      marketCategory = getField(marketBlock, "MARKET_LIST") || marketCategory;
    }

    // Contract type
    const ctBlock = tradeDef.querySelector('block[type="trade_definition_contracttype"]');
    if (ctBlock) {
      contractType = getField(ctBlock, "TYPE_LIST") || contractType;
    }

    // Candle interval
    const ciBlock = tradeDef.querySelector('block[type="trade_definition_candleinterval"]');
    if (ciBlock) {
      candleInterval = getField(ciBlock, "CANDLEINTERVAL_LIST") || candleInterval;
    }
  }

  // 3. Parse trade options (SUBMARKET statement)
  if (tradeDef) {
    const submarketStatement = tradeDef.querySelector('statement[name="SUBMARKET"]');
    if (submarketStatement) {
      const tradeOpts = submarketStatement.querySelector(
        'block[type="trade_definition_tradeoptions"]',
      );
      if (tradeOpts) {
        durationType = getField(tradeOpts, "DURATIONTYPE_LIST") || durationType;

        // Duration value
        const durVal = extractNumber(tradeOpts, "DURATION");
        if (durVal !== null) durationValue = durVal;

        // Amount/stake
        const amtBlock = tradeOpts.querySelector("value[name='AMOUNT'] > block");
        if (amtBlock?.getAttribute("type") === "math_number") {
          const amt = getField(amtBlock, "NUM");
          if (amt) stake = parseFloat(amt);
        } else if (amtBlock?.getAttribute("type") === "variables_get") {
          // Stake from variable
          const varName =
            amtBlock.querySelector("field[name='VAR']")?.textContent?.trim() ?? "";
          if (varName && variables[varName] !== undefined) {
            stake = variables[varName];
          }
        }

        // Prediction digit
        const predBlock = tradeOpts.querySelector("value[name='PREDICTION']");
        if (predBlock) {
          const shadowNum = predBlock.querySelector("shadow > field[name='NUM']");
          const directNum = predBlock.querySelector("block > field[name='NUM']");
          const predStr =
            shadowNum?.textContent?.trim() ?? directNum?.textContent?.trim();
          if (predStr) prediction = parseInt(predStr, 10);
        }
      }
    }
  }

  // 4. Parse before_purchase for actual purchase type
  let purchaseType = contractType;
  const beforePurchase = getBlock(xml, "before_purchase");
  if (beforePurchase) {
    const purchaseBlock = beforePurchase.querySelector('block[type="purchase"]');
    if (purchaseBlock) {
      purchaseType = getField(purchaseBlock, "PURCHASE_LIST") || contractType;
    }
  }

  // 5. Parse after_purchase for take profit / stop loss hints
  const afterPurchase = getBlock(xml, "after_purchase");
  let takeProfit: number | undefined;
  let stopLoss: number | undefined;

  if (afterPurchase) {
    // Look for total_profit comparisons with variables
    const logicBlocks = afterPurchase.querySelectorAll('block[type="logic_compare"]');
    logicBlocks.forEach((logic) => {
      const op = getField(logic, "OP");
      const totalProfitBlock = logic.querySelector(
        'value[name="A"] > block[type="total_profit"]',
      );
      const varBlock = logic.querySelector(
        'value[name="B"] > block[type="variables_get"]',
      );
      if (totalProfitBlock && varBlock) {
        const varName =
          varBlock.querySelector("field[name='VAR']")?.textContent?.trim() ?? "";
        const val = variables[varName];
        if (val !== undefined) {
          if (op === "LT" || op === "LTE") {
            // total_profit < var → this is take profit check
            takeProfit = val;
          } else if (op === "GT" || op === "GTE") {
            // Could be stop loss
            stopLoss = val;
          }
        }
      }
    });
  }

  // 6. Detect strategy
  const strategy = inferStrategy(purchaseType, variables);

  // 7. Build warnings
  if (!symbol || symbol === "UNKNOWN") {
    warnings.push("Could not determine market symbol — using default 1HZ100V");
    symbol = "1HZ100V";
  }
  if (stake <= 0) {
    warnings.push("Stake was 0 or negative — using default $5");
    stake = 5;
  }

  const { duration_ticks } = parseDuration(durationType, durationValue);

  const name = deriveName(xml, filename);

  const config: Partial<BotConfig> = {
    name,
    strategy,
    symbol,
    contract_type: purchaseType || contractType,
    stake,
    currency: "USD",
    duration_ticks,
    barrier: prediction >= 0 && prediction <= 9 ? String(prediction) : undefined,
    take_profit: takeProfit,
    stop_loss: stopLoss,
    max_trades: 50,
    martingale_multiplier: strategy === "martingale" ? 2 : undefined,
    dryRun: false,
  };

  return {
    config,
    variables,
    rawXml: xmlString,
    xmlName: name,
    parseWarnings: warnings,
  };
}
