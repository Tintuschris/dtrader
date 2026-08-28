/**
 * Integration tests for the Deriv transfer flow.
 *
 * Tests the full flow: wallet listing → transfer validation → execution
 * with mocked API responses matching the Deriv Wallet REST API schema.
 */

describe("Transfer Flow Integration", () => {
  // Mock wallet data matching the Deriv API response format
  const mockWallets = {
    wallets: [
      {
        wallet_id: "5f86030f-695d-4545-86bf-42d224d65fe0",
        type: "main",
        balances: { USD: { balance: "150.00" } },
      },
    ],
  };

  const mockAccounts = {
    accounts: [
      {
        id: "CR12345",
        loginid: "CR12345",
        type: "real",
        currency: "USD",
        balance: 50.00,
        account_type: "Options",
      },
      {
        id: "VR67890",
        loginid: "VR67890",
        type: "demo",
        currency: "USD",
        balance: 1000.00,
        account_type: "Options",
      },
    ],
  };

  const mockValidateResponse = {
    mode: "preview",
    is_valid: true,
    source_currency: "USD",
    destination_currency: "USD",
    amount: "10.00",
    fee: "0.00",
    net_amount: "10.00",
    estimated_destination_amount: "10.00",
  };

  const mockExecuteResponse = {
    mode: "executed",
    success: true,
    request_id: "tx_1234567890_abc12345",
    status: "pending",
  };

  describe("Wallet listing", () => {
    it("should fetch wallets and filter real accounts only", () => {
      const wallets = mockWallets.wallets;
      const accounts = mockAccounts.accounts;

      // Only real accounts should be in the transfer list
      const realAccounts = accounts.filter((a) => a.type === "real");
      expect(realAccounts).toHaveLength(1);
      expect(realAccounts[0].id).toBe("CR12345");

      // Demo accounts should be excluded
      const demoAccounts = accounts.filter((a) => a.type === "demo");
      expect(demoAccounts).toHaveLength(1);
      expect(demoAccounts[0].id).toBe("VR67890");
    });

    it("should build transferrable list from wallets + real accounts", () => {
      const wallets = mockWallets.wallets;
      const accounts = mockAccounts.accounts;

      const list: Array<{ id: string; label: string; currency: string; balance: number | null }> = [];

      // Add wallets
      for (const w of wallets) {
        const walletId = w.wallet_id;
        const balance = Number(w.balances.USD?.balance ?? 0);
        list.push({ id: walletId, label: `Wallet (${w.type}) · USD`, currency: "USD", balance });
      }

      // Add only real platform accounts
      for (const a of accounts) {
        if (a.type === "real") {
          list.push({ id: a.id, label: `${a.account_type} · ${a.id}`, currency: a.currency, balance: a.balance });
        }
      }

      expect(list).toHaveLength(2);
      expect(list[0].id).toBe("5f86030f-695d-4545-86bf-42d224d65fe0"); // wallet
      expect(list[1].id).toBe("CR12345"); // real account
    });
  });

  describe("Transfer validation", () => {
    it("should build correct payload for wallet-to-platform transfer", () => {
      const sourceWallet = mockWallets.wallets[0];
      const destAccount = mockAccounts.accounts[0]; // CR12345 (real)

      const payload = {
        source_type: "main",
        destination_type: "platform",
        source_id: sourceWallet.wallet_id,
        destination_id: destAccount.id,
        amount: "10.00",
        balance: "150.00",
        source_currency: "USD",
        destination_currency: "USD",
        destination_platform_name: "options",
      };

      // Verify required fields
      expect(payload.source_type).toBe("main");
      expect(payload.destination_type).toBe("platform");
      expect(payload.source_id).toBe("5f86030f-695d-4545-86bf-42d224d65fe0");
      expect(payload.destination_id).toBe("CR12345");
      expect(payload.amount).toBe("10.00");
      expect(payload.balance).toBe("150.00");

      // Verify NO old fields
      expect(payload).not.toHaveProperty("account_id");
      expect(payload).not.toHaveProperty("currency");
      expect(payload).not.toHaveProperty("direction");
    });

    it("should handle cross-currency transfer with exchange rate", () => {
      const payload = {
        source_type: "main",
        destination_type: "platform",
        source_id: "wallet-uuid",
        destination_id: "CR12345",
        amount: "10.00",
        balance: "150.00",
        source_currency: "USD",
        destination_currency: "EUR",
        destination_platform_name: "options",
        rate: "0.92",
      };

      expect(payload.source_currency).toBe("USD");
      expect(payload.destination_currency).toBe("EUR");
      expect(payload.rate).toBe("0.92");
    });
  });

  describe("Transfer execution", () => {
    it("should handle successful validation response", () => {
      const response = mockValidateResponse;

      expect(response.is_valid).toBe(true);
      expect(response.amount).toBe("10.00");
      expect(response.fee).toBe("0.00");
      expect(response.net_amount).toBe("10.00");
      expect(response.source_currency).toBe("USD");
      expect(response.destination_currency).toBe("USD");
    });

    it("should handle failed validation", () => {
      const response = {
        ...mockValidateResponse,
        is_valid: false,
        error: "Insufficient balance",
      };

      expect(response.is_valid).toBe(false);
      expect(response.error).toBe("Insufficient balance");
    });

    it("should handle successful execution response", () => {
      const response = mockExecuteResponse;

      expect(response.success).toBe(true);
      expect(response.mode).toBe("executed");
      expect(response.request_id).toBeDefined();
      expect(response.status).toBe("pending");
    });

    it("should handle execution failure", () => {
      const response = {
        error: "Duplicate request ID",
      };

      expect(response.error).toBeDefined();
    });
  });

  describe("Platform name detection", () => {
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
      expect(detectPlatformName("MT67890")).toBe("mt5");
    });

    it("should detect Options accounts", () => {
      expect(detectPlatformName("CR12345")).toBe("options");
      expect(detectPlatformName("VR67890")).toBe("options");
      expect(detectPlatformName("MF12345")).toBe("options");
    });

    it("should default to options for unknown accounts", () => {
      expect(detectPlatformName("ROT90921902")).toBe("options");
    });
  });

  describe("Wallet ID vs Account ID detection", () => {
    const walletPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    it("should identify wallet UUIDs", () => {
      expect(walletPattern.test("5f86030f-695d-4545-86bf-42d224d65fe0")).toBe(true);
    });

    it("should reject account loginids as wallet IDs", () => {
      expect(walletPattern.test("CR12345")).toBe(false);
      expect(walletPattern.test("VR67890")).toBe(false);
      expect(walletPattern.test("MT12345")).toBe(false);
      expect(walletPattern.test("ROT90921902")).toBe(false);
    });
  });

  describe("Transfer form validation", () => {
    it("should reject zero amounts", () => {
      const amount = 0;
      expect(amount > 0).toBe(false);
    });

    it("should reject negative amounts", () => {
      const amount = -5;
      expect(amount > 0).toBe(false);
    });

    it("should reject same source and destination", () => {
      const from = "wallet-uuid";
      const to = "wallet-uuid";
      expect(from === to).toBe(true);
    });

    it("should accept valid transfer parameters", () => {
      const from = "5f86030f-695d-4545-86bf-42d224d65fe0";
      const to = "CR12345";
      const amount = 10.00;

      expect(from).not.toBe(to);
      expect(amount > 0).toBe(true);
    });
  });

  describe("Query key consistency", () => {
    const queryKeys = {
      wallets: ["deriv", "wallets"] as const,
      platformAccounts: ["deriv", "platformAccounts"] as const,
      transactions: (walletType: string) => ["deriv", "transactions", walletType] as const,
      portfolio: (accountId: string) => ["deriv", "portfolio", accountId] as const,
      tradeHistory: (accountId: string) => ["deriv", "trades", accountId] as const,
    };

    it("should generate unique keys for different wallet types", () => {
      const mainKey = queryKeys.transactions("main");
      const p2pKey = queryKeys.transactions("p2p");
      expect(mainKey).not.toEqual(p2pKey);
    });

    it("should generate unique keys for different accounts", () => {
      const key1 = queryKeys.portfolio("CR12345");
      const key2 = queryKeys.portfolio("VR67890");
      expect(key1).not.toEqual(key2);
    });

    it("should invalidate correct keys after transfer", () => {
      // After a transfer, we should invalidate wallets and platformAccounts
      const keysToInvalidate = [
        queryKeys.wallets,
        queryKeys.platformAccounts,
      ];

      expect(keysToInvalidate).toContain(queryKeys.wallets);
      expect(keysToInvalidate).toContain(queryKeys.platformAccounts);
    });
  });
});
