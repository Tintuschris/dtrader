"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  createChart,
  createSeriesMarkers,
  ColorType,
  CrosshairMode,
  AreaSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type Time,
} from "lightweight-charts";

type Tick = { value: number; digit: number };

type ActiveContract = {
  contract_id: string;
  status: string;
  profit?: number;
  entry_tick?: number;
  current_tick?: number;
  exit_tick?: number;
  barrier?: string;
  contract_type?: string;
  tick_count?: number;
};

/** Snapshot of a settled contract kept alive for marker display. */
type ResolvedContract = {
  entry_tick: number | undefined;
  exit_tick: number;
  tick_count: number | undefined;
  status: "won" | "lost";
  barrier: string | undefined;
};

type Props = {
  ticks: Tick[];
  activeContract?: ActiveContract | null;

};

function digitFromPrice(price: number, pipSize = 2) {
  return Number(price.toFixed(pipSize).replace(".", "").slice(-1));
}

/** Find the tick array index closest to a target price value. */
function findTickIndex(ticks: Tick[], targetPrice: number): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < ticks.length; i++) {
    const dist = Math.abs(ticks[i].value - targetPrice);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

/**
 * TradingView Lightweight Charts v5 tick chart.
 * Area chart with crosshair, current price line, and active contract markers.
 */
export default function TickChart({ ticks, activeContract }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Area"> | null>(null);
  const markersPrimitiveRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const markersTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Persisted resolved contract snapshot so markers survive after activeContract is nulled.
  const resolvedRef = useRef<ResolvedContract | null>(null);

  // ---- create chart once ----
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#617085",
        fontFamily: "'Space Grotesk', monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: "rgba(157,179,203,0.06)" },
        horzLines: { color: "rgba(157,179,203,0.08)" },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "rgba(185,161,255,0.3)", width: 1, style: 2, labelBackgroundColor: "#b9a1ff" },
        horzLine: { color: "rgba(185,161,255,0.3)", width: 1, style: 2, labelBackgroundColor: "#b9a1ff" },
      },
      rightPriceScale: {
        borderColor: "rgba(157,179,203,0.1)",
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        visible: false,
      },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(AreaSeries, {
      lineColor: "#43d6c1",
      topColor: "rgba(67,214,193,0.18)",
      bottomColor: "rgba(67,214,193,0)",
      lineWidth: 2,
      crosshairMarkerRadius: 4,
      crosshairMarkerBorderColor: "#0b1420",
      crosshairMarkerBackgroundColor: "#b9a1ff",
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineColor: "#b9a1ff",
      priceLineWidth: 1,
      priceLineStyle: 2,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      if (containerRef.current) {
        chart.applyOptions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);
    handleResize();

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      markersPrimitiveRef.current = null;
    };
  }, []);

  // ---- update data ----
  useEffect(() => {
    const series = seriesRef.current;
    if (!series || ticks.length === 0) return;

    const data = ticks.map((t, i) => ({
      time: (i + 1) as Time,
      value: t.value,
    }));

    series.setData(data);
    chartRef.current?.timeScale().scrollToRealTime();
  }, [ticks]);

  // ---- snapshot resolved contract when activeContract transitions from settled -> null ----
  useEffect(() => {
    if (activeContract && activeContract.exit_tick != null && (activeContract.status === "won" || activeContract.status === "lost")) {
      resolvedRef.current = {
        entry_tick: activeContract.entry_tick,
        exit_tick: activeContract.exit_tick,
        tick_count: activeContract.tick_count,
        status: activeContract.status as "won" | "lost",
        barrier: activeContract.barrier,
      };
    } else if (activeContract && activeContract.status === "open") {
      resolvedRef.current = null;
    }
  }, [activeContract]);

  // ---- build markers from contract data ----
  const buildMarkers = useCallback(
    (contract: { entry_tick?: number; exit_tick?: number; tick_count?: number; status: string; barrier?: string }, tickData: Tick[]) => {
      const latestIndex = tickData.length;
      const markers: Array<{
        time: Time;
        position: "aboveBar" | "belowBar";
        color: string;
        shape: "circle" | "arrowUp" | "arrowDown";
        text: string;
        size?: number;
      }> = [];

      if (contract.exit_tick == null) return [];
      const exitDigit = digitFromPrice(contract.exit_tick);
      const isWin = contract.status === "won";
      const exitIndex = findTickIndex(tickData, contract.exit_tick);
      const exitTime = exitIndex >= 0 ? (exitIndex + 1) : latestIndex;

      markers.push({
        time: exitTime as Time,
        position: "aboveBar",
        color: isWin ? "#22c55e" : "#ef4444",
        shape: "circle",
        text: (isWin ? "WIN" : "LOSS") + " • " + exitDigit,
        size: 2,
      });

      if (contract.entry_tick != null) {
        const tickCount = contract.tick_count ?? 5;
        const entryIndex = findTickIndex(tickData, contract.entry_tick);
        const entryTime = entryIndex >= 0
          ? entryIndex + 1
          : Math.max(1, exitTime - tickCount);

        markers.push({
          time: entryTime as Time,
          position: "belowBar",
          color: "#f0c040",
          shape: "circle",
          text: "ENTRY",
          size: 1,
        });
      }

      return markers;
    },
    [],
  );

  // ---- active contract markers (entry / exit) ----
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || ticks.length === 0) return;

    if (markersTimerRef.current) {
      clearTimeout(markersTimerRef.current);
      markersTimerRef.current = null;
    }

    const hasLiveExit = activeContract && activeContract.exit_tick != null &&
      (activeContract.status === "won" || activeContract.status === "lost");
    const resolved = resolvedRef.current;

    if (hasLiveExit) {
      const markers = buildMarkers(activeContract!, ticks);
      if (markersPrimitiveRef.current) markersPrimitiveRef.current.detach();
      markersPrimitiveRef.current = createSeriesMarkers(series, markers);

      markersTimerRef.current = setTimeout(() => {
        if (markersPrimitiveRef.current) {
          markersPrimitiveRef.current.detach();
          markersPrimitiveRef.current = null;
        }
        resolvedRef.current = null;
      }, 3000);
    } else if (resolved) {
      if (!markersPrimitiveRef.current) {
        const markers = buildMarkers(resolved, ticks);
        markersPrimitiveRef.current = createSeriesMarkers(series, markers);

        markersTimerRef.current = setTimeout(() => {
          if (markersPrimitiveRef.current) {
            markersPrimitiveRef.current.detach();
            markersPrimitiveRef.current = null;
          }
          resolvedRef.current = null;
        }, 2500);
      }
    } else if (activeContract && activeContract.status === "open") {
      const latestIndex = ticks.length;
      const markers: Array<{
        time: Time;
        position: "aboveBar" | "belowBar";
        color: string;
        shape: "circle" | "arrowUp" | "arrowDown";
        text: string;
        size?: number;
      }> = [];

      if (activeContract.entry_tick != null) {
        const entryIndex = findTickIndex(ticks, activeContract.entry_tick);
        const entryTime = entryIndex >= 0
          ? entryIndex + 1
          : Math.max(1, latestIndex - (activeContract.tick_count ?? 5));

        markers.push({
          time: entryTime as Time,
          position: "belowBar",
          color: "#f0c040",
          shape: "circle",
          text: "ENTRY",
          size: 1,
        });
      }

      if (markers.length > 0) {
        if (markersPrimitiveRef.current) markersPrimitiveRef.current.detach();
        markersPrimitiveRef.current = createSeriesMarkers(series, markers);
      }
    } else {
      if (markersPrimitiveRef.current) {
        markersPrimitiveRef.current.detach();
        markersPrimitiveRef.current = null;
      }
    }
  }, [activeContract, ticks, ticks.length, buildMarkers]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
    />
  );
}
