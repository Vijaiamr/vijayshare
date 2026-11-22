// Chart domain types — shared across the chart module (InteractiveChart,
// ChartBuilder, toolbar, legend, settings, drawings).

import type { OHLCVPoint } from "@/lib/types";

// ─── View modes ───

/** How the price data is rendered. */
export type ChartType =
  | "candle"
  | "line"
  | "area"
  | "bar"
  | "hollow"
  | "heikin"
  | "renko"
  | "baseline"
  | "kagi"
  | "pointfigure"
  | "range"
  | "linebreak";

/** Bar interval — intraday fetched from the backend; daily is the stored
 *  base; weekly/monthly are resampled client-side. */
export type BarInterval = "1m" | "5m" | "15m" | "30m" | "1h" | "4h" | "1d" | "1w" | "1M";

/** Lookback window (how much history to show). */
export type Lookback = "1mo" | "3mo" | "6mo" | "1y" | "2y" | "5y" | "10y";

export const LOOKBACKS: { label: string; value: Lookback }[] = [
  { label: "1M", value: "1mo" },
  { label: "3M", value: "3mo" },
  { label: "6M", value: "6mo" },
  { label: "1Y", value: "1y" },
  { label: "2Y", value: "2y" },
  { label: "5Y", value: "5y" },
  { label: "10Y", value: "10y" },
];

export const INTERVALS: { label: string; value: BarInterval }[] = [
  { label: "1m", value: "1m" },
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "30m", value: "30m" },
  { label: "1h", value: "1h" },
  { label: "4h", value: "4h" },
  { label: "1D", value: "1d" },
  { label: "1W", value: "1w" },
  { label: "1M", value: "1M" },
];

export const CHART_TYPES: { label: string; value: ChartType }[] = [
  { label: "Candle", value: "candle" },
  { label: "Line", value: "line" },
  { label: "Area", value: "area" },
  { label: "Bar", value: "bar" },
  { label: "Hollow", value: "hollow" },
  { label: "Heikin-Ashi", value: "heikin" },
  { label: "Renko", value: "renko" },
  { label: "Baseline", value: "baseline" },
  { label: "Kagi", value: "kagi" },
  { label: "Point & Figure", value: "pointfigure" },
  { label: "Range", value: "range" },
  { label: "Line Break", value: "linebreak" },
];

// ─── Chart settings (style & scale) ───

export type PriceScaleMode = "normal" | "log" | "percentage" | "indexed";

export interface ChartSettings {
  logScale: boolean;
  showGrid: boolean;
  upColor: string;
  downColor: string;
  /** TradingView-style price scale modes (log is kept for back-compat). */
  priceScaleMode: PriceScaleMode;
  /** Snap drawing points to OHLC values when within tolerance. */
  magnet: boolean;
  /** Show weekend / session-break shading on the time axis. */
  sessionBreaks: boolean;
  /** Watermark text shown behind the chart (empty = off). */
  watermark: string;
  /** Bar spacing (px). 0 = auto. */
  barSpacing: number;
  /** Kagi reversal amount (% of first close). */
  kagiReversal: number;
  /** Point & Figure box size (% of first close). */
  pfBoxSize: number;
  /** Point & Figure reversal (boxes). */
  pfReversal: number;
  /** Range bar size (% of first close). */
  rangeSize: number;
  /** Line Break line count. */
  lineBreakLines: number;
}

export const DEFAULT_CHART_SETTINGS: ChartSettings = {
  logScale: false,
  showGrid: true,
  upColor: "#0bbd8a",
  downColor: "#f04e4e",
  priceScaleMode: "normal",
  magnet: true,
  sessionBreaks: true,
  watermark: "",
  barSpacing: 0,
  kagiReversal: 4,
  pfBoxSize: 1,
  pfReversal: 3,
  rangeSize: 1,
  lineBreakLines: 3,
};

// ─── Indicator parameters (editable per user) ───

