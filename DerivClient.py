"""Shared Deriv Options API client for the Python bot suite.

Extracts the common WebSocket lifecycle that every bot duplicates today:

* account selection (options/v1 REST)
* OTP -> authenticated WebSocket URL
* Core v3 WebSocket connect + authorize
* contracts_for probing for a contract type
* portfolio + tick + balance subscriptions
* proposal -> buy -> proposal_open_contract -> sell flow
* keepalive pings
* reconnection loop

Bots that adopt this module move their :meth:`run_session` / :meth:`subscribe`
/ :meth:`handle_message` / :meth:`keepalive` implementations onto the shared
pipeline and only keep their per-strategy tick handling and logbook.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from typing import Any, Callable

import aiohttp
import websockets

REST_BASE_URL = "https://api.derivws.com"
PING_INTERVAL = 30
MAX_RECONNECT_ATTEMPTS = 10
RECONNECT_BASE_DELAY = 2
PROPOSAL_MAX_AGE = 4.0
PAT_TOKEN = os.environ.get("PAT_TOKEN", "")
APP_ID = os.environ.get("DERIV_APP_ID", "")
USE_BRIDGE = os.environ.get("USE_BRIDGE", "1") == "1"
BRIDGE_URL = os.environ.get("DTRADER_BRIDGE_URL", "http://localhost:3000")
ACCOUNT_TYPE = os.environ.get("ACCOUNT_TYPE", "demo")


def configure(
    *,
    account_type: str | None = None,
    use_bridge: bool | None = None,
    bridge_url: str | None = None,
    pat_token: str | None = None,
    app_id: str | None = None,
) -> None:
    """Override module defaults at startup.

    Bots that parse ``--account`` from the CLI call
    ``configure(account_type=args.account)`` so the shared auth plumbing
    honours the explicit choice instead of the ACCOUNT_TYPE env var.
    """
    global ACCOUNT_TYPE, USE_BRIDGE, BRIDGE_URL, PAT_TOKEN, APP_ID
    if account_type is not None:
        ACCOUNT_TYPE = account_type
    if use_bridge is not None:
        USE_BRIDGE = use_bridge
    if bridge_url is not None:
        BRIDGE_URL = bridge_url
    if pat_token is not None:
        PAT_TOKEN = pat_token
    if app_id is not None:
        APP_ID = app_id


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def as_float(value: Any, default: float | None = None) -> float | None:
    try:
        number = float(value)
        return number if number == number and number is not None else default  # noqa: E711
    except (TypeError, ValueError):
        return default


def as_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes"}:
            return True
        if normalized in {"0", "false", "no", ""}:
            return False
    return default


# ---------------------------------------------------------------------------
# Auth plumbing (shared across bots)
# ---------------------------------------------------------------------------

async def get_ws_url_via_bridge() -> str:
    url = f"{BRIDGE_URL}/api/deriv/bot-session?type={ACCOUNT_TYPE}"
    async with aiohttp.ClientSession() as session:
        async with session.get(url, timeout=15) as response:
            data = await response.json()
            if response.status != 200:
                raise RuntimeError(f"bridge error: {data}")
            return data["url"]


async def get_accounts() -> dict[str, Any] | list[dict[str, Any]]:
    url = f"{REST_BASE_URL}/trading/v1/options/accounts"
    headers = {
        "Authorization": f"Bearer {PAT_TOKEN}",
        "Deriv-App-ID": APP_ID,
        "Content-Type": "application/json",
    }
    async with aiohttp.ClientSession() as session:
        async with session.get(url, headers=headers, timeout=15) as response:
            data = await response.json()
            if response.status != 200:
                raise RuntimeError(f"account lookup failed: {data}")
            return data


def select_account(accounts_data: dict[str, Any] | list[dict[str, Any]] | None) -> str | None:
    d = accounts_data.get("data") if isinstance(accounts_data, dict) else accounts_data
    if isinstance(d, dict) and "accounts" in d:
        accounts = d["accounts"]
    elif isinstance(d, list):
        accounts = d
    else:
        accounts = []
    if not accounts:
        return None
    for acc in accounts:
        acc_id = (
            acc.get("account_id")
            or acc.get("accountId")
            or acc.get("id")
            or acc.get("loginid")
        )
        is_virtual = (
            bool(acc.get("is_virtual") or acc.get("isVirtual"))
            or (acc.get("account_type") == "demo")
            or str(acc_id).startswith(("VR", "DOT"))
        )
        if (ACCOUNT_TYPE == "demo" and is_virtual) or (ACCOUNT_TYPE == "real" and not is_virtual):
            return acc_id
    # In prior bots the fallback only returned a same-type account when one was
    # explicitly found; when nothing matched, selection failed closed.
    for acc in accounts:
        acc_id = (
            acc.get("account_id")
            or acc.get("accountId")
            or acc.get("id")
            or acc.get("loginid")
        )
        is_virtual = (
            bool(acc.get("is_virtual") or acc.get("isVirtual"))
            or (acc.get("account_type") == "demo")
            or str(acc_id).startswith(("VR", "DOT"))
        )
        if is_virtual and ACCOUNT_TYPE == "demo":
            return acc_id
        if (not is_virtual) and ACCOUNT_TYPE == "real":
            return acc_id
    return None


async def get_otp_url(account_id: str) -> str:
    url = f"{REST_BASE_URL}/trading/v1/options/accounts/{account_id}/otp"
    headers = {
        "Authorization": f"Bearer {PAT_TOKEN}",
        "Deriv-App-ID": APP_ID,
        "Content-Type": "application/json",
    }
    async with aiohttp.ClientSession() as session:
        async with session.post(url, headers=headers, json={}, timeout=15) as response:
            data = await response.json()
            if response.status != 200:
                raise RuntimeError(f"OTP request failed: {data}")
            payload = data.get("data", data)
            if isinstance(payload, dict):
                ws_url = payload.get("url") or payload.get("otpUrl")
            else:
                ws_url = None
            if not ws_url:
                raise RuntimeError(f"OTP response did not include a WebSocket URL: {data}")
            return ws_url


async def get_ws_url() -> str:
    if USE_BRIDGE:
        try:
            return await get_ws_url_via_bridge()
        except Exception as error:
            print(f"[DerivClient] bridge failed: {error}")
            if not PAT_TOKEN:
                raise
    accounts = await get_accounts()
    account_id = select_account(accounts)
    if not account_id:
        raise RuntimeError(f"no {ACCOUNT_TYPE} account found")
    print(f"[DerivClient] account={account_id} type={ACCOUNT_TYPE}")
    return await get_otp_url(account_id)


# ---------------------------------------------------------------------------
# Shared WebSocket client
# ---------------------------------------------------------------------------


class DerivClient:
    """Shared Deriv Core v3 WebSocket lifecycle.

    Usage::

        client = DerivClient(symbol="R_25", contract_types={"ACCU"})
        async with client.connect() as ws:
            await client.subscribe(ws)
            await client.run(ws, handle_tick=..., handle_message=...)

    The bot layer is responsible for:

    * deciding when to request proposals and sell contracts
    * maintaining its own bot-specific state (active contract, quote history,
      logbook, filter state, etc.)
    """

    def __init__(
        self,
        symbol: str | None = None,
        contract_types: set[str] | None = None,
        *,
        symbols: list[str] | None = None,
        probe_contracts: bool = False,
        subscribe_portfolio: bool = False,
        parse_float: Callable[[str], Any] | None = None,
        max_reconnects: int | None = MAX_RECONNECT_ATTEMPTS,
        on_error: Callable[[dict[str, Any]], None] | None = None,
        on_balance: Callable[[float], None] | None = None,
        on_portfolio: Callable[[dict[str, Any]], None] | None = None,
        on_proposal_open_contract_subscription: Callable[[dict[str, Any]], None] | None = None,
    ) -> None:
        if symbol is None and not symbols:
            raise ValueError("DerivClient requires symbol or symbols")
        self.symbols = [
            s.strip() for s in (symbols if symbols is not None else [symbol]) if s and s.strip()
        ]
        if not self.symbols:
            raise ValueError("DerivClient requires at least one symbol")
        self.symbol = self.symbols[0]
        self.contract_types = {ct.upper() for ct in (contract_types or {"ACCU"})}
        # contracts_for probing and the portfolio snapshot come from the
        # accumulator flow; simple tick bots opt out.
        self.probe_contracts = probe_contracts
        self.subscribe_portfolio = subscribe_portfolio
        # Optional json.loads(parse_float=...) hook so digit-accurate bots can
        # preserve each quote's exact wire string.
        self.parse_float = parse_float
        # None means reconnect forever (the historical bot behaviour).
        self.max_reconnects = max_reconnects
        self.on_error = on_error
        self.on_balance = on_balance
        self.on_portfolio = on_portfolio
        self.on_proposal_open_contract_subscription = on_proposal_open_contract_subscription
        self._request_id = 1000
        self._active_contract_id: str | None = None
        self._ws_url: str | None = None
        self._reconnect_count = 0

    def next_req_id(self) -> int:
        self._request_id += 1
        return self._request_id

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    async def authorize_if_needed(self, ws: websockets.WebSocketClientProtocol) -> None:
        if PAT_TOKEN and ("binaryws.com" in self._ws_url or "otp" not in self._ws_url):
            await ws.send(json.dumps({"authorize": PAT_TOKEN, "req_id": self.next_req_id()}))
            response = json.loads(await asyncio.wait_for(ws.recv(), timeout=15))
            if response.get("error"):
                raise RuntimeError(f"authorize failed: {response['error']}")
            print("[DerivClient] WebSocket authorized")

    # ------------------------------------------------------------------
    # Market metadata
    # ------------------------------------------------------------------

    async def request_contracts_for(self, ws: websockets.WebSocketClientProtocol) -> None:
        req_id = self.next_req_id()
        await ws.send(json.dumps({"contracts_for": self.symbol, "req_id": req_id}))
        deadline = time.time() + 15
        while time.time() < deadline:
            response = json.loads(await asyncio.wait_for(ws.recv(), timeout=15))
            if response.get("error"):
                raise RuntimeError(f"contracts_for failed: {response['error']}")
            if response.get("msg_type") == "contracts_for" or response.get("req_id") == req_id:
                payload = response.get("contracts_for", response)
                text = json.dumps(payload).upper()
                if not any(ct in text for ct in self.contract_types):
                    raise RuntimeError(
                        f"{self.symbol} did not advertise any of {sorted(self.contract_types)} in contracts_for"
                    )
                print(
                    f"[DerivClient] {self.symbol} advertises "
                    f"{', '.join(sorted(self.contract_types))} support | position depends on contract type"
                )
                return
        raise TimeoutError("contracts_for timed out")

    # ------------------------------------------------------------------
    # Subscription
    # ------------------------------------------------------------------

    async def subscribe(self, ws: websockets.WebSocketClientProtocol) -> str | None:
        await self.authorize_if_needed(ws)
        if self.probe_contracts:
            await self.request_contracts_for(ws)
        if self.subscribe_portfolio:
            await ws.send(json.dumps({"portfolio": 1, "req_id": self.next_req_id()}))
        for sym in self.symbols:
            await ws.send(json.dumps({"ticks": sym, "subscribe": 1, "req_id": self.next_req_id()}))
        await ws.send(json.dumps({"balance": 1, "subscribe": 1, "req_id": self.next_req_id()}))
        if self._active_contract_id:
            await self.subscribe_open_contract(ws, self._active_contract_id)
        print(f"[DerivClient] subscribed to {', '.join(self.symbols)}")
        return self._ws_url

    # ------------------------------------------------------------------
    # Proposal / buy / open-contract / sell helpers
    # ------------------------------------------------------------------

    async def request_proposal(
        self,
        ws: websockets.WebSocketClientProtocol,
        *,
        contract_type: str,
        amount: float,
        basis: str = "stake",
        currency: str = "USD",
        duration: int = 1,
        duration_unit: str = "t",
        growth_rate: float | None = None,
        barrier: str | None = None,
        underlying_symbol: str | None = None,
        limit_order: dict[str, Any] | None = None,
        req_id: int | None = None,
    ) -> None:
        request: dict[str, Any] = {
            "proposal": 1,
            "req_id": req_id or self.next_req_id(),
            "amount": amount,
            "basis": basis,
            "contract_type": contract_type,
            "currency": currency,
            "duration": duration,
            "duration_unit": duration_unit,
        }
        if growth_rate is not None:
            request["growth_rate"] = growth_rate
        if barrier is not None:
            request["barrier"] = barrier
        if underlying_symbol is not None:
            request["underlying_symbol"] = underlying_symbol
        if limit_order is not None:
            request["limit_order"] = limit_order
        await ws.send(json.dumps(request))

    async def buy(
        self,
        ws: websockets.WebSocketClientProtocol,
        proposal_id: str,
        price: float,
        req_id: int | None = None,
    ) -> None:
        await ws.send(
            json.dumps(
                {
                    "buy": proposal_id,
                    "price": price,
                    "req_id": req_id or self.next_req_id(),
                }
            )
        )

    async def sell(
        self,
        ws: websockets.WebSocketClientProtocol,
        contract_id: str,
        price: float = 0,
        req_id: int | None = None,
    ) -> None:
        await ws.send(
            json.dumps(
                {
                    "sell": contract_id,
                    "price": price,
                    "req_id": req_id or self.next_req_id(),
                }
            )
        )

    async def subscribe_open_contract(
        self,
        ws: websockets.WebSocketClientProtocol,
        contract_id: str,
        req_id: int | None = None,
    ) -> None:
        await ws.send(
            json.dumps(
                {
                    "proposal_open_contract": 1,
                    "contract_id": contract_id,
                    "subscribe": 1,
                    "req_id": req_id or self.next_req_id(),
                }
            )
        )

    async def forget(self, ws: websockets.WebSocketClientProtocol, subscription_id: str) -> None:
        await ws.send(json.dumps({"forget": subscription_id, "req_id": self.next_req_id()}))

    # ------------------------------------------------------------------
    # Keepalive
    # ------------------------------------------------------------------

    async def keepalive(
        self, ws: websockets.WebSocketClientProtocol
    ) -> None:
        failures = 0
        while True:
            await asyncio.sleep(PING_INTERVAL)
            try:
                await ws.send(json.dumps({"ping": 1, "req_id": self.next_req_id()}))
                failures = 0
            except asyncio.CancelledError:
                raise
            except Exception as error:
                failures += 1
                print(f"[DerivClient] ping failed {failures}/3: {error}")
                if failures >= 3:
                    await ws.close()
                    return

    # ------------------------------------------------------------------
    # Main loop
    # ------------------------------------------------------------------

    async def run(
        self,
        *,
        handle_message: Callable[
            ["websockets.WebSocketClientProtocol", dict[str, Any]], Any
        ],
        handle_tick: Callable[
            ["websockets.WebSocketClientProtocol", dict[str, Any]], Any
        ] | None = None,
        pre_subscribe: Callable[["websockets.WebSocketClientProtocol"], Any] | None = None,
    ) -> None:
        """Run the shared reconnect + message-dispatch loop.

        *handle_message* receives the raw decoded JSON payload for every
        non-tick message and is expected to route proposal/buy/poc/balance
        updates internally. *handle_tick* is optional; when provided, tick
        payloads are forwarded to it instead of *handle_message*.
        """
        attempts = 0
        while self.max_reconnects is None or attempts < self.max_reconnects:
            try:
                await self._run_one_session(handle_message, handle_tick, pre_subscribe)
                attempts += 1
            except asyncio.CancelledError:
                raise
            except Exception as error:
                attempts += 1
                delay = min(RECONNECT_BASE_DELAY * (2 ** (attempts - 1)), 60)
                print(f"[DerivClient] {error}")
                if self.max_reconnects is not None and attempts >= self.max_reconnects:
                    raise
                label = self.max_reconnects if self.max_reconnects is not None else "∞"
                print(f"[DerivClient] reconnecting in {delay}s ({attempts}/{label})")
                await asyncio.sleep(delay)

    async def _run_one_session(
        self,
        handle_message: Callable[
            ["websockets.WebSocketClientProtocol", dict[str, Any]], Any
        ],
        handle_tick: Callable[
            ["websockets.WebSocketClientProtocol", dict[str, Any]], Any
        ] | None,
        pre_subscribe: Callable[["websockets.WebSocketClientProtocol"], Any] | None,
    ) -> None:
        self._ws_url = await get_ws_url()
        async with websockets.connect(
            self._ws_url, ping_interval=None, ping_timeout=None
        ) as ws:
            await self.subscribe(ws)
            if pre_subscribe is not None:
                await pre_subscribe(ws)
            keepalive_task = asyncio.create_task(self.keepalive(ws))
            try:
                async for raw in ws:
                    data = json.loads(raw, parse_float=self.parse_float)
                    if data.get("error") and not data.get("msg_type"):
                        # Standalone errors have no request type for the bot to
                        # route; typed errors (proposal/buy responses carrying
                        # an "error" key) flow through handle_message so the
                        # bot can mark the right pending trade as failed.
                        if self.on_error:
                            self.on_error(data)
                        else:
                            print(f"[DerivClient] API ERROR: {data.get('error')}")
                        continue
                    msg_type = data.get("msg_type")
                    if msg_type == "tick":
                        subscription = data.get("subscription")
                        if isinstance(subscription, dict):
                            self._tick_subscription_id = subscription.get("id")
                        elif subscription:
                            self._tick_subscription_id = str(subscription)
                        if handle_tick is not None:
                            await handle_tick(ws, data.get("tick", {}))
                        else:
                            await handle_message(ws, data.get("tick", {}))
                    elif msg_type == "balance" and self.on_balance is not None:
                        balance = as_float((data.get("balance") or {}).get("balance"))
                        if balance is not None:
                            self.on_balance(balance)
                    elif msg_type == "ping":
                        # The derivws endpoint answers OUR {"ping": 1} with a
                        # ping carrying echo_req; replying to that draws an
                        # UnrecognisedRequest error. Only an unsolicited server
                        # ping (no echo_req) needs a pong.
                        if "echo_req" not in data:
                            await ws.send(json.dumps({"pong": 1}))
                        continue
                    else:
                        await handle_message(ws, data)
            finally:
                keepalive_task.cancel()
                try:
                    await keepalive_task
                except asyncio.CancelledError:
                    pass

    # ------------------------------------------------------------------
    # Active-contract bookkeeping (shared sell path)
    # ------------------------------------------------------------------

    @property
    def active_contract_id(self) -> str | None:
        return self._active_contract_id

    def set_active_contract_id(self, contract_id: str | None) -> None:
        self._active_contract_id = contract_id
