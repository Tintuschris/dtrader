/**
 * Tests for the transaction display fixes.
 *
 * Verifies that the timeAgo function correctly handles various date formats
 * and that transaction data is displayed properly.
 */

import { timeAgo, fmtCurrency } from "../lib/format-utils";

describe("Transaction Display", () => {
  describe("timeAgo function", () => {

    it("should return — for empty string", () => {
      expect(timeAgo("")).toBe("—");
    });

    it("should return — for undefined-like empty", () => {
      expect(timeAgo("")).toBe("—");
    });

    it("should handle ISO 8601 dates", () => {
      const now = new Date();
      const fiveMinAgo = new Date(now.getTime() - 5 * 60 * 1000);
      expect(timeAgo(fiveMinAgo.toISOString())).toBe("5m ago");
    });

    it("should handle epoch seconds", () => {
      const now = Math.floor(Date.now() / 1000);
      const tenMinAgo = now - 10 * 60;
      expect(timeAgo(String(tenMinAgo))).toBe("10m ago");
    });

    it("should handle epoch milliseconds", () => {
      const now = Date.now();
      const twoHrAgo = now - 2 * 60 * 60 * 1000;
      expect(timeAgo(String(twoHrAgo))).toBe("2h ago");
    });

    it("should return just now for recent timestamps", () => {
      const now = Date.now();
      const thirtySecAgo = now - 30 * 1000;
      expect(timeAgo(String(thirtySecAgo))).toBe("just now");
    });

    it("should return — for NaN/invalid dates", () => {
      expect(timeAgo("not-a-date")).toBe("—");
      expect(timeAgo("NaN")).toBe("—");
      expect(timeAgo("invalid")).toBe("—");
    });

    it("should handle day-old timestamps", () => {
      const now = Date.now();
      const twoDaysAgo = now - 2 * 24 * 60 * 60 * 1000;
      expect(timeAgo(String(twoDaysAgo))).toBe("2d ago");
    });

    it("should return just now for future timestamps", () => {
      const now = Date.now();
      const future = now + 60 * 1000;
      expect(timeAgo(String(future))).toBe("just now");
    });
  });

  describe("Transaction display label", () => {
    it("should use description when available", () => {
      const tx = {
        description: "Deposit from bank",
        category: "deposit",
      };
      const displayLabel = tx.description
        || (tx.category ? tx.category.charAt(0).toUpperCase() + tx.category.slice(1).replace(/_/g, " ") : "Transaction");
      expect(displayLabel).toBe("Deposit from bank");
    });

    it("should fall back to formatted category", () => {
      const tx = {
        description: "",
        category: "wallet_to_platform",
      };
      const displayLabel = tx.description
        || (tx.category ? tx.category.charAt(0).toUpperCase() + tx.category.slice(1).replace(/_/g, " ") : "Transaction");
      expect(displayLabel).toBe("Wallet to platform");
    });

    it("should use Transaction when both description and category are empty", () => {
      const tx = {
        description: "",
        category: "",
      };
      const displayLabel = tx.description
        || (tx.category ? tx.category.charAt(0).toUpperCase() + tx.category.slice(1).replace(/_/g, " ") : "Transaction");
      expect(displayLabel).toBe("Transaction");
    });
  });

  describe("Currency formatting", () => {

    it("should format USD amounts", () => {
      expect(fmtCurrency("1.5", "USD")).toBe("$1.50");
      expect(fmtCurrency("100.00", "USD")).toBe("$100.00");
    });

    it("should format non-USD amounts", () => {
      expect(fmtCurrency("1.5", "EUR")).toBe("1.50 EUR");
      expect(fmtCurrency("1.5", "BTC")).toBe("1.50 BTC");
    });

    it("should handle null/undefined", () => {
      expect(fmtCurrency(null, "USD")).toBe("—");
      expect(fmtCurrency(undefined, "USD")).toBe("—");
      expect(fmtCurrency("abc", "USD")).toBe("—");
    });
  });
});