export interface IndicatorSettings {
  rsiPeriod: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  bbPeriod: number;
  bbStd: number;
  adxPeriod: number;
  stochK: number;
  stochD: number;
  stochSmooth: number;
  cciPeriod: number;
  atrPeriod: number;
  superTrendMultiplier: number;
  superTrendPeriod: number;
  psarStep: number;
  psarMax: number;
  // Phase D — expanded indicator library
  smaPeriod: number;
  keltnerPeriod: number;
  keltnerMult: number;
  donchianPeriod: number;
  aroonPeriod: number;
  mfiPeriod: number;
  rocPeriod: number;
  momPeriod: number;
  stochRsiPeriod: number;
  aoFast: number;
  aoSlow: number;
  cmfPeriod: number;
  trixPeriod: number;
  uoFast: number;
  uoMid: number;
  uoSlow: number;
  ppoFast: number;
  ppoSlow: number;
  rviPeriod: number;
  envPeriod: number;
  envPct: number;
  fiPeriod: number;
  eomPeriod: number;
  massPeriod: number;
  klingerFast: number;
  klingerSlow: number;
  dpoPeriod: number;
  erPeriod: number;
  cmoPeriod: number;
  williamsPeriod: number;
}

export const DEFAULT_INDICATOR_SETTINGS: IndicatorSettings = {
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  bbPeriod: 20,
  bbStd: 2,
  adxPeriod: 14,
  stochK: 14,
  stochD: 3,
  stochSmooth: 3,
  cciPeriod: 20,
  atrPeriod: 14,
  superTrendMultiplier: 3,
  superTrendPeriod: 10,
  psarStep: 0.02,
  psarMax: 0.2,
  smaPeriod: 20,
  keltnerPeriod: 20,
  keltnerMult: 2,
  donchianPeriod: 20,
  aroonPeriod: 25,
  mfiPeriod: 14,
  rocPeriod: 12,
  momPeriod: 10,
  stochRsiPeriod: 14,
  aoFast: 5,
  aoSlow: 34,
  cmfPeriod: 20,
  trixPeriod: 15,
  uoFast: 7,
  uoMid: 14,
  uoSlow: 28,
  ppoFast: 12,
  ppoSlow: 26,
  rviPeriod: 10,
  envPeriod: 20,
  envPct: 2.5,
  fiPeriod: 13,
  eomPeriod: 14,
  massPeriod: 25,
  klingerFast: 34,
  klingerSlow: 55,
  dpoPeriod: 20,
  erPeriod: 14,
  cmoPeriod: 14,
  williamsPeriod: 14,
};

// ─── Drawings ───

export type DrawingType =
  | "cursor"
  | "trendline"
  | "ray"
  | "extended"
  | "hline"
  | "vline"
  | "channel"
  | "fib"
  | "fibExt"
  | "fibFan"
  | "fibTime"
  | "gannFan"
  | "pitchfork"
  | "rect"
  | "ellipse"
  | "text"
  | "label"
  | "arrow"
  | "measure"
  | "abcd"
  | "xabcd"
  | "elliott";

/** Chart time value: yyyy-mm-dd string (daily) or epoch seconds (intraday). */
export type ChartTime = string | number;

export interface DrawingPoint {
  time: ChartTime;
  price: number;
}

export interface ChartDrawing {
  id: string;
  type: DrawingType;
  points: DrawingPoint[];
  text?: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  /** Per-drawing style (optional — falls back to the global drawing color). */
  lineStyle?: "solid" | "dashed" | "dotted";
  lineWidth?: 1 | 2 | 3 | 4;
  opacity?: number; // 0–1
  /** Locked drawings can be selected but not moved/edited/deleted. */
  locked?: boolean;
}

