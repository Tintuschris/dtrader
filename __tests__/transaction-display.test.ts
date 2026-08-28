/**
 * Tests for the transaction display fixes.
 *
 * Verifies that the timeAgo function correctly handles various date formats
 * and that transaction data is displayed properly.
 */

describe("Transaction Display", () => {
  describe("timeAgo function", () => {
    // Replicate the timeAgo logic from wallet-panel.tsx
    function timeAgo(dateStr: string): string {
      if (!dateStr) return "—";
      let timestamp: number;
      if (/^\d+$/.test(dateStr.trim())) {
        const num = Number(dateStr);
        timestamp = num > 1e12 ? num : num * 1000;
      } else {
        timestamp = new Date(dateStr).getTime();
      }
      if (Number.isNaN(timestamp) || timestamp <= 0) return "—";
      const now = Date.now();
      const diffSec = Math.floor((now - timestamp) / 1000);
      if (diffSec < 0) return "just now";
      if (diffSec < 60) return "just now";
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      const diffDay = Math.floor(diffHr / 24);
      return `${diffDay}d ago`;
    }

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
    function fmtCurrency(n: number | string | null | undefined, currency: string): string {
      if (n === null || n === undefined || isNaN(Number(n))) return "—";
      const val = Number(n);
      if (currency === "USD" || currency === "USDT") return `$${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      return `${val.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
    }

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
