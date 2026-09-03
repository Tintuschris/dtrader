"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getGlobalScanner,
  SCANNER_MARKETS,
  SCANNER_LOOKBACK_OPTIONS,
  SCANNER_DEFAULT_LOOKBACK,
  SCANNER_THRESHOLD_PCT,
  SCANNER_DANGER_THRESHOLDS,
  type MarketSignal,
  type ScannerStatus,
  type ScannerSymbolStatus,
  type TradeSuggestion,
  type RuleKey,
  type RuleTrack,
} from "../lib/market-scanner";
import { timeAgo } from "../lib/format-utils";
import { pushNotification } from "./notification-system";
import { loadNotificationSettings } from "../lib/notification-store";

/* ------------------------------------------------------------------ */
/*  Constants & helpers                                                */
/* ------------------------------------------------------------------ */

const POS_KEY = "freebuff_scanner_pos";
const LOOKBACK_KEY = "freebuff_scanner_lookback";
const ALERTS_KEY = "freebuff_scanner_alerts";
const ALERT_COOLDOWN_MS = 60_000;
const ALERT_BATCH_MS = 1200;
const PILL_H = 46; // used until the real pill is measured

type Pos = { x: number; y: number };

const EMPTY_STATUS: ScannerStatus = {
  state: "connecting",
  reconnectAttempt: 0,
  connectedAt: null,
  lastCloseAt: null,
  lastCloseCode: null,
};

function loadPos(): Pos | null {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Pos;
    if (typeof p?.x === "number" && typeof p?.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      return p;
    }
  } catch { /* corrupted — fall through to default */ }
  return null;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), Math.max(min, max));
}

function statusLabel(status: ScannerStatus): { text: string; cls: string } {
  switch (status.state) {
    case "live":
      return { text: "LIVE", cls: "live" };
    case "connecting":
      return { text: "CONNECTING", cls: "connecting" };
    case "reconnecting":
      return {
        text: status.reconnectAttempt > 0 ? `RECONNECTING · ${status.reconnectAttempt}` : "RECONNECTING",
        cls: "reconnecting",
      };
    case "failed":
      return { text: "OFFLINE", cls: "failed" };
  }
}

function pct1(v: number | undefined): string {
  return `${(v ?? 0).toFixed(1)}%`;
}

function playScannerChime(): void {
  if (typeof window === "undefined" || document.visibilityState === "hidden") return;
  try {
    if (!loadNotificationSettings(window.localStorage).soundEnabled) return;
    const AudioContextCtor = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;
    const ctx = new AudioContextCtor();
    const start = () => {
      const now = ctx.currentTime;
      for (const [frequency, offset] of [[660, 0], [880, 0.12]] as const) {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0.0001, now + offset);
        gain.gain.exponentialRampToValueAtTime(0.12, now + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.18);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(now + offset);
        oscillator.stop(now + offset + 0.2);
      }
      window.setTimeout(() => void ctx.close(), 500);
    };
    if (ctx.state === "suspended") void ctx.resume().then(start).catch(() => void ctx.close());
    else start();
  } catch { /* audio is optional and may be blocked by the browser */ }
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

/**
 * Floating, always-visible scanner that tells the user which Volatility 1s
 * market to trade. One-click "Trade" loads the exact market + contract into
 * the terminal via the onTrade prop.
 */