export const DRAWING_TOOLS: { label: string; value: DrawingType }[] = [
  { label: "Cursor", value: "cursor" },
  { label: "Trendline", value: "trendline" },
  { label: "Ray", value: "ray" },
  { label: "Extended", value: "extended" },
  { label: "H-Line", value: "hline" },
  { label: "V-Line", value: "vline" },
  { label: "Channel", value: "channel" },
  { label: "Fib Retrace", value: "fib" },
  { label: "Fib Ext", value: "fibExt" },
  { label: "Fib Fan", value: "fibFan" },
  { label: "Fib Time", value: "fibTime" },
  { label: "Gann Fan", value: "gannFan" },
  { label: "Pitchfork", value: "pitchfork" },
  { label: "Rect", value: "rect" },
  { label: "Ellipse", value: "ellipse" },
  { label: "Text", value: "text" },
  { label: "Label", value: "label" },
  { label: "Arrow", value: "arrow" },
  { label: "Measure", value: "measure" },
  { label: "ABCD", value: "abcd" },
  { label: "XABCD", value: "xabcd" },
  { label: "Elliott", value: "elliott" },
];

// ─── Compare ───

export interface CompareSeries {
  ticker: string;
  color: string;
  data: { time: ChartTime; value: number }[];
}

// ─── Chart handle (imperative API returned by ChartBuilder) ───

export interface ChartHandle {
  chart: import("lightweight-charts").IChartApi;
  candleSeries: import("lightweight-charts").ISeriesApi<"Candlestick"> | null;
  setToggles(toggles: Record<string, boolean>): void;
  setChartType(type: ChartType): void;
  setSettings(settings: ChartSettings): void;
  setCompare(series: CompareSeries[]): void;
  destroy(): void;
  screenshot(): HTMLCanvasElement | null;
  subscribeCrosshair(
    cb: (info: {
      time: ChartTime | null;
      ohlc: { open: number; high: number; low: number; close: number; volume: number } | null;
      changePct: number | null;
    }) => void,
  ): void;
  unsubscribeCrosshair(cb: (info: {
    time: ChartTime | null;
    ohlc: { open: number; high: number; low: number; close: number; volume: number } | null;
    changePct: number | null;
  }) => void): void;
  // Coordinate helpers for the drawing layer
  timeToCoordinate(time: ChartTime): number | null;
  priceToCoordinate(price: number): number | null;
  coordinateToTime(x: number): ChartTime | null;
  coordinateToPrice(y: number): number | null;
  subscribeVisibleRange(cb: () => void): void;
  unsubscribeVisibleRange(cb: () => void): void;
  getVisibleRange(): { from: number; to: number } | null;
  /** Snap a price to the nearest OHLC value within tolerance (magnet). */
  snapPrice(time: ChartTime, price: number, tolerancePx: number): number;
  /** Full magnet: snap x→nearest bar time, y→nearest OHLC. Null when no bar
   *  is close enough. */
  snapPoint(x: number, y: number): { time: ChartTime; price: number } | null;
}

// ─── Pane definitions ───

export interface PaneDef {
  key: string;
  label: string;
  height: number; // content height in px (label bar added on top)
}

export const PANE_DEFS: PaneDef[] = [
  { key: "rsi", label: "RSI", height: 100 },
  { key: "macd", label: "MACD", height: 100 },
  { key: "adx", label: "ADX", height: 100 },
  { key: "stoch", label: "Stoch", height: 100 },
  { key: "cci", label: "CCI", height: 100 },
  { key: "atr", label: "ATR", height: 100 },
  { key: "williams", label: "Williams %R", height: 100 },
  { key: "mfi", label: "MFI", height: 100 },
  { key: "stochrsi", label: "Stoch RSI", height: 100 },
  { key: "ao", label: "AO", height: 100 },
  { key: "roc", label: "ROC", height: 100 },
  { key: "mom", label: "Momentum", height: 100 },
  { key: "trix", label: "TRIX", height: 100 },
  { key: "uo", label: "UO", height: 100 },
  { key: "ppo", label: "PPO", height: 100 },
  { key: "rvi", label: "RVI", height: 100 },
  { key: "cmo", label: "CMO", height: 100 },
  { key: "fi", label: "Force Index", height: 100 },
  { key: "eom", label: "EoM", height: 100 },
  { key: "mass", label: "Mass Index", height: 100 },
  { key: "klinger", label: "Klinger", height: 100 },
  { key: "dpo", label: "DPO", height: 100 },
  { key: "er", label: "Elder Ray", height: 100 },
  { key: "cmf", label: "CMF", height: 100 },
];

