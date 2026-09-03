/**
 * Tests for the market scanner (lib/market-scanner.ts).
 *
 * The scanner's whole point is EXACT math against the user's rules:
 *   UNDER 8 → digits 8 and 9 each STRICTLY below 10% of the window
 *   OVER 1  → digits 0 and 1 each STRICTLY below 10% of the window
 * These tests pin the boundary semantics (exactly 10% must NOT qualify),
 * the windowing, and the exact count/frequency arithmetic.
 */

import {
  lastDigitOf,
  classifyDigits,
  rankSuggestions,
  DigitWindow,
  SCANNER_MAX_LOOKBACK,
  SCANNER_DEFAULT_LOOKBACK,
  advanceSignalLedger,
  simulateRuleHits,
  type SignalTracks,
  type MarketSignal,
} from "../lib/market-scanner";

/* ------------------------------------------------------------------ */
/*  Digit extraction                                                   */
/* ------------------------------------------------------------------ */

describe("lastDigitOf", () => {
  it("extracts the last digit of a 2-decimal quote", () => {
    expect(lastDigitOf(1234.56)).toBe(6);
    // 1234.5 is displayed as 1234.50 → its last digit is 0
    expect(lastDigitOf(1234.5)).toBe(0);
    expect(lastDigitOf(644.52)).toBe(2);
    expect(lastDigitOf(0.0)).toBe(0);
  });

  it("extracts from a numeric string exactly as Deriv displays it", () => {
    expect(lastDigitOf("1234.56")).toBe(6);
    expect(lastDigitOf("644.50")).toBe(0);
    expect(lastDigitOf("9.99")).toBe(9);
  });

  it("honours pip size when provided", () => {
    expect(lastDigitOf(1234.5678, 3)).toBe(8); // last of ...5678 → 8? .toFixed(3) = "1234.568" → 8
    expect(lastDigitOf(1.5, 1)).toBe(5);
    expect(lastDigitOf(1.05, 2)).toBe(5);
  });
});

/* ------------------------------------------------------------------ */
/*  Exact statistics and windowing                                     */
/* ------------------------------------------------------------------ */

/** Build a synthetic digit sequence with a chosen distribution over a length. */
function sequence(
  length: number,
  counts: Partial<Record<number, number>>,
): number[] {
  const out: number[] = [];
  for (let d = 0; d <= 9; d++) {
    const c = counts[d] ?? 0;
    for (let i = 0; i < c; i++) out.push(d);
  }
  while (out.length < length) {
    // Fill the remainder with digits that never violate the pattern under test
    out.push(5);
  }
  return out.slice(0, length);
}

