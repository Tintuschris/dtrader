import WebSocket from "ws";

const OPTIONS_API = "https://api.derivws.com/trading/v1/options";
export type OptionsAccount = { id: string; type: "demo" | "real"; currency: string };

export async function getOptionsAccounts(accessToken: string): Promise<OptionsAccount[]> {
  const appId = process.env.DERIV_APP_ID;
  if (!appId) throw new Error("DERIV_APP_ID is not configured");
  const response = await fetch(`${OPTIONS_API}/accounts`, { headers: { "Deriv-App-ID": appId, Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!response.ok) throw new Error("Unable to retrieve Options accounts");
  const body = await response.json() as { data?: { accounts?: Record<string, unknown>[] } | Record<string, unknown>[]; accounts?: Record<string, unknown>[] };
  const entries = Array.isArray(body.data) ? body.data : body.data?.accounts ?? body.accounts ?? [];
  return entries.map((account) => {
    const id = String(account.loginid ?? account.account_id ?? account.id ?? "");
    const virtual = account.is_virtual === 1 || account.is_virtual === true || String(account.account_type ?? account.type ?? "").toLowerCase().includes("demo") || id.startsWith("VR");
    return { id, type: (virtual ? "demo" : "real") as OptionsAccount["type"], currency: String(account.currency ?? "USD") };
  }).filter((account) => account.id);
}

export async function getOptionsSocketUrl(accountId: string, accessToken: string): Promise<string> {
  const appId = process.env.DERIV_APP_ID;
  if (!appId) throw new Error("DERIV_APP_ID is not configured");
  const response = await fetch(`${OPTIONS_API}/accounts/${encodeURIComponent(accountId)}/otp`, { method: "POST", headers: { "Deriv-App-ID": appId, Authorization: `Bearer ${accessToken}` }, cache: "no-store" });
  if (!response.ok) throw new Error("Unable to create an Options WebSocket session");
  const body = await response.json() as { data?: { url?: string } };
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
      settled = true; clearTimeout(timer); socket.close();
      if (error) reject(error); else resolve(value as T);
    };
    const timer = setTimeout(() => finish(new Error(`Deriv request timed out waiting for ${messageType}; last response: ${lastMessageType}`)), 12_000);
    socket.on("open", () => socket.send(JSON.stringify(request)));
    socket.on("message", (payload) => {
      try {
        const message = JSON.parse(String(payload)) as { msg_type?: string; error?: { message?: string } };
        lastMessageType = message.msg_type ?? "untyped response";
        if (message.msg_type === messageType) finish(message.error ? new Error(message.error.message ?? "Deriv request failed") : undefined, message as T);
      } catch { lastMessageType = "unparseable response"; }
    });
    socket.on("error", (error) => finish(error));
    socket.on("close", (code, reason) => {
      if (!settled) finish(new Error(`Deriv WebSocket closed (${code}) before ${messageType}: ${reason.toString() || lastMessageType}`));
    });
  });
}

export async function resolveOptionsAccount(accessToken: string, requestedId?: string): Promise<OptionsAccount> {
  const accounts = await getOptionsAccounts(accessToken);
  const account = requestedId ? accounts.find((item) => item.id === requestedId) : accounts[0];
  if (!account) throw new Error("The requested Options account is unavailable");
  return account;
}