export type PaneKey =
  | "rsi" | "macd" | "adx" | "stoch" | "cci"
  | "atr" | "williams" | "mfi" | "stochrsi" | "ao"
  | "roc" | "mom" | "trix" | "uo" | "ppo"
  | "rvi" | "cmo" | "fi" | "eom" | "mass"
  | "klinger" | "dpo" | "er" | "cmf";

// ─── Toggle keys (single source of truth) ───

export const TOGGLE_KEYS = [
  // Trend overlays (main pane)
  "sma9", "sma20", "sma50", "sma200", "ema9", "ema20", "ema50", "ema200",
  "ichimoku", "superTrend", "psar", "vwap", "keltner", "donchian", "aroon",
  "dpo", "elderRay", "envelopes",
  // Oscillators (sub-panes)
  "rsi", "macd", "adx", "stoch", "cci", "atr", "williams", "mfi", "stochrsi",
  "ao", "roc", "mom", "trix", "uo", "ppo", "rvi", "cmo", "fi", "eom", "mass",
  "klinger", "er", "cmf",
  // Volume
  "volume", "obv", "volumeProfile",
  // Volatility overlays
  "bb",
  // Structure / analysis
  "sr", "orderBlocks", "fvg", "fibLevels", "trendlines", "target", "patterns",
] as const;

export type ToggleKey = (typeof TOGGLE_KEYS)[number];

export type ToggleState = Record<ToggleKey, boolean>;

export const DEFAULT_TOGGLES: ToggleState = {
  sma9: false, sma20: false, sma50: false, sma200: false,
  ema9: false, ema20: false, ema50: false, ema200: false,
  ichimoku: false, superTrend: false, psar: false, vwap: false,
  keltner: false, donchian: false, aroon: false, dpo: false,
  elderRay: false, envelopes: false,
  rsi: false, macd: false, adx: false, stoch: false, cci: false,
  atr: false, williams: false, mfi: false, stochrsi: false, ao: false,
  roc: false, mom: false, trix: false, uo: false, ppo: false,
  rvi: false, cmo: false, fi: false, eom: false, mass: false,
  klinger: false, er: false, cmf: false,
  volume: false, obv: false, volumeProfile: false,
  bb: false,
  sr: false, orderBlocks: false, fvg: false, fibLevels: false,
  trendlines: true, target: false, patterns: true,
};

// ─── Indicator menu categories (TradingView-style) ───

export interface IndicatorCategory {
  label: string;
  keys: ToggleKey[];
}

export const INDICATOR_CATEGORIES: IndicatorCategory[] = [
  {
    label: "Trend",
    keys: ["sma9", "sma20", "sma50", "sma200", "ema9", "ema20", "ema50", "ema200", "ichimoku", "superTrend", "psar", "vwap", "keltner", "donchian", "aroon", "dpo", "elderRay", "envelopes"],
  },
  {
    label: "Oscillators",
    keys: ["rsi", "macd", "adx", "stoch", "cci", "atr", "williams", "mfi", "stochrsi", "ao", "roc", "mom", "trix", "uo", "ppo", "rvi", "cmo", "fi", "eom", "mass", "klinger", "er", "cmf"],
  },
  {
    label: "Volume",
    keys: ["volume", "obv", "volumeProfile"],
  },
  {
    label: "Volatility",
    keys: ["bb"],
  },
  {
    label: "Structure",
    keys: ["sr", "orderBlocks", "fvg", "fibLevels", "trendlines", "target", "patterns"],
  },
];

// ─── Replay ───

export interface ReplayState {
  active: boolean;
  index: number; // number of candles visible (0..total)
  playing: boolean;
  speed: number; // candles per tick
}

// ─── Template (saved chart configuration) ───

export interface ChartTemplate {
  id: string;
  name: string;
  chartType: ChartType;
  interval: BarInterval;
  lookback: Lookback;
  toggles: ToggleState;
  settings: ChartSettings;
  indicatorSettings: IndicatorSettings;
  createdAt: string;
}

// ─── Data window row (crosshair readout) ───

export interface DataWindowRow {
  label: string;
  value: string;
  color?: string;
}