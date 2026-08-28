/**
 * Server-side WebSocket connection pool for Deriv Core API v3.
 *
 * Reuses authenticated WebSocket connections instead of creating a new one
 * per request. Connections are kept alive and reused for subsequent requests
 * to the same account. Idle connections are cleaned up after 5 minutes.
 */

import WebSocket from "ws";

const CORE_WS_BASE = "wss://ws.derivws.com/websockets/v3";
const IDLE_TIMEOUT_MS = 5 * 60_000; // 5 minutes
const REQUEST_TIMEOUT_MS = 20_000;  // 20 seconds per request

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

type PooledConnection = {
  ws: WebSocket;
  accountId: string;
  accountType: "demo" | "real";
  ready: boolean;
  idleTimer: ReturnType<typeof setTimeout> | null;
  pending: Map<string, PendingRequest>;
  reqCounter: number;
};

/* ------------------------------------------------------------------ */
/*  Pool                                                               */
/* ------------------------------------------------------------------ */

const pool = new Map<string, PooledConnection>();

function resolveCoreAppId(): string {
  const explicit = process.env.DERIV_CORE_APP_ID;
  if (explicit && /^\d+$/.test(explicit) && explicit.length >= 3) {
    return explicit;
  }
  return "1001";
}

/**
 * Get or create a pooled WebSocket connection for the given access token.
 * The connection is authenticated and ready to send requests.
 */
function getConnection(token: string, targetAccountId?: string): Promise<PooledConnection> {
  // Use a simplified key — in production you'd hash the token
  const poolKey = targetAccountId ?? "default";

  const existing = pool.get(poolKey);
  if (existing && existing.ws.readyState === WebSocket.OPEN && existing.ready) {
    // Reset idle timer
    resetIdleTimer(existing);
    return Promise.resolve(existing);
  }

  // Clean up stale connection
  if (existing) {
    cleanup(existing);
  }

  return createConnection(token, targetAccountId, poolKey);
}

function resetIdleTimer(conn: PooledConnection) {
  if (conn.idleTimer) clearTimeout(conn.idleTimer);
  conn.idleTimer = setTimeout(() => {
    console.log(`[ws-pool] Closing idle connection for ${conn.accountId}`);
    cleanup(conn);
    pool.delete(conn.accountId);
  }, IDLE_TIMEOUT_MS);
}

function cleanup(conn: PooledConnection) {
  if (conn.idleTimer) {
    clearTimeout(conn.idleTimer);
    conn.idleTimer = null;
  }
  for (const [id, pending] of conn.pending) {
    clearTimeout(pending.timer);
    pending.reject(new Error("Connection closed"));
    conn.pending.delete(id);
  }
  try { conn.ws.close(1000); } catch { /* ignore */ }
}

