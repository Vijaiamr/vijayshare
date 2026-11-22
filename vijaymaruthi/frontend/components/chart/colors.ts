// Chart series palette — single source of truth for chart hues.
// Desaturated institutional terminal palette (dark-first).

export const CHART_SERIES_COLORS = {
  ema9: "#34d399",
  ema20: "#38bdf8",
  ema50: "#fbbf24",
  ema200: "#fb7185",
  ichimoku: "#a78bfa",
  superTrend: "#10b981",
  bb: "#818cf8",
  rsi: "#f472b6",
  macd: "#22d3ee",
  adx: "#fbbf24",
  stoch: "#a78bfa",
  cci: "#fb923c",
  volume: "#6b7280",
  sr: "#2dd4bf",
  orderBlocks: "#fb923c",
  fvg: "#facc15",
  fib: "#22d3ee",
  vp: "#8b8b8b",
  trendlines: "#a3e635",
  target: "#71717a",
  patterns: "#a78bfa",
  psar: "#f472b6",
  vwap: "#38bdf8",
  obv: "#34d399",
  up: "#0bbd8a",
  down: "#f04e4e",
} as const;

export const COMPARE_COLORS = [
  "#38bdf8",
  "#fbbf24",
  "#a78bfa",
  "#fb7185",
] as const;

export const DRAWING_COLORS = [
  "#38bdf8",
  "#fbbf24",
  "#a78bfa",
  "#34d399",
  "#fb7185",
  "#fb923c",
] as const;