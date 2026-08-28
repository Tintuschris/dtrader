import WebSocket from "ws";

const OPTIONS_API = "https://api.derivws.com/trading/v1/options";
export type OptionsAccount = { id: string; type: "demo" | "real"; currency: string; balance: number | null; status?: string };

export async function getOptionsAccounts(accessToken: string): Promise<OptionsAccount[]> {
  const appId = process.env.DERIV_APP_ID;
  if (!appId) throw new Error("DERIV_APP_ID is not configured");
  const response = await fetch(`${OPTIONS_API}/accounts`, {
    headers: { "Deriv-App-ID": appId, Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as {
      errors?: Array<{ message?: string }>;
      error?: { message?: string };
      message?: string;
    } | null;
    throw new Error(
      failure?.errors?.[0]?.message ?? failure?.error?.message ?? failure?.message ?? "Unable to retrieve Options accounts",
    );
  }
  const body = (await response.json()) as {
    data?: { accounts?: Record<string, unknown>[] } | Record<string, unknown>[];
    accounts?: Record<string, unknown>[] };
  const entries = Array.isArray(body.data) ? body.data : body.data?.accounts ?? body.accounts ?? [];
  return entries
    .map((account) => {
      const id = String(account.loginid ?? account.account_id ?? account.id ?? "");
      const virtual =
        account.is_virtual === 1 ||
        account.is_virtual === true ||
        String(account.account_type ?? account.type ?? "").toLowerCase().includes("demo") ||
        id.startsWith("VR");
      const balance = Number(account.balance);
      return {
        id,
        type: (virtual ? "demo" : "real") as OptionsAccount["type"],
        currency: String(account.currency ?? "USD"),
        balance: Number.isFinite(balance) ? balance : null,
        status: typeof account.status === "string" ? account.status : undefined,
      };
    })
    .filter((account) => account.id);
}

export async function getOptionsSocketUrl(accountId: string, accessToken: string): Promise<string> {
  const appId = process.env.DERIV_APP_ID;
  if (!appId) throw new Error("DERIV_APP_ID is not configured");
  const response = await fetch(`${OPTIONS_API}/accounts/${encodeURIComponent(accountId)}/otp`, {
    method: "POST",
    headers: { "Deriv-App-ID": appId, Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) {
    const failure = (await response.json().catch(() => null)) as {
      errors?: Array<{ message?: string }>;
      error?: { message?: string };
      message?: string;
    } | null;
    throw new Error(
      failure?.errors?.[0]?.message ?? failure?.error?.message ?? failure?.message ?? "Unable to create an Options WebSocket session",
    );
  }
  const body = (await response.json()) as { data?: { url?: string } };
  if (!body.data?.url) throw new Error("Deriv did not return a WebSocket URL");
  return body.data.url;
}

export function requestOptionsWs<T>(url: string, request: Record<string, unknown>, messageType: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    let settled = false;
    let lastMessageType = "no response";
    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* ignore */ }
      if (error) reject(error);
      else resolve(value as T);
    };
    const timer = setTimeout(
      () => finish(new Error(`Deriv request timed out waiting for ${messageType}; last response: ${lastMessageType}`)),
      12_000,
    );
    socket.on("open", () => socket.send(JSON.stringify(request)));
    socket.on("message", (payload) => {
      try {
        const message = JSON.parse(String(payload)) as { msg_type?: string; error?: { message?: string } };
        lastMessageType = message.msg_type ?? "untyped response";
        if (message.error) {
          finish(new Error(message.error.message ?? "Deriv request failed"));
          return;
        }
        if (message.msg_type === messageType)
          finish(undefined, message as T);
      } catch {
        lastMessageType = "unparseable response";
      }
    });
    socket.on("error", (error) => finish(error));
    socket.on("close", (code, reason) => {
      if (!settled)
        finish(new Error(`Deriv WebSocket closed (${code}) before ${messageType}: ${reason.toString() || lastMessageType}`));
    });
  });
}

/**
 * Sends an account-data request through the current Options API. Authentication
 * is established by the OTP URL; do not send a Core `authorize` request here.
 */
export async function requestOptionsAccountWs<T>(
  accessToken: string,
  requestedAccountId: string | undefined,
  request: Record<string, unknown>,
  messageType: string,
): Promise<{ result: T; accountId: string; accountType: "demo" | "real" }> {
  const account = await resolveOptionsAccount(accessToken, requestedAccountId);
  const url = await getOptionsSocketUrl(account.id, accessToken);
  const result = await requestOptionsWs<T>(url, request, messageType);
  return {
    result,
    accountId: account.id,
    accountType: account.type,
  };
}

