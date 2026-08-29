/**
 * Integration tests for /api/deriv/portfolio route.
 *
 * Mocks the WebSocket connection via requestOptionsAccountWs and tests:
 * - Successful portfolio fetch via Options API WS (OTP)
 * - Fallback to Core API v3 when OTP fails
 * - Auth failure when no session exists
 * - Auth failure when all token attempts fail
 * - Empty portfolio (no open positions)
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
jest.mock("../lib/deriv-options-ws", () => ({
  requestOptionsAccountWs: (...args: unknown[]) => mockRequestOptionsAccountWs(...args),
}));

// Import after mocks
import { GET } from "../app/api/deriv/portfolio/route";

function makeRequest(accountId?: string) {
  const url = accountId
    ? `http://localhost:3000/api/deriv/portfolio?accountId=${accountId}`
    : "http://localhost:3000/api/deriv/portfolio";
  return { url } as any;
}

describe("GET /api/deriv/portfolio", () => {
  const mockSession = {
    accessToken: "test-oauth-token-abc123",
    tokenType: "Bearer",
    scopes: ["trade", "account_manage"],
    loginId: "VR12345",
  };

  const mockOtpResult = {
    result: {
      portfolio: {
        contracts: [
          {
            contract_id: "12345678",
            contract_type: "DIGITOVER",
            underlying_symbol: "1HZ100V",
            buy_price: 10.0,
            payout: 19.5,
            profit: 9.5,
            status: "open",
            barrier: "4",
            purchase_time: 1690000000,
          },
          {
            contract_id: "12345679",
            contract_type: "DIGITUNDER",
            underlying_symbol: "1HZ50V",
            buy_price: 5.0,
            payout: 9.2,
            profit: 0,
            status: "open",
            purchase_time: 1690000100,
          },
        ],
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

    const response: any = await GET(makeRequest());
    expect(response.status).toBe(401);
    expect(response.body.error).toContain("log in");
  });

  it("should return 401 when session has no access token", async () => {
    mockGetSession.mockResolvedValue({ accessToken: null });

    const response: any = await GET(makeRequest());
    expect(response.status).toBe(401);
  });

  it("should return portfolio positions via Options API WS (PAT first)", async () => {
    mockRequestOptionsAccountWs.mockResolvedValue(mockOtpResult);

    const response: any = await GET(makeRequest("VR12345"));

    expect(response.status).toBe(200);
    expect(response.body.positions).toHaveLength(2);
    expect(response.body.positions[0].contract_id).toBe("12345678");
    expect(response.body.positions[0].contract_type).toBe("DIGITOVER");
    expect(response.body.positions[0].symbol).toBe("1HZ100V");
    expect(response.body.positions[0].buy_price).toBe(10.0);
    expect(response.body.positions[0].status).toBe("open");
    expect(response.body.account.id).toBe("VR12345");
    expect(response.body.account.type).toBe("demo");

    // Should use PAT first
    expect(mockRequestOptionsAccountWs).toHaveBeenCalledTimes(1);
    const [token, accountId, payload, msgType] = mockRequestOptionsAccountWs.mock.calls[0];
    expect(token).toBe("pat_test_token_xyz");
    expect(accountId).toBe("VR12345");
    expect(payload).toEqual({ portfolio: 1 });
    expect(msgType).toBe("portfolio");
  });

  it("should fall back to OAuth token when PAT fails", async () => {
    mockRequestOptionsAccountWs
      .mockRejectedValueOnce(new Error("PAT auth failed"))
      .mockResolvedValueOnce(mockOtpResult);

    const response: any = await GET(makeRequest("VR12345"));

    expect(response.status).toBe(200);
    expect(response.body.positions).toHaveLength(2);
    expect(mockRequestOptionsAccountWs).toHaveBeenCalledTimes(2);

    const secondCallToken = mockRequestOptionsAccountWs.mock.calls[1][0];
    expect(secondCallToken).toBe("test-oauth-token-abc123");
  });

  it("should return empty positions when no open contracts", async () => {
    mockRequestOptionsAccountWs.mockResolvedValue({
      result: { portfolio: { contracts: [] } },
      accountId: "VR12345",
      accountType: "demo" as const,
    });

    const response: any = await GET(makeRequest("VR12345"));

    expect(response.status).toBe(200);
    expect(response.body.positions).toHaveLength(0);
  });

  it("should handle missing portfolio field in response", async () => {
    mockRequestOptionsAccountWs.mockResolvedValue({
      result: {},
      accountId: "VR12345",
      accountType: "demo" as const,
    });

    const response: any = await GET(makeRequest("VR12345"));

    expect(response.status).toBe(200);
    expect(response.body.positions).toHaveLength(0);
  });

  it("should return 500 when all auth methods fail", async () => {
    mockRequestOptionsAccountWs
      .mockRejectedValueOnce(new Error("PAT connection refused"))
      .mockRejectedValueOnce(new Error("OAuth token expired"));

    const response: any = await GET(makeRequest("VR12345"));

    expect(response.status).toBe(500);
    expect(response.body.error).toContain("OAuth token expired");
  });

  it("should use session loginId when no accountId query param", async () => {
    mockRequestOptionsAccountWs.mockResolvedValue(mockOtpResult);

    const response: any = await GET(makeRequest());

    expect(response.status).toBe(200);
    const passedAccountId = mockRequestOptionsAccountWs.mock.calls[0][1];
    expect(passedAccountId).toBe("VR12345");
  });

  it("should normalize position fields with safe defaults", async () => {
    mockRequestOptionsAccountWs.mockResolvedValue({
      result: {
        portfolio: {
          contracts: [
            {
              contract_id: "999",
              // Missing most fields — should use defaults
            },
          ],
        },
      },
      accountId: "VR12345",
      accountType: "demo" as const,
    });

    const response: any = await GET(makeRequest("VR12345"));

    expect(response.status).toBe(200);
    const pos = response.body.positions[0];
    expect(pos.contract_id).toBe("999");
    expect(pos.contract_type).toBe("");
    expect(pos.symbol).toBe("");
    expect(pos.buy_price).toBe(0);
    expect(pos.payout).toBe(0);
    expect(pos.profit).toBe(0);
    expect(pos.status).toBe("open");
  });

  it("should not pass PAT when DERIV_PAT is not set", async () => {
    delete process.env.DERIV_PAT;
    mockRequestOptionsAccountWs.mockResolvedValue(mockOtpResult);

    const response: any = await GET(makeRequest("VR12345"));

    expect(response.status).toBe(200);
    expect(mockRequestOptionsAccountWs).toHaveBeenCalledTimes(1);
    const token = mockRequestOptionsAccountWs.mock.calls[0][0];
    expect(token).toBe("test-oauth-token-abc123");
  });

  it("should handle contracts with underlying or symbol field variations", async () => {
    mockRequestOptionsAccountWs.mockResolvedValue({
      result: {
        portfolio: {
          contracts: [
            { contract_id: "1", underlying: "1HZ100V", buy_price: 10 },
            { contract_id: "2", symbol: "frxEURUSD", buy_price: 5 },
            { contract_id: "3", underlying_symbol: "BOOM500", buy_price: 3 },
          ],
        },
      },
      accountId: "VR12345",
      accountType: "demo" as const,
    });

    const response: any = await GET(makeRequest("VR12345"));

    expect(response.body.positions[0].symbol).toBe("1HZ100V");
    expect(response.body.positions[1].symbol).toBe("frxEURUSD");
    expect(response.body.positions[2].symbol).toBe("BOOM500");
  });
});
