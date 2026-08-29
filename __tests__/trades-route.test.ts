/**
 * Integration tests for /api/deriv/trades route.
 *
 * Mocks the WebSocket connection and tests:
 * - Successful profit_table fetch via Options API WS (OTP)
 * - Fallback to Core API v3 when Options WS returns UnrecognisedRequest
 * - Fallback to Core API v3 when Options WS times out
 * - Auth failure when no session exists
 * - Empty trade history
 * - Trade parsing (profit calculation, status derivation)
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

// Mock next/server
jest.mock("next/server", () => ({
  NextRequest: class {
    url: string;
    constructor(url: string) { this.url = url; }
  },
  NextResponse: {
    json(body: unknown, init?: { status?: number }) {
      return { body, status: init?.status ?? 200 };
    },
  },
}));

// Mock deriv-session
const mockGetSession = jest.fn();
jest.mock("../lib/deriv-session", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

// Mock deriv-options-ws
const mockRequestOptionsAccountWs = jest.fn();
const mockDerivV3AuthRequest = jest.fn();
jest.mock("../lib/deriv-options-ws", () => ({
  requestOptionsAccountWs: (...args: unknown[]) => mockRequestOptionsAccountWs(...args),
  derivV3AuthRequest: (...args: unknown[]) => mockDerivV3AuthRequest(...args),
}));

// Import after mocks
import { GET } from "../app/api/deriv/trades/route";

function makeRequest(params?: Record<string, string>) {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return { url: `http://localhost:3000/api/deriv/trades${qs}` } as any;
}

describe("GET /api/deriv/trades", () => {
  const mockSession = {
    accessToken: "test-oauth-token-abc123",
    tokenType: "Bearer",
    scopes: ["trade", "account_manage"],
    loginId: "VR12345",
  };

  const mockOtpProfitTable = {
    result: {
      profit_table: {
        transactions: [
          {
            contract_id: "88001",
            contract_type: "DIGITOVER",
            underlying_symbol: "1HZ100V",
            buy_price: 10.0,
            sell_price: 19.5,
            payout: 19.5,
            profit: 9.5,
            status: "won",
            barrier: "4",
            purchase_time: 1690000000,
            sell_time: 1690000060,
          },
          {
            contract_id: "88002",
            contract_type: "DIGITUNDER",
            underlying_symbol: "1HZ50V",
            buy_price: 5.0,
            sell_price: 0,
            payout: 0,
            profit: -5.0,
            status: "lost",
            barrier: "7",
            purchase_time: 1690000100,
            sell_time: 1690000105,
          },
          {
            contract_id: "88003",
            contract_type: "DIGITMATCH",
            underlying: "BOOM500",
            buy_price: 20.0,
            sell_price: 20.0,
            payout: 20.0,
            // profit is sell_price - buy_price
            status: "expired",
            purchase_time: 1690000200,
          },
        ],
        count: 3,
      },
    },
    accountId: "VR12345",
    accountType: "demo" as const,
  };

  const mockCoreProfitTable = {
    result: {
      profit_table: {
        transactions: [
          {
            contract_id: "99001",
            contract_type: "DIGITEVEN",
            underlying_symbol: "1HZ25V",
            buy_price: 8.0,
            sell_price: 15.2,
            payout: 15.2,
            status: "won",
            purchase_time: 1690001000,
            sell_time: 1690001060,
          },
        ],
        count: 1,
      },
    },
    accountId: "VR12345",
    accountType: "demo" as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue(mockSession);
    process.env.DERIV_PAT = "pat_test_token_xyz";
  });

  afterEach(() => {
    delete process.env.DERIV_PAT;
  });

  it("should return 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);

    const response: any = await GET(makeRequest({ accountId: "VR12345" }));
    expect(response.status).toBe(401);
    expect(response.body.error).toContain("log in");
  });

  it("should return trade history via Options API WS (PAT first)", async () => {
    mockRequestOptionsAccountWs.mockResolvedValue(mockOtpProfitTable);

    const response: any = await GET(makeRequest({ accountId: "VR12345", limit: "10" }));

    expect(response.status).toBe(200);
    expect(response.body.trades).toHaveLength(3);
    expect(response.body.total).toBe(3);
    expect(response.body.account.id).toBe("VR12345");

    // Verify trade parsing
    const trade1 = response.body.trades[0];
    expect(trade1.contract_id).toBe("88001");
    expect(trade1.contract_type).toBe("DIGITOVER");
    expect(trade1.symbol).toBe("1HZ100V");
    expect(trade1.buy_price).toBe(10.0);
    expect(trade1.payout).toBe(19.5);
    expect(trade1.profit).toBe(9.5);
    expect(trade1.status).toBe("won");

    const trade2 = response.body.trades[1];
    expect(trade2.contract_id).toBe("88002");
    expect(trade2.profit).toBe(-5.0);
    expect(trade2.status).toBe("lost");
  });

  it("should use PAT first, then fall back to OAuth", async () => {
    mockRequestOptionsAccountWs.mockResolvedValue(mockOtpProfitTable);

    await GET(makeRequest({ accountId: "VR12345" }));

    expect(mockRequestOptionsAccountWs).toHaveBeenCalledTimes(1);
    const token = mockRequestOptionsAccountWs.mock.calls[0][0];
    expect(token).toBe("pat_test_token_xyz");
  });

  it("should fall back to OAuth when PAT fails", async () => {
    mockRequestOptionsAccountWs
      .mockRejectedValueOnce(new Error("PAT auth failed"))
      .mockResolvedValueOnce(mockOtpProfitTable);

    const response: any = await GET(makeRequest({ accountId: "VR12345" }));

    expect(response.status).toBe(200);
    expect(response.body.trades).toHaveLength(3);
    expect(mockRequestOptionsAccountWs).toHaveBeenCalledTimes(2);

    const secondToken = mockRequestOptionsAccountWs.mock.calls[1][0];
    expect(secondToken).toBe("test-oauth-token-abc123");
  });

  it("should fall back to Core API v3 when Options WS returns UnrecognisedRequest", async () => {
    // Options WS fails with UnrecognisedRequest
    mockRequestOptionsAccountWs
      .mockRejectedValueOnce(new Error("Unrecognised request"))
      .mockRejectedValueOnce(new Error("Unrecognised request"));

    // Core API v3 succeeds
    mockDerivV3AuthRequest.mockResolvedValue(mockCoreProfitTable);

    const response: any = await GET(makeRequest({ accountId: "VR12345" }));

    expect(response.status).toBe(200);
    expect(response.body.trades).toHaveLength(1);
    expect(response.body.trades[0].contract_id).toBe("99001");
    expect(response.body.trades[0].status).toBe("won");
    expect(response.body.account.id).toBe("VR12345");

    // Should have tried Options WS first, then Core API v3
    expect(mockRequestOptionsAccountWs).toHaveBeenCalled();
    expect(mockDerivV3AuthRequest).toHaveBeenCalled();
  });

  it("should fall back to Core API v3 when Options WS times out", async () => {
    mockRequestOptionsAccountWs
      .mockRejectedValueOnce(new Error("Deriv request timed out waiting for profit_table"))
      .mockRejectedValueOnce(new Error("Deriv request timed out waiting for profit_table"));

    mockDerivV3AuthRequest.mockResolvedValue(mockCoreProfitTable);

    const response: any = await GET(makeRequest({ accountId: "VR12345" }));

    expect(response.status).toBe(200);
    expect(mockDerivV3AuthRequest).toHaveBeenCalled();
  });

  it("should return 500 when all auth methods fail", async () => {
    mockRequestOptionsAccountWs
      .mockRejectedValueOnce(new Error("PAT connection refused"))
      .mockRejectedValueOnce(new Error("OAuth connection refused"));
    mockDerivV3AuthRequest
      .mockRejectedValueOnce(new Error("Core v3 PAT failed"))
      .mockRejectedValueOnce(new Error("Core v3 OAuth failed"));

    const response: any = await GET(makeRequest({ accountId: "VR12345" }));

    expect(response.status).toBe(500);
    expect(response.body.error).toContain("Core v3 OAuth failed");
  });

  it("should respect limit and offset parameters", async () => {
    mockRequestOptionsAccountWs.mockResolvedValue(mockOtpProfitTable);

    await GET(makeRequest({ accountId: "VR12345", limit: "100", offset: "50" }));

    const payload = mockRequestOptionsAccountWs.mock.calls[0][2];
    expect(payload.limit).toBe(100);
    expect(payload.offset).toBe(50);
  });

  it("should clamp limit to maximum of 500", async () => {
    mockRequestOptionsAccountWs.mockResolvedValue(mockOtpProfitTable);

    await GET(makeRequest({ accountId: "VR12345", limit: "9999" }));

    const payload = mockRequestOptionsAccountWs.mock.calls[0][2];
    expect(payload.limit).toBe(500);
  });

  it("should default to limit=50 and offset=0", async () => {
    mockRequestOptionsAccountWs.mockResolvedValue(mockOtpProfitTable);

    await GET(makeRequest({ accountId: "VR12345" }));

    const payload = mockRequestOptionsAccountWs.mock.calls[0][2];
    expect(payload.limit).toBe(50);
    expect(payload.offset).toBe(0);
  });

  it("should use session loginId when no accountId query param", async () => {
    mockRequestOptionsAccountWs.mockResolvedValue(mockOtpProfitTable);

    await GET(makeRequest());

    const passedAccountId = mockRequestOptionsAccountWs.mock.calls[0][1];
    expect(passedAccountId).toBe("VR12345");
  });

  it("should return empty trades when no transactions exist", async () => {
    mockRequestOptionsAccountWs.mockResolvedValue({
      result: { profit_table: { transactions: [], count: 0 } },
      accountId: "VR12345",
      accountType: "demo" as const,
    });

    const response: any = await GET(makeRequest({ accountId: "VR12345" }));

    expect(response.status).toBe(200);
    expect(response.body.trades).toHaveLength(0);
    expect(response.body.total).toBe(0);
  });

  it("should handle missing profit_table field in response", async () => {
    mockRequestOptionsAccountWs.mockResolvedValue({
      result: {},
      accountId: "VR12345",
      accountType: "demo" as const,
    });

    const response: any = await GET(makeRequest({ accountId: "VR12345" }));

    expect(response.status).toBe(200);
    expect(response.body.trades).toHaveLength(0);
  });

  it("should derive status from profit when status field is empty", async () => {
    mockRequestOptionsAccountWs.mockResolvedValue({
      result: {
        profit_table: {
          transactions: [
            {
              contract_id: "100",
              buy_price: 10,
              sell_price: 20,
              // no status field
              purchase_time: 1690000000,
            },
            {
              contract_id: "101",
              buy_price: 10,
              sell_price: 5,
              // no status field
              purchase_time: 1690000100,
            },
          ],
          count: 2,
        },
      },
      accountId: "VR12345",
      accountType: "demo" as const,
    });

    const response: any = await GET(makeRequest({ accountId: "VR12345" }));

    // Positive profit → "won"
    expect(response.body.trades[0].status).toBe("won");
    // Negative profit → "lost"
    expect(response.body.trades[1].status).toBe("lost");
  });

  it("should calculate profit as sell_price - buy_price", async () => {
    mockRequestOptionsAccountWs.mockResolvedValue({
      result: {
        profit_table: {
          transactions: [
            {
              contract_id: "200",
              buy_price: 15.0,
              sell_price: 22.5,
              purchase_time: 1690000000,
            },
          ],
          count: 1,
        },
      },
      accountId: "VR12345",
      accountType: "demo" as const,
    });

    const response: any = await GET(makeRequest({ accountId: "VR12345" }));
    expect(response.body.trades[0].profit).toBe(7.5);
  });

  it("should set hasMore when result count equals limit", async () => {
    mockRequestOptionsAccountWs.mockResolvedValue({
      result: {
        profit_table: {
          transactions: [{ contract_id: "1", buy_price: 1, sell_price: 2, purchase_time: 1 }],
          count: 50,
        },
      },
      accountId: "VR12345",
      accountType: "demo" as const,
    });

    // limit=1, returned 1 → hasMore should be true
    const response: any = await GET(makeRequest({ accountId: "VR12345", limit: "1" }));
    expect(response.body.hasMore).toBe(true);
  });

  it("should set hasMore=false when result count is less than limit", async () => {
    mockRequestOptionsAccountWs.mockResolvedValue({
      result: {
        profit_table: {
          transactions: [
            { contract_id: "1", buy_price: 1, sell_price: 2, purchase_time: 1 },
            { contract_id: "2", buy_price: 1, sell_price: 2, purchase_time: 1 },
          ],
          count: 2,
        },
      },
      accountId: "VR12345",
      accountType: "demo" as const,
    });

    // limit=50, returned 2 → hasMore should be false
    const response: any = await GET(makeRequest({ accountId: "VR12345", limit: "50" }));
    expect(response.body.hasMore).toBe(false);
  });

  it("should fall back to Core API v3 for non-UnrecognisedRequest errors too", async () => {
    // Options WS fails with timeout (not UnrecognisedRequest)
    mockRequestOptionsAccountWs
      .mockRejectedValueOnce(new Error("WebSocket closed (1006) before profit_table: connection closed"))
      .mockRejectedValueOnce(new Error("WebSocket closed (1006) before profit_table: connection closed"));

    mockDerivV3AuthRequest.mockResolvedValue(mockCoreProfitTable);

    const response: any = await GET(makeRequest({ accountId: "VR12345" }));

    expect(response.status).toBe(200);
    // Core API v3 should have been attempted
    expect(mockDerivV3AuthRequest).toHaveBeenCalled();
  });

  it("should use session token when DERIV_PAT is not set", async () => {
    delete process.env.DERIV_PAT;
    mockRequestOptionsAccountWs.mockResolvedValue(mockOtpProfitTable);

    const response: any = await GET(makeRequest({ accountId: "VR12345" }));

    expect(response.status).toBe(200);
    // Only one call (OAuth), no PAT attempt
    expect(mockRequestOptionsAccountWs).toHaveBeenCalledTimes(1);
    const token = mockRequestOptionsAccountWs.mock.calls[0][0];
    expect(token).toBe("test-oauth-token-abc123");
  });

  it("should handle underlying vs underlying_symbol vs symbol field variations", async () => {
    mockRequestOptionsAccountWs.mockResolvedValue({
      result: {
        profit_table: {
          transactions: [
            { contract_id: "300", underlying: "1HZ100V", buy_price: 5, sell_price: 10, purchase_time: 1 },
            { contract_id: "301", symbol: "frxEURUSD", buy_price: 5, sell_price: 10, purchase_time: 1 },
            { contract_id: "302", underlying_symbol: "BOOM500", buy_price: 5, sell_price: 10, purchase_time: 1 },
          ],
          count: 3,
        },
      },
      accountId: "VR12345",
      accountType: "demo" as const,
    });

    const response: any = await GET(makeRequest({ accountId: "VR12345" }));

    expect(response.body.trades[0].symbol).toBe("1HZ100V");
    expect(response.body.trades[1].symbol).toBe("frxEURUSD");
    expect(response.body.trades[2].symbol).toBe("BOOM500");
  });
});