describe("classifyDigits — exact frequency math", () => {
  it("computes exact counts and frequencies from the window", () => {
    const seq = sequence(100, { 8: 9, 9: 8 });
    // 83 filler digits of 5 → 5 appears 83 times
    const r = classifyDigits(seq, 100);
    expect(r.ticks).toBe(100);
    expect(r.digits[8]).toEqual({ digit: 8, count: 9, freq: 9 });
    expect(r.digits[9]).toEqual({ digit: 9, count: 8, freq: 8 });
    expect(r.digits[5]).toEqual({ digit: 5, count: 83, freq: 83 });
    const totalCount = r.digits.reduce((s, d) => s + d.count, 0);
    expect(totalCount).toBe(100);
    const totalFreq = r.digits.reduce((s, d) => s + d.freq, 0);
    expect(Math.round(totalFreq * 1e9) / 1e9).toBe(100);
  });

  it("uses only the most recent `lookback` ticks", () => {
    // 300 ticks: the first 200 contain many 8s, the last 100 contain none.
    const tail = sequence(100, {});
    const head = sequence(200, { 8: 60, 9: 60 });
    const r = classifyDigits([...head, ...tail], 100);
    expect(r.ticks).toBe(100);
    expect(r.digits[8].count).toBe(0);
    expect(r.digits[9].count).toBe(0);
  });

  it("returns zeroed stats for an empty window (no false signals)", () => {
    const r = classifyDigits([], SCANNER_DEFAULT_LOOKBACK);
    expect(r.ticks).toBe(0);
    expect(r.under8).toBe(false);
    expect(r.over1).toBe(false);
    expect(r.digits.every((d) => d.count === 0 && d.freq === 0)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/*  The two rules — boundary semantics                                 */
/* ------------------------------------------------------------------ */

describe("UNDER 8 rule", () => {
  it("qualifies when 8 and 9 are each strictly below 10%", () => {
    const r = classifyDigits(sequence(100, { 8: 9, 9: 8 }), 100);
    expect(r.under8).toBe(true);
    expect(r.under8Freq).toEqual({ d8: 9, d9: 8 });
  });

  it("does NOT qualify when digit 8 is exactly 10%", () => {
    const r = classifyDigits(sequence(100, { 8: 10, 9: 9 }), 100);
    expect(r.under8Freq.d8).toBe(10);
    expect(r.under8).toBe(false); // strictly below — 10% is NOT enough
  });

  it("does NOT qualify when digit 9 is exactly 10%", () => {
    const r = classifyDigits(sequence(100, { 8: 9, 9: 10 }), 100);
    expect(r.under8Freq.d9).toBe(10);
    expect(r.under8).toBe(false);
  });

  it("does NOT qualify when only one danger digit is below 10%", () => {
    const r = classifyDigits(sequence(100, { 8: 9, 9: 17 }), 100);
    expect(r.under8).toBe(false);
  });

  it("qualifies at a non-100 window size with exact halves", () => {
    // 9.5% on both danger digits over a 200-tick window → qualifies
    const r = classifyDigits(sequence(200, { 8: 19, 9: 19 }), 200);
    expect(r.under8Freq.d8).toBe(9.5);
    expect(r.under8Freq.d9).toBe(9.5);
    expect(r.under8).toBe(true);
    // ...and exactly 10% (20/200) still fails
    const r2 = classifyDigits(sequence(200, { 8: 20, 9: 19 }), 200);
    expect(r2.under8Freq.d8).toBe(10);
    expect(r2.under8).toBe(false);
  });
});

describe("OVER 1 rule", () => {
  it("qualifies when 0 and 1 are each strictly below 10%", () => {
    const r = classifyDigits(sequence(100, { 0: 9, 1: 7 }), 100);
    expect(r.over1).toBe(true);
    expect(r.over1Freq).toEqual({ d0: 9, d1: 7 });
  });

  it("does NOT qualify when digit 0 is exactly 10%", () => {
    const r = classifyDigits(sequence(100, { 0: 10, 1: 9 }), 100);
    expect(r.over1Freq.d0).toBe(10);
    expect(r.over1).toBe(false);
  });

  it("does NOT qualify when digit 1 is exactly 10%", () => {
    const r = classifyDigits(sequence(100, { 0: 9, 1: 10 }), 100);
    expect(r.over1Freq.d1).toBe(10);
    expect(r.over1).toBe(false);
  });

  it("does NOT qualify when only one danger digit is below 10%", () => {
    const r = classifyDigits(sequence(100, { 0: 9, 1: 14 }), 100);
    expect(r.over1).toBe(false);
  });
});

describe("custom danger-digit thresholds", () => {
  it("uses the selected stricter threshold for both rules", () => {
    const seq = sequence(100, { 8: 7, 9: 7, 0: 7, 1: 7 });
    expect(classifyDigits(seq, 100, 8).under8).toBe(true);
    expect(classifyDigits(seq, 100, 8).over1).toBe(true);
    expect(classifyDigits(seq, 100, 5).under8).toBe(false);
    expect(classifyDigits(seq, 100, 5).over1).toBe(false);
  });
});

describe("rules can both fire on the same market", () => {
  it("returns two suggestions when both conditions hold", () => {
    // digits 0,1,8,9 all cold → both UNDER 8 and OVER 1 qualify
    const seq = sequence(100, { 0: 8, 1: 8, 8: 8, 9: 8 });
    const signal = {
      ...classifyDigits(seq, 100),
      symbol: "1HZ100V",
      name: "Volatility 100 (1s)",
      lastQuote: 1000.55,
      pipSize: 2,
      updatedAt: Date.now(),
    } as MarketSignal;
    expect(signal.under8).toBe(true);
    expect(signal.over1).toBe(true);
    const ranked = rankSuggestions([signal]);
    expect(ranked).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ */
/*  Suggestion ranking                                                 */
/* ------------------------------------------------------------------ */

function signalOf(symbol: string, overrides: {
  under8?: boolean; under8Freq?: { d8: number; d9: number };
  over1?: boolean; over1Freq?: { d0: number; d1: number };
} = {}): MarketSignal {
  const d = classifyDigits([], 100);
  return {
    ...d,
    symbol,
    name: symbol,
    lastQuote: null,
    pipSize: 2,
    updatedAt: 0,
    under8: overrides.under8 ?? false,
    under8Freq: overrides.under8Freq ?? { d8: 5, d9: 5 },
    over1: overrides.over1 ?? false,
    over1Freq: overrides.over1Freq ?? { d0: 5, d1: 5 },
  } as MarketSignal;
}

describe("rankSuggestions", () => {
  it("ranks strongest (furthest below 10%) first", () => {
    const weak = signalOf("1HZ50V", { under8: true, under8Freq: { d8: 9.9, d9: 9.9 } });
    const strong = signalOf("1HZ100V", { under8: true, under8Freq: { d8: 5.5, d9: 6.0 } });
    const ranked = rankSuggestions([weak, strong]);
    expect(ranked[0].symbol).toBe("1HZ100V");
    expect(ranked[0].strength).toBeCloseTo(4, 9); // min(10-5.5, 10-6) = 4
    expect(ranked[1].strength).toBeCloseTo(0.1, 9);
  });

  it("skips markets with no qualifying signal", () => {
    const none = signalOf("1HZ10V");
    expect(rankSuggestions([none])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  DigitWindow buffer                                                 */
/* ------------------------------------------------------------------ */

describe("DigitWindow", () => {
  it("stores only valid digits and trims to SCANNER_MAX_LOOKBACK", () => {
    const w = new DigitWindow();
    const quotes: number[] = [];
    for (let i = 0; i < SCANNER_MAX_LOOKBACK + 25; i++) {
      quotes.push(1000 + i / 100);
    }
    w.seed(quotes);
    expect(w.length).toBe(SCANNER_MAX_LOOKBACK);
    expect(w.lastDigit).toBe(lastDigitOf(1000 + (SCANNER_MAX_LOOKBACK + 24) / 100));
  });

  it("tracks the last quote and pip size from the feed", () => {
    const w = new DigitWindow();
    w.push(1234.56, 2);
    expect(w.lastQuoteValue).toBe(1234.56);
    expect(w.lastDigit).toBe(6);
    w.push("644.52");
    expect(w.lastDigit).toBe(2);
    w.push(9.9, 2); // 9.90 → 0
    expect(w.lastDigit).toBe(0);
  });

  it("recent() returns the last n digits in order", () => {
    const w = new DigitWindow();
    w.seed([1.01, 1.02, 1.03, 1.04, 1.05]);
    expect(w.recent(2)).toEqual([4, 5]);
    expect(w.recent(10)).toEqual([1, 2, 3, 4, 5]);
  });

  it("clear() empties the buffer", () => {
    const w = new DigitWindow();
    w.seed([1.01, 1.02]);
    w.clear();
    expect(w.length).toBe(0);
    expect(w.lastDigit).toBeNull();
  });
});

describe("signal ledger settle semantics", () => {
  it("settles UNDER 8 on the following tick", () => {
    const ledger: SignalTracks = new Map();
    advanceSignalLedger(5, { under8: true, over1: false }, ledger, "M", 1);
    advanceSignalLedger(8, { under8: false, over1: false }, ledger, "M", 2);
    advanceSignalLedger(9, { under8: true, over1: false }, ledger, "M", 3);
    advanceSignalLedger(7, { under8: false, over1: false }, ledger, "M", 4);
    const track = ledger.get("M")?.get("under8");
    expect(track?.bets).toBe(2);
    expect(track?.wins).toBe(1);
    expect(track?.recent.map((r) => r.win)).toEqual([false, true]);
  });

  it("settles OVER 1 on the following tick", () => {
    const ledger: SignalTracks = new Map();
    advanceSignalLedger(5, { under8: false, over1: true }, ledger, "M", 1);
    advanceSignalLedger(1, { under8: false, over1: false }, ledger, "M", 2);
    advanceSignalLedger(0, { under8: false, over1: true }, ledger, "M", 3);
    advanceSignalLedger(2, { under8: false, over1: false }, ledger, "M", 4);
    const track = ledger.get("M")?.get("over1");
    expect(track?.bets).toBe(2);
    expect(track?.wins).toBe(1);
    expect(track?.recent.map((r) => r.win)).toEqual([false, true]);
  });

  it("matches incremental tracking for a full stream", () => {
    const digits = Array.from({ length: 300 }, (_, i) => (i * 7 + 3) % 10);
    const incremental: SignalTracks = new Map();
    const history: number[] = [];
    for (const digit of digits) {
      history.push(digit);
      const result = classifyDigits(history.slice(-50), 50);
      advanceSignalLedger(digit, result, incremental, "M", history.length);
    }
    const batch = simulateRuleHits(digits, 50);
    for (const rule of ["under8", "over1"] as const) {
      expect(incremental.get("M")?.get(rule)?.bets).toBe(batch.get(rule)?.bets);
      expect(incremental.get("M")?.get(rule)?.wins).toBe(batch.get(rule)?.wins);
      expect(incremental.get("M")?.get(rule)?.recent.map(({ symbol: _symbol, ...result }) => result))
        .toEqual(batch.get(rule)?.recent.map(({ symbol: _symbol, ...result }) => result));
    }
  });

  it("handles no qualifying ticks, all qualifying ticks, and caps recent results", () => {
    const none = simulateRuleHits([8, 9, 8, 9, 8], 5);
    expect(none.get("under8")?.bets ?? 0).toBe(0);

    const all = simulateRuleHits(Array.from({ length: 40 }, () => 5), 10);
    expect(all.get("under8")?.bets).toBe(39);
    expect(all.get("under8")?.wins).toBe(39);
    expect(all.get("under8")?.recent).toHaveLength(30);
    expect(simulateRuleHits([], 10)).toEqual(new Map());
  });
});