/**
 * Executes an authenticated request via Deriv Core WebSocket v3 (wss://ws.derivws.com/websockets/v3).
 * First authenticates with the OAuth token, then sends the requested payload (profit_table, portfolio, statement, etc.).
 * Handles account switching if a targetAccountId is specified and sub-account tokens are returned.
 */

/**
 * Resolve the numeric Core API WebSocket app_id.
 * Priority: DERIV_CORE_APP_ID (numeric) > numeric prefix of DERIV_APP_ID > 1001.
 */
function resolveCoreAppId(): string {
  const explicit = process.env.DERIV_CORE_APP_ID;
  if (explicit && /^\d+$/.test(explicit) && explicit.length >= 3) {
    console.log("[CoreAPI] Using explicit DERIV_CORE_APP_ID:", explicit);
    return explicit;
  }
  console.warn("[CoreAPI] DERIV_CORE_APP_ID not set or invalid. Add a numeric app_id to .env.local and Vercel.");
  console.warn("[CoreAPI] Get one at https://developers.deriv.com/dashboard (Legacy API app). Falling back to 1001.");
  return "1001";
}
export async function derivV3AuthRequest<T>(
  accessToken: string,
  payload: Record<string, unknown>,
  expectedMsgType: string,
  targetAccountId?: string,
  timeoutMs = 15_000,
): Promise<{ result: T; accountId: string; accountType: "demo" | "real" }> {
  const appId = resolveCoreAppId();
  console.log("[CoreAPI] Using app_id:", appId);

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://ws.derivws.com/websockets/v3?app_id=${appId}`);
    let settled = false;
    let resolvedAccountId = targetAccountId ?? "";
    let resolvedAccountType: "demo" | "real" = "demo";

    const finish = (error?: Error, value?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { ws.close(); } catch { /* ignore */ }
      if (error) reject(error);
      else resolve({ result: value as T, accountId: resolvedAccountId, accountType: resolvedAccountType });
    };

    const timer = setTimeout(() => {
      finish(new Error(`Deriv v3 request timed out waiting for ${expectedMsgType}`));
    }, timeoutMs);

    ws.on("open", () => {
      // Step 1: Send authorize with OAuth access token
      ws.send(JSON.stringify({ authorize: accessToken, req_id: 1 }));
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as Record<string, unknown>;
        if (msg.error) {
          const errMsg = (msg.error as Record<string, string>).message ?? JSON.stringify(msg.error);
          finish(new Error(`Deriv API error: ${errMsg}`));
          return;
        }

        // Authorize response
        if (msg.msg_type === "authorize") {
          const auth = msg.authorize as {
            loginid?: string;
            is_virtual?: number | boolean;
            account_list?: Array<{ loginid?: string; is_virtual?: number | boolean; token?: string }>;
          } | undefined;

          const currentLogin = auth?.loginid ?? "";
          const isVirtual = auth?.is_virtual === 1 || auth?.is_virtual === true || currentLogin.startsWith("VR");
          resolvedAccountId = currentLogin;
          resolvedAccountType = isVirtual ? "demo" : "real";

          // If a specific targetAccountId was requested and differs, check if sub-account token exists
          if (targetAccountId && targetAccountId !== currentLogin && auth?.account_list) {
            const targetAcct = auth.account_list.find((a) => a.loginid === targetAccountId);
            if (targetAcct?.token) {
              resolvedAccountId = targetAcct.loginid ?? targetAccountId;
              resolvedAccountType =
                targetAcct.is_virtual === 1 || targetAcct.is_virtual === true || resolvedAccountId.startsWith("VR")
                  ? "demo"
                  : "real";
              ws.send(JSON.stringify({ authorize: targetAcct.token, req_id: 2 }));
              return;
            }
          }

          // Step 2: Send the requested payload (profit_table, portfolio, etc.)
          ws.send(JSON.stringify({ ...payload, req_id: 3 }));
          return;
        }

        if (msg.msg_type === expectedMsgType) {
          finish(undefined, msg as T);
        }
      } catch (err) {
        // ignore parse error
      }
    });

    ws.on("error", (err) => finish(err instanceof Error ? err : new Error(String(err))));
    ws.on("close", (code, reason) => {
      if (!settled) finish(new Error(`Deriv WebSocket closed (${code}): ${reason.toString() || "connection closed"}`));
    });
  });
}

export async function resolveOptionsAccount(accessToken: string, requestedId?: string): Promise<OptionsAccount> {
  const accounts = await getOptionsAccounts(accessToken);
  const account = requestedId ? accounts.find((item) => item.id === requestedId) : accounts[0];
  if (!account) throw new Error("The requested Options account is unavailable");
  return account;
}
