"use client";

import { useEffect, useRef } from "react";
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

type Props = {
  ticks: Tick[];
  activeContract?: ActiveContract | null;
};

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

  // ---- active contract markers (entry / exit) ----
  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || ticks.length === 0) return;

    if (markersTimerRef.current) {
      clearTimeout(markersTimerRef.current);
      markersTimerRef.current = null;
    }

    if (!activeContract) {
      // Clear markers by detaching
      if (markersPrimitiveRef.current) {
        markersPrimitiveRef.current.detach();
        markersPrimitiveRef.current = null;
      }
      return;
    }

    const latestIndex = ticks.length;
    const markers: Array<{
      time: Time;
      position: "aboveBar" | "belowBar";
      color: string;
      shape: "circle" | "arrowUp" | "arrowDown";
      text: string;
      size?: number;
    }> = [];

    // Entry tick marker
    if (activeContract.entry_tick != null) {
      markers.push({
        time: Math.max(1, latestIndex - (activeContract.tick_count ?? 5)) as Time,
        position: "aboveBar",
        color: "#f0c040",
        shape: "circle",
        text: "ENTRY",
        size: 1,
      });
    }

    // Exit tick marker
    if (activeContract.exit_tick != null) {
      const isWin = activeContract.status === "won";
      markers.push({
        time: latestIndex as Time,
        position: "aboveBar",
        color: isWin ? "#22c55e" : "#ef4444",
        shape: "circle",
        text: `${isWin ? "WIN" : "LOSS"} ${Number(activeContract.exit_tick).toFixed(2)}`,
        size: 2,
      });
    }

    // Detach old markers if exists
    if (markersPrimitiveRef.current) {
      markersPrimitiveRef.current.detach();
    }

    // Create new markers (v5 API)
    markersPrimitiveRef.current = createSeriesMarkers(series, markers);

    // Clear markers after animation
    markersTimerRef.current = setTimeout(() => {
      if (markersPrimitiveRef.current) {
        markersPrimitiveRef.current.detach();
        markersPrimitiveRef.current = null;
      }
    }, 3000);
  }, [activeContract, ticks.length]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", position: "absolute", inset: 0 }}
    />
  );
}
