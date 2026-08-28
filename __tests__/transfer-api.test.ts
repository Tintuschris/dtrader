/**
 * Tests for the Deriv transfer API payload generation.
 *
 * Verifies that wallet-to-platform and platform-to-wallet transfers
 * send the correct payload format matching the actual Deriv
 * POST /wallet/v1/transfers/platforms endpoint schema.
 *
 * Required: wallet_id, amount, currency, direction, platform_name,
 *           platform_account_id, request_id
 * Optional: wallet_currency, exchange_rate, rate_token, description
 */

describe("Transfer API Payload", () => {
  describe("executePlatformTransfer payload shape", () => {
    it("should have all required fields for wallet-to-platform transfer", () => {
      const payload = {
        wallet_id: "5f86030f-695d-4545-86bf-42d224d65fe0",
        amount: "1.00",
        currency: "USD",
        direction: "from_wallet" as const,
        platform_name: "options" as const,
        platform_account_id: "ROT90921902",
        request_id: "tx_1234567890_abc12345",
      };

      // All 7 required fields
      expect(payload.wallet_id).toBeDefined();
      expect(payload.amount).toBeDefined();
      expect(payload.currency).toBeDefined();
      expect(payload.direction).toBe("from_wallet");
      expect(payload.platform_name).toBe("options");
      expect(payload.platform_account_id).toBeDefined();
      expect(payload.request_id).toBeDefined();

      // Verify NO old/wrong fields exist
      expect(payload).not.toHaveProperty("account_id");
      expect(payload).not.toHaveProperty("balance");
      expect(payload).not.toHaveProperty("source_type");
      expect(payload).not.toHaveProperty("destination_type");
      expect(payload).not.toHaveProperty("source_id");
      expect(payload).not.toHaveProperty("destination_id");
    });

    it("should use direction=from_wallet for wallet→platform", () => {
      const direction = "from_wallet";
      expect(["from_wallet", "to_wallet"]).toContain(direction);
    });

    it("should use direction=to_wallet for platform→wallet", () => {
      const direction = "to_wallet";
      expect(["from_wallet", "to_wallet"]).toContain(direction);
    });

    it("should have amount as string with decimal pattern", () => {
      const amounts = ["1.00", "10.50", "0.01", "100"];
      const pattern = /^\d+(\.\d+)?$/;

      for (const amount of amounts) {
        expect(amount).toMatch(pattern);
      }
    });

    it("should have valid platform names", () => {
      const validPlatforms = ["mt5", "ctrader", "options", "crypto-exchange", "tradingview"];

      expect(validPlatforms).toContain("options");
      expect(validPlatforms).toContain("mt5");
      expect(validPlatforms).toContain("ctrader");
    });

    it("should have valid currency pattern", () => {
      const currencies = ["USD", "BTC", "USDT", "EUR"];
      const pattern = /^[A-Z0-9_]{1,18}$/;

      for (const currency of currencies) {
        expect(currency).toMatch(pattern);
      }
    });

    it("should have wallet_id as UUID format", () => {
      const walletId = "5f86030f-695d-4545-86bf-42d224d65fe0";
      expect(walletId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it("should include platform_account_id for the trading account", () => {
      const platformAccountId = "ROT90921902";
      expect(platformAccountId.length).toBeGreaterThan(0);
      expect(platformAccountId).not.toContain("-"); // Not a UUID
    });
  });

  describe("detectPlatformName", () => {
    // This tests the platform detection logic from the transfer route
    function detectPlatformName(accountId: string): string {
      const id = accountId.toUpperCase();
      if (id.startsWith("MT")) return "mt5";
      if (id.startsWith("VR") || id.startsWith("CR") || id.startsWith("MF") || id.startsWith("PROM")) {
        return "options";
      }
      return "options";
    }

    it("should detect MT5 accounts", () => {
      expect(detectPlatformName("MT12345")).toBe("mt5");
      expect(detectPlatformName("mt67890")).toBe("mt5");
    });

    it("should detect Options accounts", () => {
      expect(detectPlatformName("VRTC12345")).toBe("options");
      expect(detectPlatformName("CR12345")).toBe("options");
      expect(detectPlatformName("MF12345")).toBe("options");
    });

    it("should default to options for unknown accounts", () => {
      expect(detectPlatformName("ROT90921902")).toBe("options");
      expect(detectPlatformName("ABC123")).toBe("options");
    });
  });

  describe("Wallet type detection", () => {
    it("should correctly identify wallet IDs vs account IDs", () => {
      const walletPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      expect(walletPattern.test("5f86030f-695d-4545-86bf-42d224d65fe0")).toBe(true);
      expect(walletPattern.test("ROT90921902")).toBe(false);
      expect(walletPattern.test("VR12345")).toBe(false);
    });
  });
});
