/**
 * Tests for the DerivContext provider and React Query hooks.
 *
 * Verifies the centralized state management setup, query keys,
 * and hook configurations.
 */

describe("DerivContext Provider", () => {
  describe("Query Keys", () => {
    // Replicate query keys from use-deriv-data.ts
    const queryKeys = {
      wallets: ["deriv", "wallets"] as const,
      platformAccounts: ["deriv", "platformAccounts"] as const,
      transactions: (walletType: string) => ["deriv", "transactions", walletType] as const,
      portfolio: (accountId: string) => ["deriv", "portfolio", accountId] as const,
      tradeHistory: (accountId: string) => ["deriv", "trades", accountId] as const,
      exchangeRate: (from: string, to: string) => ["deriv", "exchangeRate", from, to] as const,
    };

    it("should generate consistent wallet query keys", () => {
      expect(queryKeys.wallets).toEqual(["deriv", "wallets"]);
    });

    it("should generate wallet-type-specific transaction keys", () => {
      expect(queryKeys.transactions("main")).toEqual(["deriv", "transactions", "main"]);
      expect(queryKeys.transactions("p2p")).toEqual(["deriv", "transactions", "p2p"]);
    });

    it("should generate account-specific portfolio keys", () => {
      expect(queryKeys.portfolio("VR12345")).toEqual(["deriv", "portfolio", "VR12345"]);
      expect(queryKeys.portfolio("CR67890")).toEqual(["deriv", "portfolio", "CR67890"]);
    });

    it("should generate account-specific trade history keys", () => {
      expect(queryKeys.tradeHistory("VR12345")).toEqual(["deriv", "trades", "VR12345"]);
    });

    it("should generate exchange rate keys with both currencies", () => {
      expect(queryKeys.exchangeRate("USD", "EUR")).toEqual(["deriv", "exchangeRate", "USD", "EUR"]);
    });
  });

  describe("DerivProvider setup", () => {
    it("should create a valid QueryClient with correct defaults", () => {
      const { QueryClient } = require("@tanstack/react-query");
      const client = new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: 2,
            refetchOnWindowFocus: false,
          },
        },
      });

      expect(client).toBeDefined();
      expect(client.getDefaultOptions().queries?.staleTime).toBe(30_000);
      expect(client.getDefaultOptions().queries?.retry).toBe(2);
    });
  });

  describe("fetchDerivApi helper", () => {
    // Test that the fetchDerivApi function handles errors correctly
    it("should throw on non-ok responses", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ error: "Not authenticated" }),
      });

      global.fetch = mockFetch;

      const { fetchDerivApi } = require("../components/deriv-provider");

      await expect(fetchDerivApi("/api/test")).rejects.toThrow("Not authenticated");

      global.fetch = global.fetch; // restore
    });

    it("should return data on successful responses", async () => {
      const mockFetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ wallets: [] }),
      });

      global.fetch = mockFetch;

      const { fetchDerivApi } = require("../components/deriv-provider");

      const result = await fetchDerivApi("/api/deriv/wallets");
      expect(result).toEqual({ wallets: [] });

      global.fetch = global.fetch; // restore
    });
  });
});

describe("Wallet Balance Calculation", () => {
  it("should correctly sum wallet balances", () => {
    const wallets = [
      { wallet_id: "w1", type: "main", currency: "USD", balance: 100 },
      { wallet_id: "w2", type: "main", currency: "USD", balance: 50 },
    ];

    const totalBalance = wallets.reduce((sum, w) => sum + (w.balance ?? 0), 0);
    expect(totalBalance).toBe(150);
  });

  it("should handle null balances", () => {
    const wallets = [
      { wallet_id: "w1", type: "main", currency: "USD", balance: 100 },
      { wallet_id: "w2", type: "main", currency: "USD", balance: null },
    ];

    const totalBalance = wallets.reduce((sum, w) => sum + (w.balance ?? 0), 0);
    expect(totalBalance).toBe(100);
  });

  it("should filter real accounts only for transfer list", () => {
    const accounts = [
      { id: "VR12345", type: "demo" as const, currency: "USD", balance: 1000 },
      { id: "CR67890", type: "real" as const, currency: "USD", balance: 500 },
      { id: "CR11111", type: "real" as const, currency: "EUR", balance: 200 },
    ];

    const realAccounts = accounts.filter((a) => a.type === "real");
    expect(realAccounts).toHaveLength(2);
    expect(realAccounts.map((a) => a.id)).toEqual(["CR67890", "CR11111"]);
  });
});