function createConnection(
  token: string,
  targetAccountId: string | undefined,
  poolKey: string,
): Promise<PooledConnection> {
  return new Promise((resolve, reject) => {
    const appId = resolveCoreAppId();
    const ws = new WebSocket(`${CORE_WS_BASE}?app_id=${appId}`);

    const conn: PooledConnection = {
      ws,
      accountId: targetAccountId ?? "",
      accountType: "demo",
      ready: false,
      idleTimer: null,
      pending: new Map(),
      reqCounter: 0,
    };

    let authResolved = false;

    const onAuthComplete = (loginid: string, isVirtual: boolean, accountList?: Array<{ loginid?: string; is_virtual?: number | boolean; token?: string }>) => {
      conn.accountId = loginid;
      conn.accountType = (isVirtual ? "demo" : "real") as "demo" | "real";

      // If we need to switch to a different sub-account
      if (targetAccountId && targetAccountId !== loginid && accountList) {
        const target = accountList.find((a) => a.loginid === targetAccountId);
        if (target?.token) {
          conn.accountId = target.loginid ?? targetAccountId;
          conn.accountType = (target.is_virtual === 1 || target.is_virtual === true || conn.accountId.startsWith("VR")) ? "demo" : "real";
          ws.send(JSON.stringify({ authorize: target.token, req_id: 1 }));
          return;
        }
      }

      // Connection is ready
      conn.ready = true;
      authResolved = true;
      pool.set(poolKey, conn);
      resetIdleTimer(conn);
      resolve(conn);
    };

    const timer = setTimeout(() => {
      if (!authResolved) {
        cleanup(conn);
        reject(new Error("WebSocket connection timed out"));
      }
    }, 10_000);

    ws.on("open", () => {
      ws.send(JSON.stringify({ authorize: token, req_id: 0 }));
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as Record<string, unknown>;

        // Handle authorize responses
        if (msg.msg_type === "authorize") {
          const auth = msg.authorize as {
            loginid?: string;
            is_virtual?: number | boolean;
            account_list?: Array<{ loginid?: string; is_virtual?: number | boolean; token?: string }>;
          } | undefined;

          if (auth) {
            const isVirtual = auth.is_virtual === 1 || auth.is_virtual === true || (auth.loginid ?? "").startsWith("VR");
            onAuthComplete(auth.loginid ?? "", isVirtual, auth.account_list);
          }
          return;
        }

        // Handle error responses
        if (msg.error) {
          const errMsg = (msg.error as Record<string, string>).message ?? JSON.stringify(msg.error);
          const reqId = msg.req_id as string | undefined;
          if (reqId && conn.pending.has(reqId)) {
            const p = conn.pending.get(reqId)!;
            clearTimeout(p.timer);
            conn.pending.delete(reqId);
            p.reject(new Error(`Deriv API error: ${errMsg}`));
          }
          return;
        }

        // Handle data responses
        const reqId = msg.req_id as string | undefined;
        if (reqId && conn.pending.has(reqId)) {
          const p = conn.pending.get(reqId)!;
          clearTimeout(p.timer);
          conn.pending.delete(reqId);
          p.resolve(msg);
        }
      } catch { /* ignore parse errors */ }
    });

    ws.on("error", (err) => {
      if (!authResolved) {
        clearTimeout(timer);
        cleanup(conn);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    ws.on("close", (code, reason) => {
      if (!authResolved) {
        clearTimeout(timer);
        cleanup(conn);
        reject(new Error(`WebSocket closed (${code}): ${reason.toString() || "connection closed"}`));
      } else {
        // Connection was ready but closed — clean up
        cleanup(conn);
        pool.delete(poolKey);
      }
    });
  });
}

/* ------------------------------------------------------------------ */
/*  Public API                                                         */
/* ------------------------------------------------------------------ */

/**
 * Execute an authenticated request via a pooled Core API v3 WebSocket.
 * Reuses existing connections when possible.
 */
export async function pooledV3Request<T>(
  token: string,
  payload: Record<string, unknown>,
  expectedMsgType: string,
  targetAccountId?: string,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<{ result: T; accountId: string; accountType: "demo" | "real" }> {
  const conn = await getConnection(token, targetAccountId);

  return new Promise((resolve, reject) => {
    const reqId = String(++conn.reqCounter);

    const timer = setTimeout(() => {
      conn.pending.delete(reqId);
      reject(new Error(`Deriv v3 request timed out waiting for ${expectedMsgType}`));
    }, timeoutMs);

    conn.pending.set(reqId, {
      resolve: (value) => {
        const msg = value as Record<string, unknown>;
        resolve({
          result: msg as T,
          accountId: conn.accountId,
          accountType: conn.accountType,
        });
      },
      reject,
      timer,
    });

    conn.ws.send(JSON.stringify({ ...payload, req_id: reqId }));
  });
}

/**
 * Close all pooled connections (for shutdown/cleanup).
 */
export function closeAllConnections(): void {
  for (const [key, conn] of pool) {
    cleanup(conn);
    pool.delete(key);
  }
}
