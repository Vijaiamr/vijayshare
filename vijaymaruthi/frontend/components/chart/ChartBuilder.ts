// ChartBuilder — imperative lightweight-charts factory.
//
// Owns every lightweight-charts instance (main chart + sub-panes) and exposes
// a ChartHandle so React components can toggle series, switch chart types,
// apply settings, overlay compare series, and convert coordinates without
// touching the library directly. This is the refactored core of the old
// InteractiveChart.tsx effect.

import {
  createChart,
  createSeriesMarkers,
  CandlestickSeries,
  LineSeries,
  AreaSeries,
  BarSeries,
  BaselineSeries,
  HistogramSeries,
  ColorType,
  LineStyle,
  LineType,
  CrosshairMode,
  PriceScaleMode,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { OHLCVPoint } from "@/lib/types";
import type { DetectedPattern } from "@/lib/patterns";
import type { ComputedIndicators } from "@/lib/indicators";
import { CHART_SERIES_COLORS } from "./colors";
import { toKagi, toLineBreak, toPointFigure, toRange } from "./transforms";
import type {
  ChartHandle,
  ChartSettings,
  ChartTime,
  ChartType,
  CompareSeries,
  PaneKey,
  ToggleState,
} from "./types";

// ─── Helpers ───

function toChartTime(time: ChartTime): Time {
  // Intraday timestamps arrive as ISO datetimes (2025-10-01T09:15:00).
  // lightweight-charts only accepts yyyy-mm-dd strings or UTCTimestamp
  // numbers, so convert ISO datetimes to epoch seconds. Numbers pass through.
  if (typeof time === "number") return time as UTCTimestamp;
  if (time.includes("T")) {
    const ms = Date.parse(time);
    if (!Number.isNaN(ms)) return Math.floor(ms / 1000) as UTCTimestamp;
  }
  return time as Time;
}

function makeChartOpts(w: number, h: number, dark: boolean, showGrid: boolean) {
  return {
    layout: {
      background: { type: ColorType.Solid, color: "transparent" as const },
      textColor: dark ? "#a1a1aa" : "#52525b",
      fontSize: 10,
    },
    grid: {
      vertLines: {
        color: showGrid ? (dark ? "rgba(255,255,255,0.04)" : "rgba(9,9,11,0.05)") : "transparent",
      },
      horzLines: {
        color: showGrid ? (dark ? "rgba(255,255,255,0.04)" : "rgba(9,9,11,0.05)") : "transparent",
      },
    },
    crosshair: {
      mode: CrosshairMode.Normal,
      vertLine: {
        color: dark ? "rgba(255,255,255,0.15)" : "rgba(9,9,11,0.2)",
        width: 1 as const,
        style: LineStyle.Dashed,
        labelBackgroundColor: dark ? "#27272a" : "#3f3f46",
      },
      horzLine: {
        color: dark ? "rgba(255,255,255,0.15)" : "rgba(9,9,11,0.2)",
        width: 1 as const,
        style: LineStyle.Dashed,
        labelBackgroundColor: dark ? "#27272a" : "#3f3f46",
      },
    },
    timeScale: {
      borderColor: dark ? "rgba(255,255,255,0.08)" : "rgba(9,9,11,0.12)",
      timeVisible: false,
      secondsVisible: false,
    },
    rightPriceScale: {
      borderColor: dark ? "rgba(255,255,255,0.08)" : "rgba(9,9,11,0.12)",
      mode: PriceScaleMode.Normal,
    },
    width: w,
    height: h,
  } as const;
}

/** Resolve the TradingView-style price scale mode from settings. */
function scaleModeFor(s: ChartSettings): PriceScaleMode {
  return s.priceScaleMode === "log" || s.logScale
    ? PriceScaleMode.Logarithmic
    : s.priceScaleMode === "percentage"
      ? PriceScaleMode.Percentage
      : s.priceScaleMode === "indexed"
        ? PriceScaleMode.IndexedTo100
        : PriceScaleMode.Normal;
}

function safeSetData(series: ISeriesApi<any>, data: any[]) {
  if (!data || data.length === 0) return;
  const sorted = [...data].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  try {
    series.setData(sorted);
  } catch (e) {
    console.warn("chart series setData failed:", e);
  }
}

function safeSetMarkers(series: ISeriesApi<any>, markers: any[]) {
  if (!markers || markers.length === 0) return;
  const sorted = [...markers].sort((a, b) => String(a.time).localeCompare(String(b.time)));
  try {
    createSeriesMarkers(series, sorted);
  } catch (e) {
    console.warn("chart markers failed:", e);
  }
}

// ─── Input ───

export interface ChartBuildInput {
  mainEl: HTMLElement;
  paneEls: Partial<Record<PaneKey, HTMLElement | null>>;
  candles: OHLCVPoint[];
  indicators: ComputedIndicators;
  backendPatterns: DetectedPattern[];
  targetPrice: number | null;
  isDark: boolean;
  chartType: ChartType;
  settings: ChartSettings;
  toggles: ToggleState;
  compare: CompareSeries[];
}

// ─── Builder ───

export function buildChart(input: ChartBuildInput): ChartHandle {
  const {
    mainEl, paneEls, candles, indicators, backendPatterns, targetPrice,
    isDark, chartType, settings, toggles, compare,
  } = input;

  const times: ChartTime[] = candles.map((d) => toChartTime(d.time) as ChartTime);
  const t0 = toChartTime(times[0]);
  const tN = toChartTime(times[times.length - 1]);

  // ── Main chart ──
  const mainW = mainEl.clientWidth;
  const mainChart = createChart(mainEl, makeChartOpts(mainW, 380, isDark, settings.showGrid));
  mainChart.applyOptions({
    rightPriceScale: {
      mode: scaleModeFor(settings),
    },
  });
  // Observability hook: expose the active scale mode for tests/debugging.
  mainEl.dataset.scaleMode = String(scaleModeFor(settings));
  if (settings.barSpacing > 0) {
    mainChart.applyOptions({ timeScale: { barSpacing: settings.barSpacing } });
  }

  // ── Series refs ──
  const refs: Record<string, ISeriesApi<any> | null> = {};
  const arrRefs: Record<string, ISeriesApi<any>[]> = {};
  let mainPriceSeries: ISeriesApi<any> | null = null;
  let markersCache: any[] = [];
  let compareSeries: ISeriesApi<any>[] = [];

  const line = (color: string, w: 1 | 2 | 3 | 4, style: LineStyle = LineStyle.Solid) =>
    ({ color, lineWidth: w, lineStyle: style, lastValueVisible: true, priceLineVisible: false }) as const;
  const dotted = (color: string) =>
    ({ color, lineWidth: 1 as const, lineStyle: LineStyle.Dotted as const, lastValueVisible: false, priceLineVisible: false }) as const;
  const dashed = (color: string) =>
    ({ color, lineWidth: 1 as const, lineStyle: LineStyle.Dashed as const, lastValueVisible: true, priceLineVisible: false }) as const;

  // ── Main price series (per chart type) ──
  const candleData = candles.map((d) => ({
    time: toChartTime(d.time),
    open: Number(d.open),
    high: Number(d.high),
    low: Number(d.low),
    close: Number(d.close),
  }));

  const addMainPriceSeries = (type: ChartType, st: ChartSettings = settings) => {
    if (mainPriceSeries) {
      try { mainChart.removeSeries(mainPriceSeries); } catch (_) {}
      mainPriceSeries = null;
    }
    const up = st.upColor;
    const down = st.downColor;
    if (type === "line") {
      const s = mainChart.addSeries(LineSeries, {
        color: up, lineWidth: 2, lastValueVisible: true, priceLineVisible: false,
      });
      safeSetData(s, candles.map((d) => ({ time: toChartTime(d.time), value: Number(d.close) })));
      mainPriceSeries = s;
    } else if (type === "area") {
      const s = mainChart.addSeries(AreaSeries, {
        lineColor: up, topColor: `${up}55`, bottomColor: `${up}00`,
        lineWidth: 2, lastValueVisible: true, priceLineVisible: false,
      });
      safeSetData(s, candles.map((d) => ({ time: toChartTime(d.time), value: Number(d.close) })));
      mainPriceSeries = s;
    } else if (type === "bar") {
      const s = mainChart.addSeries(BarSeries, {
        upColor: up, downColor: down, thinBars: false,
        lastValueVisible: true, priceLineVisible: false,
      });
      safeSetData(s, candleData);
      mainPriceSeries = s;
    } else if (type === "baseline") {
      // Baseline: closes colored vs the first visible close (TradingView-style)
      const base = candles.length > 0 ? Number(candles[0].close) : 0;
      const s = mainChart.addSeries(BaselineSeries, {
        baseValue: { type: "price" as const, price: base },
        topLineColor: up, topFillColor1: `${up}44`, topFillColor2: `${up}00`,
        bottomLineColor: down, bottomFillColor1: `${down}44`, bottomFillColor2: `${down}00`,
        lineWidth: 2, lastValueVisible: true, priceLineVisible: false,
      });
      safeSetData(s, candles.map((d) => ({ time: toChartTime(d.time), value: Number(d.close) })));
      mainPriceSeries = s;
    } else if (type === "kagi" || type === "pointfigure" || type === "range" || type === "linebreak") {
      // Alternative chart types: transform OHLC → point series, render as a
      // line (the standard lightweight-charts approach for these).
      const pts =
        type === "kagi"
          ? toKagi(candles, { reversal: st.kagiReversal })
          : type === "pointfigure"
            ? toPointFigure(candles, { boxSize: st.pfBoxSize, reversal: st.pfReversal })
            : type === "range"
              ? toRange(candles, { range: st.rangeSize })
              : toLineBreak(candles, { lines: st.lineBreakLines });
      const s = mainChart.addSeries(LineSeries, {
        color: up, lineWidth: 2, lastValueVisible: true, priceLineVisible: false,
      });
      safeSetData(s, pts.map((p) => ({ time: toChartTime(p.time), value: p.value })));
      mainPriceSeries = s;
    } else {
      // candle / hollow / heikin / renko — all rendered as candlesticks
      const hollow = type === "hollow";
      const s = mainChart.addSeries(CandlestickSeries, {
        upColor: hollow ? "rgba(0,0,0,0)" : up,
        downColor: hollow ? "rgba(0,0,0,0)" : down,
        borderUpColor: up,
        borderDownColor: down,
        wickUpColor: up,
        wickDownColor: down,
      });
      safeSetData(s, candleData);
      mainPriceSeries = s;
    }
    if (markersCache.length > 0) safeSetMarkers(mainPriceSeries, markersCache);
  };

  addMainPriceSeries(chartType);

  // ── Volume ──
  const vS = mainChart.addSeries(HistogramSeries, {
    priceFormat: { type: "volume" as const },
    priceScaleId: "volume",
  });
  mainChart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
  safeSetData(vS, candles.map((d) => ({
    time: toChartTime(d.time),
    value: Number(d.volume),
    color: d.close >= d.open ? "rgba(11,189,138,0.25)" : "rgba(240,78,78,0.25)",
  })));
  refs.volume = vS;

  // ── EMAs ──
  const addEMA = (data: { time: string; value: number }[], color: string, w: 1 | 2 | 3 | 4, key: string) => {
    if (data.length > 0) {
      const s = mainChart.addSeries(LineSeries, line(color, w));
      safeSetData(s, data.map((d) => ({ time: toChartTime(d.time), value: d.value })));
      refs[key] = s;
    }
  };
  addEMA(indicators.ema9, CHART_SERIES_COLORS.ema9, 1, "ema9");
  addEMA(indicators.ema20, CHART_SERIES_COLORS.ema20, 1, "ema20");
  addEMA(indicators.ema50, CHART_SERIES_COLORS.ema50, 2, "ema50");
  addEMA(indicators.ema200, CHART_SERIES_COLORS.ema200, 2, "ema200");

  // ── SMA ──
  if (indicators.sma && indicators.sma.length > 0) {
    const s = mainChart.addSeries(LineSeries, line("rgba(52,211,153,0.7)", 1, LineStyle.Dashed));
    safeSetData(s, indicators.sma.map((d) => ({ time: toChartTime(d.time), value: d.value })));
    refs.sma = s;
  }

  // ── Keltner Channels ──
  if (indicators.keltner && indicators.keltner.length > 0) {
    const addK = (key: "upper" | "middle" | "lower", color: string, style: LineStyle, refKey: string) => {
      const s = mainChart.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: style, lastValueVisible: false, priceLineVisible: false });
      safeSetData(s, indicators.keltner!.map((d) => ({ time: toChartTime(d.time), value: d[key] })));
      refs[refKey] = s;
    };
    addK("upper", "rgba(251,146,60,0.5)", LineStyle.Dotted, "keltUpper");
    addK("middle", "rgba(251,146,60,0.3)", LineStyle.Dashed, "keltMid");
    addK("lower", "rgba(251,146,60,0.5)", LineStyle.Dotted, "keltLower");
  }

  // ── Donchian Channels ──
  if (indicators.donchian && indicators.donchian.length > 0) {
    const addD = (key: "upper" | "middle" | "lower", color: string, style: LineStyle, refKey: string) => {
      const s = mainChart.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: style, lastValueVisible: false, priceLineVisible: false });
      safeSetData(s, indicators.donchian!.map((d) => ({ time: toChartTime(d.time), value: d[key] })));
      refs[refKey] = s;
    };
    addD("upper", "rgba(34,211,238,0.5)", LineStyle.Dotted, "donUpper");
    addD("middle", "rgba(34,211,238,0.3)", LineStyle.Dashed, "donMid");
    addD("lower", "rgba(34,211,238,0.5)", LineStyle.Dotted, "donLower");
  }

  // ── Aroon ──
  if (indicators.aroon && indicators.aroon.length > 0) {
    const upS = mainChart.addSeries(LineSeries, { color: "rgba(52,211,153,0.6)", lineWidth: 1, lineStyle: LineStyle.Solid, lastValueVisible: false, priceLineVisible: false });
    const dnS = mainChart.addSeries(LineSeries, { color: "rgba(240,78,78,0.6)", lineWidth: 1, lineStyle: LineStyle.Solid, lastValueVisible: false, priceLineVisible: false });
    safeSetData(upS, indicators.aroon.map((d) => ({ time: toChartTime(d.time), value: d.up })));
    safeSetData(dnS, indicators.aroon.map((d) => ({ time: toChartTime(d.time), value: d.down })));
    refs.aroonUp = upS;
    refs.aroonDown = dnS;
  }

  // ── DPO (main-pane line) ──
  if (indicators.dpo && indicators.dpo.length > 0) {
    const s = mainChart.addSeries(LineSeries, { color: "rgba(167,139,250,0.6)", lineWidth: 1, lineStyle: LineStyle.Solid, lastValueVisible: false, priceLineVisible: false });
    safeSetData(s, indicators.dpo.map((d) => ({ time: toChartTime(d.time), value: d.value })));
    refs.dpo = s;
  }

  // ── Elder Ray (bull/bear histogram on main pane) ──
  if (indicators.elderRay && indicators.elderRay.length > 0) {
    const bullS = mainChart.addSeries(HistogramSeries, { priceFormat: { type: "price" as const }, priceScaleId: "elderRay" });
    const bearS = mainChart.addSeries(HistogramSeries, { priceFormat: { type: "price" as const }, priceScaleId: "elderRay" });
    mainChart.priceScale("elderRay").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    safeSetData(bullS, indicators.elderRay.map((d) => ({ time: toChartTime(d.time), value: d.bull, color: "rgba(52,211,153,0.35)" })));
    safeSetData(bearS, indicators.elderRay.map((d) => ({ time: toChartTime(d.time), value: d.bear, color: "rgba(240,78,78,0.35)" })));
    refs.elderBull = bullS;
    refs.elderBear = bearS;
  }

  // ── Envelopes ──
  if (indicators.envelopes && indicators.envelopes.length > 0) {
    const upS = mainChart.addSeries(LineSeries, { color: "rgba(129,140,248,0.5)", lineWidth: 1, lineStyle: LineStyle.Dotted, lastValueVisible: false, priceLineVisible: false });
    const loS = mainChart.addSeries(LineSeries, { color: "rgba(129,140,248,0.5)", lineWidth: 1, lineStyle: LineStyle.Dotted, lastValueVisible: false, priceLineVisible: false });
    safeSetData(upS, indicators.envelopes.map((d) => ({ time: toChartTime(d.time), value: d.upper })));
    safeSetData(loS, indicators.envelopes.map((d) => ({ time: toChartTime(d.time), value: d.lower })));
    refs.envUpper = upS;
    refs.envLower = loS;
  }

  // ── Volume Profile ──
  // VolumeProfilePoint is price-based ({ price, volume }) — rendered as a
  // horizontal histogram overlay by InteractiveChart (TradingView-style),
  // not as a time series here.

  // ── Fibonacci levels (computed) ──
  if (indicators.fibonacci && indicators.fibonacci.length > 0) {
    const fibLines: ISeriesApi<"Line">[] = [];
    indicators.fibonacci.forEach((f) => {
      const ln = mainChart.addSeries(LineSeries, {
        color: "rgba(34,211,238,0.35)", lineWidth: 1, lineStyle: LineStyle.Dashed,
        lastValueVisible: false, priceLineVisible: false,
      });
      safeSetData(ln, [{ time: t0, value: f.price }, { time: tN, value: f.price }]);
      fibLines.push(ln);
    });
    arrRefs.fibLevels = fibLines;
  }

  // ── Ichimoku ──
  if (indicators.ichimoku.length > 0) {
    const addIchi = (key: "tenkan" | "kijun" | "senkouA" | "senkouB", color: string, w: 1 | 2 | 3 | 4, refKey: string) => {
      const pts = indicators.ichimoku.filter((p) => p[key] !== null).map((p) => ({ time: toChartTime(p.time), value: p[key]! }));
      if (pts.length > 0) {
        const s = mainChart.addSeries(LineSeries, line(color, w));
        safeSetData(s, pts);
        refs[refKey] = s;
      }
    };
    addIchi("tenkan", "#a78bfa", 1, "ichiTenkan");
    addIchi("kijun", "#c084fc", 1, "ichiKijun");
    addIchi("senkouA", "rgba(167,139,250,0.5)", 1, "ichiCloudA");
    addIchi("senkouB", "rgba(167,139,250,0.3)", 1, "ichiCloudB");
  }

  // ── SuperTrend ──
  if (indicators.superTrend.length > 0) {
    const upLine = mainChart.addSeries(LineSeries, {
      color: "rgba(16,185,129,0.6)", lineWidth: 1 as const, lineStyle: LineStyle.Solid as const,
      lastValueVisible: false, priceLineVisible: false,
    });
    const loLine = mainChart.addSeries(LineSeries, {
      color: "rgba(240,78,78,0.6)", lineWidth: 1 as const, lineStyle: LineStyle.Solid as const,
      lastValueVisible: false, priceLineVisible: false,
    });
    safeSetData(upLine, indicators.superTrend.map((p) => ({ time: toChartTime(p.time), value: p.lower })));
    safeSetData(loLine, indicators.superTrend.map((p) => ({ time: toChartTime(p.time), value: p.upper })));
    refs.stUpper = upLine;
    refs.stLower = loLine;
  }

  // ── Bollinger ──
  if (indicators.bollinger.length > 0) {
    const addBB = (key: "upper" | "middle" | "lower", color: string, w: 1 | 2 | 3 | 4, style: LineStyle, refKey: string) => {
      const s = mainChart.addSeries(LineSeries, { color, lineWidth: w, lineStyle: style, lastValueVisible: false, priceLineVisible: false });
      safeSetData(s, indicators.bollinger.map((d) => ({ time: toChartTime(d.time), value: d[key] })));
      refs[refKey] = s;
    };
    addBB("upper", "rgba(129,140,248,0.6)", 1, LineStyle.Dotted, "bbUpper");
    addBB("middle", "rgba(129,140,248,0.3)", 1, LineStyle.Dashed, "bbMid");
    addBB("lower", "rgba(129,140,248,0.6)", 1, LineStyle.Dotted, "bbLower");
  }

  // ── PSAR ──
  if (indicators.psar && indicators.psar.length > 0) {
    const s = mainChart.addSeries(LineSeries, {
      color: CHART_SERIES_COLORS.psar, lineWidth: 1, lineStyle: LineStyle.Dotted,
      lastValueVisible: false, priceLineVisible: false,
    });
    safeSetData(s, indicators.psar.map((d) => ({ time: toChartTime(d.time), value: d.value })));
    refs.psar = s;
  }

  // ── VWAP ──
  if (indicators.vwap && indicators.vwap.length > 0) {
    const s = mainChart.addSeries(LineSeries, {
      color: CHART_SERIES_COLORS.vwap, lineWidth: 1, lineStyle: LineStyle.Dashed,
      lastValueVisible: true, priceLineVisible: false,
    });
    safeSetData(s, indicators.vwap.map((d) => ({ time: toChartTime(d.time), value: d.value })));
    refs.vwap = s;
  }

  // ── OBV (own price scale, bottom strip) ──
  if (indicators.obv && indicators.obv.length > 0) {
    const s = mainChart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" as const },
      priceScaleId: "obv",
    });
    mainChart.priceScale("obv").applyOptions({ scaleMargins: { top: 0.9, bottom: 0 } });
    safeSetData(s, indicators.obv.map((d) => ({
      time: toChartTime(d.time),
      value: d.value,
      color: d.value >= 0 ? "rgba(52,211,153,0.35)" : "rgba(240,78,78,0.35)",
    })));
    refs.obv = s;
  }

  // ── S/R levels ──
  const sLines: ISeriesApi<"Line">[] = [];
  const srLevels: { price: number; label: string; color: string }[] = [];
  indicators.swingHighs.slice(-5).forEach((s) => srLevels.push({ price: s.price, label: "R", color: "rgba(240,78,78,0.4)" }));
  indicators.swingLows.slice(-5).forEach((s) => srLevels.push({ price: s.price, label: "S", color: "rgba(11,189,138,0.4)" }));
  if (indicators.pivotPoint) {
    srLevels.push({ price: indicators.pivotPoint.r1, label: "R1", color: "rgba(240,78,78,0.3)" });
    srLevels.push({ price: indicators.pivotPoint.pivot, label: "P", color: isDark ? "rgba(255,255,255,0.2)" : "rgba(9,9,11,0.25)" });
    srLevels.push({ price: indicators.pivotPoint.s1, label: "S1", color: "rgba(11,189,138,0.3)" });
  }
  srLevels.forEach((lvl) => {
    const ln = mainChart.addSeries(LineSeries, dashed(lvl.color));
    safeSetData(ln, [{ time: t0, value: lvl.price }, { time: tN, value: lvl.price }]);
    sLines.push(ln);
  });
  arrRefs.sr = sLines;

  // ── Trendlines ──
  if (indicators.trendlines.length > 0) {
    indicators.trendlines.forEach((tl) => {
      const color = tl.type === "support" ? "rgba(11,189,138,0.5)" : "rgba(240,78,78,0.5)";
      const ln = mainChart.addSeries(LineSeries, dashed(color));
      safeSetData(ln, [{ time: toChartTime(tl.startTime), value: tl.startPrice }, { time: toChartTime(tl.endTime), value: tl.endPrice }]);
      if (tl.type === "support") refs.trendA = ln; else refs.trendR = ln;
    });
  }

  // ── Patterns ──
  const pLines: ISeriesApi<"Line">[] = [];
  const patternMarkers: any[] = [];
  const styleMap = { solid: LineStyle.Solid as const, dashed: LineStyle.Dashed as const, dotted: LineStyle.Dotted as const };
  const allPatterns = [...(backendPatterns ?? []), ...indicators.patterns];
  if (allPatterns.length > 0) {
    allPatterns.forEach((ptn) => {
      ptn.lines.forEach((pl) => {
        const ln = mainChart.addSeries(LineSeries, {
          color: pl.color, lineWidth: pl.width, lineStyle: styleMap[pl.style],
          lastValueVisible: false, priceLineVisible: false,
        });
        safeSetData(ln, [{ time: toChartTime(pl.startTime), value: pl.startPrice }, { time: toChartTime(pl.endTime), value: pl.endPrice }]);
        pLines.push(ln);
      });
      ptn.markers.forEach((mk) => {
        const st = mk.position === "aboveBar" ? "aboveBar" as const : "belowBar" as const;
        const idx = times.indexOf(mk.time);
        if (idx >= 0) {
          patternMarkers.push({
            time: toChartTime(mk.time), position: st,
            color: mk.color, shape: "arrowUp" as any, text: mk.label,
          });
        }
      });
      const lastTime = times[times.length - 1];
      if (lastTime) {
        const statusColor = ptn.status === "completed" ? "#34d399" : ptn.status === "failed" ? "#f04e4e" : ptn.status === "active" ? "#fbbf24" : "#a78bfa";
        const statusLabel = ptn.status === "completed" ? "DONE" : ptn.status === "failed" ? "FAIL" : ptn.status === "active" ? "ACTV" : "FORM";
        const rrText = ptn.riskReward ? ` R:${ptn.riskReward.toFixed(1)}` : "";
        const confText = ` ${ptn.confidence}%`;
        const pos = ptn.direction === "bullish" ? "belowBar" as const : "aboveBar" as const;
        patternMarkers.push({
          time: toChartTime(lastTime), position: pos,
          color: statusColor, shape: "circle" as any,
          text: `${ptn.type} [${statusLabel}]${rrText} · ${confText}`,
        });
      }
      if (ptn.triggerPrice && ptn.status === "forming") {
        const triggerLine = mainChart.addSeries(LineSeries, {
          color: "rgba(167,139,250,0.5)", lineWidth: 1, lineStyle: LineStyle.Dashed as const,
          lastValueVisible: false, priceLineVisible: false,
        });
        safeSetData(triggerLine, [{ time: t0, value: ptn.triggerPrice }, { time: tN, value: ptn.triggerPrice }]);
        pLines.push(triggerLine);
      }
    });
  }
  arrRefs.patterns = pLines;

  // ── Target line ──
  if (targetPrice && targetPrice > 0) {
    const ln = mainChart.addSeries(LineSeries, {
      color: isDark ? "rgba(255,255,255,0.6)" : "rgba(9,9,11,0.55)",
      lineWidth: 2 as const, lineStyle: LineStyle.Dashed as const,
      lastValueVisible: true, priceLineVisible: false, title: "Target",
    });
    safeSetData(ln, [{ time: t0, value: targetPrice }, { time: tN, value: targetPrice }]);
    refs.target = ln;
  }

  // ── Markers (OB / FVG / patterns) ──
  const markers: any[] = [];
  if (indicators.orderBlocks.length > 0) {
    indicators.orderBlocks.forEach((ob) => {
      const idx = times.indexOf(ob.time);
      if (idx >= 0) {
        markers.push({
          time: toChartTime(ob.time), position: ob.type === "bullish" ? "belowBar" : "aboveBar" as any,
          color: ob.type === "bullish" ? "#0bbd8a" : "#f04e4e", shape: "arrowUp" as any, text: "OB",
        });
      }
    });
  }
  if (indicators.fvgs.length > 0) {
    indicators.fvgs.forEach((fvg) => {
      const idx = times.indexOf(fvg.startTime);
      if (idx >= 0) {
        markers.push({
          time: toChartTime(fvg.startTime), position: fvg.type === "bullish" ? "belowBar" : "aboveBar" as any,
          color: "#facc15", shape: "circle" as any, text: "FVG",
        });
      }
    });
  }
  if (patternMarkers.length > 0) markers.push(...patternMarkers);
  markersCache = markers;
  if (mainPriceSeries) safeSetMarkers(mainPriceSeries, markers);

  // ── Compare series ──
  const addCompare = (list: CompareSeries[]) => {
    compareSeries.forEach((s) => { try { mainChart.removeSeries(s); } catch (_) {} });
    compareSeries = [];
    if (list.length === 0) return;
    mainChart.priceScale("compare").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });
    list.forEach((cs) => {
      const s = mainChart.addSeries(LineSeries, {
        color: cs.color, lineWidth: 1, lineStyle: LineStyle.Solid,
        priceScaleId: "compare", lastValueVisible: true, priceLineVisible: false,
        title: cs.ticker,
      });
      safeSetData(s, cs.data.map((d) => ({ time: toChartTime(d.time), value: d.value })));
      compareSeries.push(s);
    });
  };
  addCompare(compare);

  // ── Sub-panes ──
  const paneCharts: Partial<Record<PaneKey, IChartApi>> = {};
  const paneSeries: Partial<Record<PaneKey, ISeriesApi<any>[]>> = {};

  const buildPane = (key: PaneKey, el: HTMLElement | null | undefined, build: (chart: IChartApi) => ISeriesApi<any>[]) => {
    if (!el) return;
    const w = el.clientWidth;
    const chart = createChart(el, {
      ...makeChartOpts(w, 100, isDark, settings.showGrid),
      rightPriceScale: { borderColor: isDark ? "rgba(255,255,255,0.08)" : "rgba(9,9,11,0.14)", scaleMargins: { top: 0.15, bottom: 0.15 } },
    });
    paneCharts[key] = chart;
    paneSeries[key] = build(chart);
    chart.timeScale().fitContent();
  };

  const addLevel = (chart: IChartApi, val: number, color: string) => {
    const l = chart.addSeries(LineSeries, {
      color, lineWidth: 1 as const, lineStyle: LineStyle.Dashed as const,
      lastValueVisible: false, priceLineVisible: false,
    });
    safeSetData(l, [{ time: t0, value: val }, { time: tN, value: val }]);
    return l;
  };

  if (indicators.rsi.length > 0) {
    buildPane("rsi", paneEls.rsi, (chart) => {
      const lineS = chart.addSeries(LineSeries, { color: CHART_SERIES_COLORS.rsi, lineWidth: 2 as const, lastValueVisible: true, priceLineVisible: false });
      safeSetData(lineS, indicators.rsi.map((d) => ({ time: toChartTime(d.time), value: d.value })));
      const ob = addLevel(chart, 70, "rgba(240,78,78,0.4)");
      const os = addLevel(chart, 30, "rgba(11,189,138,0.4)");
      return [lineS, ob, os];
    });
  }

  if (indicators.macd.length > 0) {
    buildPane("macd", paneEls.macd, (chart) => {
      const macdLine = chart.addSeries(LineSeries, { color: CHART_SERIES_COLORS.macd, lineWidth: 2 as const, lastValueVisible: true, priceLineVisible: false });
      safeSetData(macdLine, indicators.macd.map((d) => ({ time: toChartTime(d.time), value: d.macd })));
      const sig = chart.addSeries(LineSeries, { color: "#fbbf24", lineWidth: 1 as const, lastValueVisible: false, priceLineVisible: false });
      safeSetData(sig, indicators.macd.map((d) => ({ time: toChartTime(d.time), value: d.signal })));
      const hist = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" as const } });
      safeSetData(hist, indicators.macd.map((d) => ({
        time: toChartTime(d.time), value: d.histogram,
        color: d.histogram >= 0 ? "rgba(34,211,238,0.5)" : "rgba(240,78,78,0.4)",
      })));
      return [macdLine, sig, hist];
    });
  }

  if (indicators.adx && indicators.adx.length > 0) {
    buildPane("adx", paneEls.adx, (chart) => {
      const adxLine = chart.addSeries(LineSeries, { color: CHART_SERIES_COLORS.adx, lineWidth: 2 as const, lastValueVisible: true, priceLineVisible: false });
      safeSetData(adxLine, indicators.adx.map((d) => ({ time: toChartTime(d.time), value: d.value })));
      const plus = chart.addSeries(LineSeries, { color: "#34d399", lineWidth: 1 as const, lastValueVisible: false, priceLineVisible: false });
      safeSetData(plus, indicators.adx.map((d) => ({ time: toChartTime(d.time), value: d.plusDI })));
      const minus = chart.addSeries(LineSeries, { color: "#f04e4e", lineWidth: 1 as const, lastValueVisible: false, priceLineVisible: false });
      safeSetData(minus, indicators.adx.map((d) => ({ time: toChartTime(d.time), value: d.minusDI })));
      const lvl = addLevel(chart, 25, "rgba(255,255,255,0.25)");
      return [adxLine, plus, minus, lvl];
    });
  }

  if (indicators.stoch && indicators.stoch.length > 0) {
    buildPane("stoch", paneEls.stoch, (chart) => {
      const kLine = chart.addSeries(LineSeries, { color: CHART_SERIES_COLORS.stoch, lineWidth: 2 as const, lastValueVisible: true, priceLineVisible: false });
      safeSetData(kLine, indicators.stoch.map((d) => ({ time: toChartTime(d.time), value: d.k })));
      const dLine = chart.addSeries(LineSeries, { color: "#fbbf24", lineWidth: 1 as const, lastValueVisible: false, priceLineVisible: false });
      safeSetData(dLine, indicators.stoch.map((d) => ({ time: toChartTime(d.time), value: d.d })));
      const ob = addLevel(chart, 80, "rgba(240,78,78,0.4)");
      const os = addLevel(chart, 20, "rgba(11,189,138,0.4)");
      return [kLine, dLine, ob, os];
    });
  }

  if (indicators.cci && indicators.cci.length > 0) {
    buildPane("cci", paneEls.cci, (chart) => {
      const cciLine = chart.addSeries(LineSeries, { color: CHART_SERIES_COLORS.cci, lineWidth: 2 as const, lastValueVisible: true, priceLineVisible: false });
      safeSetData(cciLine, indicators.cci.map((d) => ({ time: toChartTime(d.time), value: d.value })));
      const ob = addLevel(chart, 100, "rgba(240,78,78,0.4)");
      const os = addLevel(chart, -100, "rgba(11,189,138,0.4)");
      return [cciLine, ob, os];
    });
  }

  // ── ATR ──
  if (indicators.atr && indicators.atr.length > 0) {
    buildPane("atr", paneEls.atr, (chart) => {
      const lineS = chart.addSeries(LineSeries, { color: "#fb923c", lineWidth: 2 as const, lastValueVisible: true, priceLineVisible: false });
      safeSetData(lineS, indicators.atr!.map((d) => ({ time: toChartTime(d.time), value: d.value })));
      return [lineS];
    });
  }

  // ── Williams %R ──
  if (indicators.williamsR && indicators.williamsR.length > 0) {
    buildPane("williams", paneEls.williams, (chart) => {
      const lineS = chart.addSeries(LineSeries, { color: "#f472b6", lineWidth: 2 as const, lastValueVisible: true, priceLineVisible: false });
      safeSetData(lineS, indicators.williamsR!.map((d) => ({ time: toChartTime(d.time), value: d.value })));
      const ob = addLevel(chart, -20, "rgba(240,78,78,0.4)");
      const os = addLevel(chart, -80, "rgba(11,189,138,0.4)");
      return [lineS, ob, os];
    });
  }

  // ── MFI ──
  if (indicators.mfi && indicators.mfi.length > 0) {
    buildPane("mfi", paneEls.mfi, (chart) => {
      const lineS = chart.addSeries(LineSeries, { color: "#34d399", lineWidth: 2 as const, lastValueVisible: true, priceLineVisible: false });
      safeSetData(lineS, indicators.mfi!.map((d) => ({ time: toChartTime(d.time), value: d.value })));
      const ob = addLevel(chart, 80, "rgba(240,78,78,0.4)");
      const os = addLevel(chart, 20, "rgba(11,189,138,0.4)");
      return [lineS, ob, os];
    });
  }

  // ── Stochastic RSI ──
  if (indicators.stochRsi && indicators.stochRsi.length > 0) {
    buildPane("stochrsi", paneEls.stochrsi, (chart) => {
      const kLine = chart.addSeries(LineSeries, { color: "#a78bfa", lineWidth: 2 as const, lastValueVisible: true, priceLineVisible: false });
      safeSetData(kLine, indicators.stochRsi!.map((d) => ({ time: toChartTime(d.time), value: d.k })));
      const dLine = chart.addSeries(LineSeries, { color: "#fbbf24", lineWidth: 1 as const, lastValueVisible: false, priceLineVisible: false });
      safeSetData(dLine, indicators.stochRsi!.map((d) => ({ time: toChartTime(d.time), value: d.d })));
      const ob = addLevel(chart, 80, "rgba(240,78,78,0.4)");
      const os = addLevel(chart, 20, "rgba(11,189,138,0.4)");
      return [kLine, dLine, ob, os];
    });
  }

  // ── Awesome Oscillator ──
  if (indicators.ao && indicators.ao.length > 0) {
    buildPane("ao", paneEls.ao, (chart) => {
      const hist = chart.addSeries(HistogramSeries, { priceFormat: { type: "price" as const } });
      safeSetData(hist, indicators.ao!.map((d) => ({
        time: toChartTime(d.time), value: d.value,
        color: d.value >= 0 ? "rgba(52,211,153,0.5)" : "rgba(240,78,78,0.5)",
      })));
      return [hist];
    });
  }

  // ── ROC ──
  if (indicators.roc && indicators.roc.length > 0) {
    buildPane("roc", paneEls.roc, (chart) => {
      const lineS = chart.addSeries(LineSeries, { color: "#22d3ee", lineWidth: 2 as const, lastValueVisible: true, priceLineVisible: false });
      safeSetData(lineS, indicators.roc!.map((d) => ({ time: toChartTime(d.time), value: d.value })));
      const z = addLevel(chart, 0, "rgba(255,255,255,0.25)");
      return [lineS, z];
    });
  }

  // ── Momentum ──
  if (indicators.momentum && indicators.momentum.length > 0) {
    buildPane("mom", paneEls.mom, (chart) => {
      const lineS = chart.addSeries(LineSeries, { color: "#fbbf24", lineWidth: 2 as const, lastValueVisible: true, priceLineVisible: false });
      safeSetData(lineS, indicators.momentum!.map((d) => ({ time: toChartTime(d.time), value: d.value })));
      const z = addLevel(chart, 0, "rgba(255,255,255,0.25)");
      return [lineS, z];
    });
  }

  // ── TRIX ──
  if (indicators.trix && indicators.trix.length > 0) {
    buildPane("trix", paneEls.trix, (chart) => {
      const lineS = chart.addSeries(LineSeries, { color: "#fb7185", lineWidth: 2 as const, lastValueVisible: true, priceLineVisible: false });
      safeSetData(lineS, indicators.trix!.map((d) => ({ time: toChartTime(d.time), value: d.value })));
      const z = addLevel(chart, 0, "rgba(255,255,255,0.25)");
      return [lineS, z];
    });
  }

  // ── Ultimate Oscillator ──
  if (indicators.uo && indicators.uo.length > 0) {
    buildPane("uo", paneEls.uo, (chart) => {
      const lineS = chart.addSeries(LineSeries, { color: "#34d399", lineWidth: 2 as const, lastValueVisible: true, priceLineVisible: false });
      safeSetData(lineS, indicators.uo!.map((d) => ({ time: toChartTime(d.time), value: d.value })));
      const ob = addLevel(chart, 70, "rgba(240,78,78,0.4)");
      const os = addLevel(chart, 30, "rgba(11,189,138,0.4)");
      return [lineS, ob, os];
    });
  }

  // ── PPO ──
  if (indicators.ppo && indicators.ppo.length > 0) {
    buildPane("ppo", paneEls.ppo, (chart) => {
      const lineS = chart.addSeries(LineSeries, { color: "#22d3ee", lineWidth: 2 as const, lastValueVisible: true, priceLineVisible: false });
      safeSetData(lineS, indicators.ppo!.map((d) => ({ time: toChartTime(d.time), value: d.value })));
      const sig = chart.addSeries(LineSeries, { color: "#fbbf24", lineWidth: 1 as const, lastValueVisible: false, priceLineVisible: false });
      safeSetData(sig, indicators.ppo!.map((d) => ({ time: toChartTime(d.time), value: d.signal })));
      const hist = chart.addSeries(HistogramSeries, { priceFormat: { type: "price" as const } });
      safeSetData(hist, indicators.ppo!.map((d) => ({
        time: toChartTime(d.time), value: d.histogram,
        color: d.histogram >= 0 ? "rgba(34,211,238,0.5)" : "rgba(240,78,78,0.4)",
      })));
      return [lineS, sig, hist];
    });
  }

  // ── RVI ──
  if (indicators.rvi && indicators.rvi.length > 0) {
    buildPane("rvi", paneEls.rvi, (chart) => {
      const lineS = chart.addSeries(LineSeries, { color: "#a78bfa", lineWidth: 2 as const, lastValueVisible: true, priceLineVisible: false });
      safeSetData(lineS, indicators.rvi!.map((d) => ({ time: toChartTime(d.time), value: d.value })));
      const sig = chart.addSeries(LineSeries, { color: "#fbbf24", lineWidth: 1 as const, lastValueVisible: false, priceLineVisible: false });
      safeSetData(sig, indicators.rvi!.map((d) => ({ time: toChartTime(d.time), value: d.signal })));
      return [lineS, sig];
    });
  }

  // ── CMO ──
  if (indicators.cmo && indicators.cmo.length > 0) {
    buildPane("cmo", paneEls.cmo, (chart) => {
      const lineS = chart.addSeries(LineSeries, { color: "#fb923c", lineWidth: 2 as const, lastValueVisible: true, priceLineVisible: false });
      safeSetData(lineS, indicators.cmo!.map((d) => ({ time: toChartTime(d.time), value: d.value })));
      const ob = addLevel(chart, 50, "rgba(240,78,78,0.4)");
      const os = addLevel(chart, -50, "rgba(11,189,138,0.4)");
      return [lineS, ob, os];
    });
  }

  // ── Force Index ──
  if (indicators.forceIndex && indicators.forceIndex.length > 0) {
    buildPane("fi", paneEls.fi, (chart) => {
      const hist = chart.addSeries(HistogramSeries, { priceFormat: { type: "price" as const } });
      safeSetData(hist, indicators.forceIndex!.map((d) => ({
        time: toChartTime(d.time), value: d.value,
        color: d.value >= 0 ? "rgba(52,211,153,0.5)" : "rgba(240,78,78,0.5)",
      })));
      return [hist];
    });
  }

  // ── Ease of Movement ──
  if (indicators.eom && indicators.eom.length > 0) {
    buildPane("eom", paneEls.eom, (chart) => {
      const hist = chart.addSeries(HistogramSeries, { priceFormat: { type: "price" as const } });
      safeSetData(hist, indicators.eom!.map((d) => ({
        time: toChartTime(d.time), value: d.value,
        color: d.value >= 0 ? "rgba(52,211,153,0.5)" : "rgba(240,78,78,0.5)",
      })));
      return [hist];
    });
  }

  // ── Mass Index ──
  if (indicators.massIndex && indicators.massIndex.length > 0) {
    buildPane("mass", paneEls.mass, (chart) => {
      const lineS = chart.addSeries(LineSeries, { color: "#f472b6", lineWidth: 2 as const, lastValueVisible: true, priceLineVisible: false });
      safeSetData(lineS, indicators.massIndex!.map((d) => ({ time: toChartTime(d.time), value: d.value })));
      const lvl = addLevel(chart, 27, "rgba(240,78,78,0.4)");
      return [lineS, lvl];
    });
  }

  // ── Klinger ──
  if (indicators.klinger && indicators.klinger.length > 0) {
    buildPane("klinger", paneEls.klinger, (chart) => {
      const lineS = chart.addSeries(LineSeries, { color: "#22d3ee", lineWidth: 2 as const, lastValueVisible: true, priceLineVisible: false });
      safeSetData(lineS, indicators.klinger!.map((d) => ({ time: toChartTime(d.time), value: d.value })));
      const sig = chart.addSeries(LineSeries, { color: "#fbbf24", lineWidth: 1 as const, lastValueVisible: false, priceLineVisible: false });
      safeSetData(sig, indicators.klinger!.map((d) => ({ time: toChartTime(d.time), value: d.signal })));
      return [lineS, sig];
    });
  }

  // ── DPO (sub-pane) ──
  if (indicators.dpo && indicators.dpo.length > 0) {
    buildPane("dpo", paneEls.dpo, (chart) => {
      const lineS = chart.addSeries(LineSeries, { color: "#a78bfa", lineWidth: 2 as const, lastValueVisible: true, priceLineVisible: false });
      safeSetData(lineS, indicators.dpo!.map((d) => ({ time: toChartTime(d.time), value: d.value })));
      const z = addLevel(chart, 0, "rgba(255,255,255,0.25)");
      return [lineS, z];
    });
  }

  // ── Elder Ray (sub-pane) ──
  if (indicators.elderRay && indicators.elderRay.length > 0) {
    buildPane("er", paneEls.er, (chart) => {
      const bullS = chart.addSeries(HistogramSeries, { priceFormat: { type: "price" as const } });
      const bearS = chart.addSeries(HistogramSeries, { priceFormat: { type: "price" as const } });
      safeSetData(bullS, indicators.elderRay!.map((d) => ({ time: toChartTime(d.time), value: d.bull, color: "rgba(52,211,153,0.5)" })));
      safeSetData(bearS, indicators.elderRay!.map((d) => ({ time: toChartTime(d.time), value: d.bear, color: "rgba(240,78,78,0.5)" })));
      return [bullS, bearS];
    });
  }

  // ── CMF ──
  if (indicators.cmf && indicators.cmf.length > 0) {
    buildPane("cmf", paneEls.cmf, (chart) => {
      const hist = chart.addSeries(HistogramSeries, { priceFormat: { type: "price" as const } });
      safeSetData(hist, indicators.cmf!.map((d) => ({
        time: toChartTime(d.time), value: d.value,
        color: d.value >= 0 ? "rgba(52,211,153,0.5)" : "rgba(240,78,78,0.5)",
      })));
      const z = addLevel(chart, 0, "rgba(255,255,255,0.25)");
      return [hist, z];
    });
  }

  // ── Time-axis sync ──
  const sync = () => {
    const r = mainChart.timeScale().getVisibleLogicalRange();
    if (!r) return;
    Object.values(paneCharts).forEach((pc) => {
      if (pc) pc.timeScale().setVisibleLogicalRange(r);
    });
  };
  mainChart.timeScale().subscribeVisibleLogicalRangeChange(sync);

  // ── Resize ──
  const onResize = () => {
    const w = mainEl.clientWidth;
    if (w) {
      mainChart.applyOptions({ width: w });
      Object.values(paneCharts).forEach((pc) => pc?.applyOptions({ width: w }));
    }
  };
  window.addEventListener("resize", onResize);

  // ── Crosshair (legend) ──
  const crosshairCbs = new Set<(info: {
    time: ChartTime | null;
    ohlc: { open: number; high: number; low: number; close: number; volume: number } | null;
    changePct: number | null;
  }) => void>();
  const firstClose = candles.length > 0 ? Number(candles[0].close) : null;
  const onCrosshair = (param: any) => {
    const info = {
      time: param.time ?? null,
      ohlc: null as any,
      changePct: null as number | null,
    };
    if (mainPriceSeries) {
      const d = param.seriesData?.get(mainPriceSeries);
      if (d && typeof d.close === "number") {
        info.ohlc = {
          open: d.open, high: d.high, low: d.low, close: d.close,
          volume: d.volume ?? 0,
        };
        if (firstClose) info.changePct = ((d.close - firstClose) / firstClose) * 100;
      }
    }
    crosshairCbs.forEach((cb) => cb(info));
  };
  mainChart.subscribeCrosshairMove(onCrosshair);

  // ── Visible range (drawings) ──
  const visibleCbs = new Set<() => void>();
  const onVisible = () => visibleCbs.forEach((cb) => cb());
  mainChart.timeScale().subscribeVisibleLogicalRangeChange(onVisible);

  // ── Toggles ──
  const applyToggles = (t: ToggleState) => {
    const safe = (key: string, visible: boolean) => {
      try { refs[key]?.applyOptions({ visible }); } catch (_) {}
    };
    const safeArr = (key: string, visible: boolean) => {
      (arrRefs[key] ?? []).forEach((l) => { try { l.applyOptions({ visible }); } catch (_) {} });
    };
    safe("sma", t.sma9 || t.sma20 || t.sma50 || t.sma200);
    safe("ema9", t.ema9); safe("ema20", t.ema20); safe("ema50", t.ema50); safe("ema200", t.ema200);
    safe("ichiTenkan", t.ichimoku); safe("ichiKijun", t.ichimoku); safe("ichiCloudA", t.ichimoku); safe("ichiCloudB", t.ichimoku);
    safe("stUpper", t.superTrend); safe("stLower", t.superTrend);
    safe("bbUpper", t.bb); safe("bbMid", t.bb); safe("bbLower", t.bb);
    safe("psar", t.psar); safe("vwap", t.vwap); safe("obv", t.obv);
    safe("volume", t.volume);
    safe("target", t.target);
    safe("trendA", t.trendlines); safe("trendR", t.trendlines);
    safe("keltUpper", t.keltner); safe("keltMid", t.keltner); safe("keltLower", t.keltner);
    safe("donUpper", t.donchian); safe("donMid", t.donchian); safe("donLower", t.donchian);
    safe("aroonUp", t.aroon); safe("aroonDown", t.aroon);
    safe("dpo", t.dpo);
    safe("elderBull", t.elderRay); safe("elderBear", t.elderRay);
    safe("envUpper", t.envelopes); safe("envLower", t.envelopes);
    safe("vp", t.volumeProfile);
    safeArr("sr", t.sr);
    safeArr("fibLevels", t.fibLevels);
    safeArr("patterns", t.patterns);
    // Pane visibility is handled by the React layout (container heights).
  };
  applyToggles(toggles);

  // ── Handle ──
  const handle: ChartHandle = {
    chart: mainChart,
    candleSeries: mainPriceSeries,
    setToggles: applyToggles,
    setChartType: (type) => {
      addMainPriceSeries(type);
      if (markersCache.length > 0 && mainPriceSeries) safeSetMarkers(mainPriceSeries, markersCache);
    },
    setSettings: (s) => {
      const scaleMode = scaleModeFor(s);
      mainEl.dataset.scaleMode = String(scaleMode);
      mainChart.applyOptions({
        grid: {
          vertLines: { color: s.showGrid ? (isDark ? "rgba(255,255,255,0.04)" : "rgba(9,9,11,0.05)") : "transparent" },
          horzLines: { color: s.showGrid ? (isDark ? "rgba(255,255,255,0.04)" : "rgba(9,9,11,0.05)") : "transparent" },
        },
        rightPriceScale: { mode: scaleMode },
        timeScale: s.barSpacing > 0 ? { barSpacing: s.barSpacing } : {},
      });
      if (mainPriceSeries && (chartType === "candle" || chartType === "hollow" || chartType === "heikin" || chartType === "renko")) {
        try {
          mainPriceSeries.applyOptions({
            upColor: chartType === "hollow" ? "rgba(0,0,0,0)" : s.upColor,
            downColor: chartType === "hollow" ? "rgba(0,0,0,0)" : s.downColor,
            borderUpColor: s.upColor,
            borderDownColor: s.downColor,
            wickUpColor: s.upColor,
            wickDownColor: s.downColor,
          });
        } catch (_) {}
      }
      // Alternative chart types: re-run the transform when its params change.
      const transformChanged =
        (chartType === "kagi" && s.kagiReversal !== settings.kagiReversal) ||
        (chartType === "pointfigure" && (s.pfBoxSize !== settings.pfBoxSize || s.pfReversal !== settings.pfReversal)) ||
        (chartType === "range" && s.rangeSize !== settings.rangeSize) ||
        (chartType === "linebreak" && s.lineBreakLines !== settings.lineBreakLines);
      if (transformChanged) {
        addMainPriceSeries(chartType, s);
      }
    },
    setCompare: addCompare,
    destroy: () => {
      window.removeEventListener("resize", onResize);
      try { mainChart.remove(); } catch (_) {}
      Object.values(paneCharts).forEach((pc) => { try { pc?.remove(); } catch (_) {} });
    },
    screenshot: () => {
      try { return mainChart.takeScreenshot(); } catch (_) { return null; }
    },
    subscribeCrosshair: (cb) => { crosshairCbs.add(cb); },
    unsubscribeCrosshair: (cb) => { crosshairCbs.delete(cb); },
    timeToCoordinate: (time) => mainChart.timeScale().timeToCoordinate(toChartTime(time)),
    priceToCoordinate: (price) => (mainPriceSeries ? mainPriceSeries.priceToCoordinate(price) : null),
    coordinateToTime: (x) => {
      const t = mainChart.timeScale().coordinateToTime(x);
      return t != null ? (t as ChartTime) : null;
    },
    coordinateToPrice: (y) => (mainPriceSeries ? mainPriceSeries.coordinateToPrice(y) : null),
    subscribeVisibleRange: (cb) => { visibleCbs.add(cb); },
    unsubscribeVisibleRange: (cb) => { visibleCbs.delete(cb); },
    getVisibleRange: () => mainChart.timeScale().getVisibleLogicalRange(),
    snapPrice: (time, price, tolerancePx) => {
      // Magnet: snap a price to the nearest OHLC value of the candle at
      // `time` when within tolerancePx (in screen pixels).
      const idx = times.indexOf(time);
      if (idx < 0) return price;
      const c = candles[idx];
      const cand = { open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) };
      const y = mainPriceSeries?.priceToCoordinate(price);
      if (y == null) return price;
      let best = price;
      let bestDist = tolerancePx;
      for (const v of [cand.open, cand.high, cand.low, cand.close]) {
        const vy = mainPriceSeries?.priceToCoordinate(v);
        if (vy == null) continue;
        const dist = Math.abs(vy - y);
        if (dist <= bestDist) { bestDist = dist; best = v; }
      }
      return best;
    },
    snapPoint: (x, y) => {
      // Full magnet: snap x to the nearest bar time (within 8px) and y to the
      // nearest OHLC of that bar (within 6px). Returns null when no bar is
      // close enough — callers fall back to the raw coordinate.
      const t = mainChart.timeScale().coordinateToTime(x);
      if (t == null) return null;
      let bestT: ChartTime | null = null;
      let bestD = 8;
      for (const ct of times) {
        const cx = mainChart.timeScale().timeToCoordinate(toChartTime(ct));
        if (cx == null) continue;
        const d = Math.abs(cx - x);
        if (d <= bestD) { bestD = d; bestT = ct; }
      }
      if (bestT == null) return null;
      const pr = mainPriceSeries?.coordinateToPrice(y);
      if (pr == null || mainPriceSeries == null) return null;
      const idx = times.indexOf(bestT);
      const c = candles[idx];
      if (!c) return { time: bestT, price: pr };
      const cand = { open: Number(c.open), high: Number(c.high), low: Number(c.low), close: Number(c.close) };
      const py = mainPriceSeries.priceToCoordinate(pr);
      if (py == null) return { time: bestT, price: pr };
      let best: number = pr;
      let bestDist = 6;
      for (const v of [cand.open, cand.high, cand.low, cand.close]) {
        const vy = mainPriceSeries.priceToCoordinate(v);
        if (vy == null) continue;
        const dist = Math.abs(vy - py);
        if (dist <= bestDist) { bestDist = dist; best = v; }
      }
      return { time: bestT, price: best };
    },
  };

  return handle;
}