export default function MarketScannerWidget({
  onTrade,
}: {
  onTrade?: (s: TradeSuggestion) => void;
}) {
  const [signals, setSignals] = useState<MarketSignal[]>([]);
  const [tracks, setTracks] = useState<Map<string, Map<RuleKey, RuleTrack>>>(new Map());
  const [thresholds, setThresholds] = useState<Map<string, number>>(new Map());
  const [alertsEnabled, setAlertsEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    const saved = localStorage.getItem(ALERTS_KEY);
    return saved === null ? true : saved === "1";
  });
  const alertBaselineRef = useRef(false);
  const openRef = useRef(false);
  const previousQualifyingRef = useRef<Set<string>>(new Set());
  const suppressedWhileOpenRef = useRef<Set<string>>(new Set());
  const alertTimesRef = useRef<Map<string, number>>(new Map());
  const pendingAlertsRef = useRef<Map<string, string>>(new Map());
  const pendingAlertActionsRef = useRef<Map<string, { symbol: string; rule: RuleKey }>>(new Map());
  const alertBatchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [status, setStatus] = useState<ScannerStatus>(EMPTY_STATUS);
  const [symbolStatuses, setSymbolStatuses] = useState<Map<string, ScannerSymbolStatus>>(new Map());
  const [lookback, setLookback] = useState<number>(() => {
    if (typeof window === "undefined") return SCANNER_DEFAULT_LOOKBACK;
    const saved = Number(localStorage.getItem(LOOKBACK_KEY));
    return (SCANNER_LOOKBACK_OPTIONS as readonly number[]).includes(saved)
      ? saved
      : SCANNER_DEFAULT_LOOKBACK;
  });

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<Pos | null>(null);
  const [vp, setVp] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [isMobile, setIsMobile] = useState(false);

  const pillRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number; moved: boolean } | null>(null);

  /* ---- live subscriptions to the shared scanner ---- */
  useEffect(() => {
    const scanner = getGlobalScanner();
    scanner.start();
    const unsubData = scanner.onUpdate(() => {
      setSignals(scanner.getSignals());
      setTracks(new Map(scanner.getTracks()));
      setThresholds(new Map(SCANNER_MARKETS.map((m) => [m.symbol, scanner.getDangerThreshold(m.symbol)])));
    });
    const unsubStatus = scanner.onStatus(() => {
      setStatus(scanner.getStatus());
      setSymbolStatuses(scanner.getSymbolStatuses());
    });
    setSignals(scanner.getSignals());
    setTracks(new Map(scanner.getTracks()));
    setThresholds(new Map(SCANNER_MARKETS.map((m) => [m.symbol, scanner.getDangerThreshold(m.symbol)])));
    setStatus(scanner.getStatus());
    setSymbolStatuses(scanner.getSymbolStatuses());
    return () => {
      unsubData();
      unsubStatus();
    };
  }, []);

  /* ---- rising-edge qualification alerts ---- */
  useEffect(() => {
    const wasOpen = openRef.current;
    openRef.current = open;
    const qualifying = new Set<string>();
    for (const signal of signals) {
      if (signal.under8) qualifying.add(`${signal.symbol}:under8`);
      if (signal.over1) qualifying.add(`${signal.symbol}:over1`);
    }
    if (!alertBaselineRef.current) {
      alertBaselineRef.current = true;
      previousQualifyingRef.current = qualifying;
      return;
    }
    const now = Date.now();
    const queueAlert = (key: string, signal: MarketSignal) => {
      const lastAlertAt = alertTimesRef.current.get(key) ?? 0;
      if (now - lastAlertAt < ALERT_COOLDOWN_MS) return;
      const [symbol, rule] = key.split(":") as [string, RuleKey];
      alertTimesRef.current.set(key, now);
      const under = rule === "under8";
      pendingAlertsRef.current.set(
        key,
        `${under ? "Under 8" : "Over 1"} · ${symbol} (${under
          ? `8 ${pct1(signal.under8Freq.d8)}, 9 ${pct1(signal.under8Freq.d9)}`
          : `0 ${pct1(signal.over1Freq.d0)}, 1 ${pct1(signal.over1Freq.d1)}`})`,
      );
      pendingAlertActionsRef.current.set(key, { symbol, rule });
      if (!alertBatchTimerRef.current) {
        alertBatchTimerRef.current = setTimeout(() => {
          alertBatchTimerRef.current = null;
          const entries = Array.from(pendingAlertsRef.current.values());
          const firstAction = pendingAlertActionsRef.current.values().next().value as { symbol: string; rule: RuleKey } | undefined;
          const pendingKeys = Array.from(pendingAlertsRef.current.keys());
          pendingAlertsRef.current.clear();
          pendingAlertActionsRef.current.clear();
          if (entries.length === 0) return;
          if (openRef.current) {
            for (const key of pendingKeys) suppressedWhileOpenRef.current.add(key);
            return;
          }
          const visibleEntries = entries.length > 4
            ? `${entries.slice(0, 4).join(" · ")} · +${entries.length - 4} more`
            : entries.join(" · ");
          pushNotification({
            type: "alert",
            severity: "success",
            title: `Scanner · ${entries.length} new signal${entries.length === 1 ? "" : "s"}`,
            message: `${visibleEntries} — ready to trade.`,
            action: firstAction ? { type: "scanner-trade", ...firstAction } : undefined,
          });
          playScannerChime();
        }, ALERT_BATCH_MS);
      }
    };
    for (const key of qualifying) {
      if (previousQualifyingRef.current.has(key)) continue;
      const [symbol] = key.split(":");
      const actualSignal = signals.find((s) => s.symbol === symbol);
      if (!actualSignal || !alertsEnabled) continue;
      if (openRef.current) suppressedWhileOpenRef.current.add(key);
      else queueAlert(key, actualSignal);
    }
    if (wasOpen && !openRef.current && alertsEnabled) {
      for (const key of suppressedWhileOpenRef.current) {
        if (!qualifying.has(key)) continue;
        const [symbol] = key.split(":");
        const signal = signals.find((s) => s.symbol === symbol);
        if (signal) queueAlert(key, signal);
      }
      suppressedWhileOpenRef.current.clear();
    }
    previousQualifyingRef.current = qualifying;
  }, [signals, alertsEnabled, open]);

  useEffect(() => () => {
    if (alertBatchTimerRef.current) clearTimeout(alertBatchTimerRef.current);
  }, []);

  /* ---- actionable scanner toast clicks ---- */
  useEffect(() => {
    const onScannerTrade = (event: Event) => {
      const detail = (event as CustomEvent<{ symbol?: string; rule?: RuleKey }>).detail;
      const market = SCANNER_MARKETS.find((m) => m.symbol === detail?.symbol);
      if (!market || (detail?.rule !== "under8" && detail?.rule !== "over1") || !onTrade) return;
      onTrade({
        symbol: market.symbol,
        name: market.name,
        subContract: detail.rule === "under8" ? "under" : "over",
        digit: detail.rule === "under8" ? 8 : 1,
        strength: 0,
      });
      setOpen(false);
    };
    window.addEventListener("dtrader:scanner-trade", onScannerTrade);
    return () => window.removeEventListener("dtrader:scanner-trade", onScannerTrade);
  }, [onTrade]);

  const toggleAlerts = () => {
    setAlertsEnabled((enabled) => {
      const next = !enabled;
      try { localStorage.setItem(ALERTS_KEY, next ? "1" : "0"); } catch { /* ignore */ }
      return next;
    });
  };

  /* ---- lookback changes hit the engine immediately + persist ---- */
  useEffect(() => {
    getGlobalScanner().setLookback(lookback);
    try {
      localStorage.setItem(LOOKBACK_KEY, String(lookback));
    } catch { /* ignore */ }
  }, [lookback]);

  /* ---- viewport + mobile tracking ---- */
  useEffect(() => {
    const measure = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    const mq = window.matchMedia("(max-width: 900px)"); // app's compact/bottom-nav breakpoint
    const updateMobile = () => setIsMobile(mq.matches);
    updateMobile();
    mq.addEventListener("change", updateMobile);
    return () => {
      window.removeEventListener("resize", measure);
      mq.removeEventListener("change", updateMobile);
    };
  }, []);

  /* ---- default / restored position, clamped to the viewport ---- */
  useEffect(() => {
    if (vp.w === 0) return;
    setPos((prev) => {
      const saved = prev ?? loadPos();
      if (saved) {
        return {
          x: clamp(saved.x, 8, Math.max(8, vp.w - 150)),
          y: clamp(saved.y, 8, Math.max(8, vp.h - PILL_H - 8)),
        };
      }
      const pillW = pillRef.current?.offsetWidth ?? 262;
      return {
        x: Math.max(8, vp.w - pillW - 16),
        y: vp.h - PILL_H - (isMobile ? 90 : 16), // clear the mobile bottom nav
      };
    });
  }, [vp, isMobile]);

  /* ---- Escape closes the panel ---- */
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  /* ---- derived data ---- */
  const suggestions = useMemo(
    () => {
      // reuse the exported ranker semantics inline so BEST chip matches order
      const out: TradeSuggestion[] = [];
      for (const s of signals) {
        if (s.under8) {
          out.push({
            symbol: s.symbol,
            name: s.name,
            subContract: "under",
            digit: 8,
            strength: Math.min((s.thresholdPct ?? SCANNER_THRESHOLD_PCT) - s.under8Freq.d8, (s.thresholdPct ?? SCANNER_THRESHOLD_PCT) - s.under8Freq.d9),
          });
        }
        if (s.over1) {
          out.push({
            symbol: s.symbol,
            name: s.name,
            subContract: "over",
            digit: 1,
            strength: Math.min((s.thresholdPct ?? SCANNER_THRESHOLD_PCT) - s.over1Freq.d0, (s.thresholdPct ?? SCANNER_THRESHOLD_PCT) - s.over1Freq.d1),
          });
        }
      }
      return out.sort((a, b) => b.strength - a.strength);
    },
    [signals],
  );
  const top = suggestions[0] ?? null;
  const label = statusLabel(status);

  /* ---- drag / click handling on the pill ---- */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const pill = pillRef.current;
    if (!pill) return;
    pill.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: pos?.x ?? 0,
      baseY: pos?.y ?? 0,
      moved: false,
    };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    const pill = pillRef.current;
    if (!drag || !pill) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    const pw = pill.offsetWidth;
    const ph = pill.offsetHeight;
    const nx = clamp(drag.baseX + dx, 8, Math.max(8, window.innerWidth - pw - 8));
    const ny = clamp(drag.baseY + dy, 8, Math.max(8, window.innerHeight - ph - 8));
    pill.style.left = `${nx}px`;
    pill.style.top = `${ny}px`;
    pill.style.right = "auto";
    pill.style.bottom = "auto";
    dragRef.current = { ...drag, baseX: nx, baseY: ny };
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    dragRef.current = null;
    const pill = pillRef.current;
    if (!drag || !pill) return;
    try { pill.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!drag.moved) {
      setOpen((v) => !v);
      return;
    }
    const nx = clamp(pill.offsetLeft, 8, Math.max(8, window.innerWidth - pill.offsetWidth - 8));
    const ny = clamp(pill.offsetTop, 8, Math.max(8, window.innerHeight - pill.offsetHeight - 8));
    const next = { x: nx, y: ny };
    setPos(next);
    pill.style.left = `${nx}px`;
    pill.style.top = `${ny}px`;
    try {
      localStorage.setItem(POS_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
  };

  /* ---- panel geometry (above the pill on desktop; sheet on mobile) ---- */
  const pillW = pillRef.current?.offsetWidth ?? 262;
  const pillH = pillRef.current?.offsetHeight ?? PILL_H;
  const panelLeft = clamp((pos?.x ?? vp.w - 270) + pillW - 384, 8, Math.max(8, vp.w - 392));
  const aboveSpace = (pos?.y ?? 0) - 24;
  const belowSpace = vp.h - (pos?.y ?? 0) - pillH - 24;
  const openUp = isMobile || aboveSpace >= 320 || aboveSpace >= belowSpace;
  const panelStyle: React.CSSProperties = isMobile
    ? {
        left: 8,
        right: 8,
        bottom: 84, // bottom sheet floating above the mobile bottom nav
        width: undefined,
        maxHeight: Math.max(200, vp.h - 170),
      }
    : openUp
      ? {
          left: panelLeft,
          bottom: Math.max(8, vp.h - (pos?.y ?? 0) + 12),
          maxHeight: Math.max(180, Math.min(560, aboveSpace)),
          width: 384,
        }
      : {
          left: panelLeft,
          top: (pos?.y ?? 0) + pillH + 12,
          maxHeight: Math.max(180, Math.min(560, belowSpace)),
          width: 384,
        };

  return (
    <>
      {/* Collapsed / expanded pill */}
      <div
        ref={pillRef}
        className={`scanner-pill ${open ? "open" : ""} ${top ? "has-signal" : ""} ${status.state}`}
        style={
          pos
            ? { left: `${pos.x}px`, top: `${pos.y}px`, right: undefined, bottom: undefined }
            : isMobile
              ? { right: 12, bottom: 90 }
              : { right: 16, bottom: 16 }
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={() => { dragRef.current = null; }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label="Volatility market scanner — click to open suggestions"
        title="Click to open the market scanner"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
      >
        <span className={`scanner-pill-dot ${label.cls}`} />
        <span className="scanner-pill-label">SCANNER</span>
        {top ? (
          <span className="scanner-pill-sig">
            <b>{top.symbol}</b> · {top.subContract === "under" ? "UNDER" : "OVER"} {top.digit}
          </span>
        ) : (
          <span className="scanner-pill-sig waiting">monitoring…</span>
        )}
        {suggestions.length > 0 && <span className="scanner-pill-count">{suggestions.length}</span>}
        <span className="scanner-pill-grip">⠿</span>
      </div>

      {/* Backdrop + panel */}
      {open && (
        <>
          <div className="scanner-backdrop" onClick={() => setOpen(false)} />
          <div className="scanner-panel" style={panelStyle} role="dialog" aria-label="Market scanner suggestions">
            <div className="scanner-panel-head">
              <div>
                <p className="scanner-eyebrow">MARKET SCANNER</p>
                <h4>Where to trade</h4>
              </div>
              <div className="scanner-head-right">
                <span className={`scanner-status-badge ${label.cls}`}>
                  <i /> {label.text}
                </span>
                <button
                  className={`scanner-alert-btn ${alertsEnabled ? "enabled" : "muted"}`}
                  onClick={toggleAlerts}
                  aria-label={alertsEnabled ? "Mute scanner alerts" : "Enable scanner alerts"}
                  aria-pressed={alertsEnabled}
                  title={alertsEnabled ? "Mute qualification alerts" : "Enable qualification alerts"}
                >
                  {alertsEnabled ? "🔔" : "🔕"}
                </button>
                <button className="scanner-close" onClick={() => setOpen(false)} aria-label="Close scanner">×</button>
              </div>
            </div>

            <p className="scanner-rule">
              <b>UNDER 8</b> and <b>OVER 1</b> use each market&apos;s selected danger-digit threshold — exact, from live ticks.
            </p>

            <div className="scanner-toolbar">
              <span className="scanner-toolbar-label">Window</span>
              <div className="scanner-lookback">
                {SCANNER_LOOKBACK_OPTIONS.map((n) => (
                  <button
                    key={n}
                    className={lookback === n ? "active" : ""}
                    onClick={() => setLookback(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <span className="scanner-ticks-note">ticks</span>
            </div>

            <div className="scanner-list">
              {SCANNER_MARKETS.map((m) => {
                const sig = signals.find((s) => s.symbol === m.symbol);
                const threshold = thresholds.get(m.symbol) ?? sig?.thresholdPct ?? SCANNER_THRESHOLD_PCT;
                const marketTracks = tracks.get(m.symbol);
                const trackLine = (rule: RuleKey) => {
                  const track = marketTracks?.get(rule);
                  if (!track || track.bets === 0) return null;
                  let streak = 0;
                  for (let i = track.recent.length - 1; i >= 0 && track.recent[i].win; i--) streak++;
                  const last = track.recent[track.recent.length - 1];
                  const rate = (track.wins / track.bets) * 100;
                  return (
                    <div
                      className={`scanner-track ${rate >= 80 ? "positive" : "negative"}`}
                      title={`Best recent streak: ${Math.max(...track.recent.reduce<number[]>((runs, r) => {
                        const previous = runs[runs.length - 1] ?? 0;
                        runs.push(r.win ? previous + 1 : 0);
                        return runs;
                      }, []), 0)} · Last result: ${last.win ? "win" : "loss"} at ${new Date(last.at).toLocaleTimeString()}`}
                    >
                      <span>✓ {rate.toFixed(0)}% · {track.wins}/{track.bets} · streak {streak}</span>
                      <span className="scanner-track-dots" aria-label="Last 12 results">
                        {track.recent.slice(-12).map((result, index) => (
                          <i key={`${result.at}-${index}`} className={result.win ? "win" : "loss"}>•</i>
                        ))}
                      </span>
                    </div>
                  );
                };
                const symStatus = symbolStatuses.get(m.symbol) ?? "connecting";
                const maxFreq = sig && sig.ticks > 0
                  ? Math.max(...sig.digits.map((d) => d.freq), 11)
                  : 11;
                const barH = (freq: number) => (freq / maxFreq) * 100;
                const isTop =
                  top !== null && (top.symbol === m.symbol);
                return (
                  <div key={m.symbol} className={`scanner-mkt ${isTop && top ? "best" : ""}`}>
                    <div className="scanner-mkt-head">
                      <span className={`scanner-mkt-dot ${symStatus}`} />
                      <div className="scanner-mkt-id">
                        <strong>{m.name}</strong>
                        <span>
                          {m.symbol} · {sig ? `${sig.ticks}/${lookback} ticks` : "loading ticks…"}
                          {sig?.lastQuote !== null && sig?.lastQuote !== undefined
                            ? ` · ${sig.lastQuote.toFixed(2)}`
                            : ""}
                        </span>
                      </div>
                      <div className="scanner-mkt-right">
                        <label className="scanner-threshold-label" title="Danger digits must be below this percentage">
                          <span>below</span>
                          <select
                            className="scanner-threshold-select"
                            value={threshold}
                            aria-label={`${m.symbol} danger-digit threshold`}
                            onChange={(event) => {
                              const value = Number(event.target.value) as (typeof SCANNER_DANGER_THRESHOLDS)[number];
                              getGlobalScanner().setDangerThreshold(m.symbol, value);
                              setThresholds((previous) => new Map(previous).set(m.symbol, value));
                            }}
                          >
                            {SCANNER_DANGER_THRESHOLDS.map((value) => <option key={value} value={value}>{value}%</option>)}
                          </select>
                        </label>
                        {isTop && <span className="scanner-best-chip">BEST</span>}
                        <span className="scanner-lastdigit" title="Latest tick digit">
                          {sig?.lastDigit ?? "–"}
                        </span>
                      </div>
                    </div>

                    {/* Digit frequency bars */}
                    {sig && sig.ticks > 0 && (
                      <div className="scanner-bars" aria-hidden>
                        <div className="scanner-bars-ref" style={{ bottom: `${barH(threshold)}%` }} />
                        {sig.digits.map((d) => {
                          const danger = d.digit === 0 || d.digit === 1 || d.digit === 8 || d.digit === 9;
                          const ok = (d.digit === 8 || d.digit === 9)
                            ? sig.under8 && d.freq < SCANNER_THRESHOLD_PCT
                            : d.digit === 0 || d.digit === 1
                              ? sig.over1 && d.freq < SCANNER_THRESHOLD_PCT
                              : false;
                          return (
                            <div key={d.digit} className="scanner-bar-col" title={`Digit ${d.digit}: ${d.freq.toFixed(1)}% (${d.count}/${sig.ticks} ticks)`}>
                              <div
                                className={`scanner-bar ${danger ? "danger" : ""} ${ok ? "ok" : ""}`}
                                style={{ height: `${Math.max(barH(d.freq), d.freq > 0 ? 3 : 1)}%` }}
                              />
                              <span className="scanner-bar-digit">{d.digit}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {sig && sig.ticks === 0 && (
                      <div className="scanner-mkt-empty">waiting for ticks…</div>
                    )}

                    {/* Condition rows */}
                    <div className="scanner-cols">
                      <div className={`scanner-cond ${sig?.under8 ? "ok" : ""}`}>
                        <div className="scanner-cond-top">
                          <span className="scanner-cond-badge">UNDER 8</span>
                          <span className="scanner-cond-pct" title={`8 appeared ${sig ? sig.digits[8].count : 0}/${sig?.ticks ?? lookback} ticks`}>
                            8: {pct1(sig?.under8Freq.d8)} · 9: {pct1(sig?.under8Freq.d9)}
                          </span>
                        </div>
                        {trackLine("under8")}
                        {sig?.under8 && onTrade && (
                          <button
                            className="scanner-trade"
                            onClick={() => onTrade({ symbol: m.symbol, name: m.name, subContract: "under", digit: 8, strength: 0 })}
                          >
                            Trade Under 8 →
                          </button>
                        )}
                        {sig?.under8 && !onTrade && <span className="scanner-ready">READY — switch to the Trade view</span>}
                      </div>

                      <div className={`scanner-cond ${sig?.over1 ? "ok" : ""}`}>
                        <div className="scanner-cond-top">
                          <span className="scanner-cond-badge">OVER 1</span>
                          <span className="scanner-cond-pct" title={`0 appeared ${sig ? sig.digits[0].count : 0}/${sig?.ticks ?? lookback} ticks`}>
                            0: {pct1(sig?.over1Freq.d0)} · 1: {pct1(sig?.over1Freq.d1)}
                          </span>
                        </div>
                        {trackLine("over1")}
                        {sig?.over1 && onTrade && (
                          <button
                            className="scanner-trade"
                            onClick={() => onTrade({ symbol: m.symbol, name: m.name, subContract: "over", digit: 1, strength: 0 })}
                          >
                            Trade Over 1 →
                          </button>
                        )}
                        {sig?.over1 && !onTrade && <span className="scanner-ready">READY — switch to the Trade view</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="scanner-panel-foot">
              <span>
                Updated {new Date(signals[0]?.updatedAt ?? Date.now()).toLocaleTimeString()} · ping every 15s
              </span>
              <span className="scanner-foot-right">
                {status.lastCloseAt
                  ? <>last drop {timeAgo(new Date(status.lastCloseAt).toISOString())} ({status.lastCloseCode})</>
                  : "no disconnects"}
              </span>
            </div>
          </div>
        </>
      )}
    </>
  );
}
