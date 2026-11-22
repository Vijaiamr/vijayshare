// TypeScript types matching the Python API models

export interface QuantamentalResult {
  blended_score: number;
  blended_rating: Rating;
  technical_score: number;
  technical_confidence: number;
  technical_signal: string;
  fundamental_score: number;
  fundamental_rating: string;
  sentiment_score: number;
  sentiment_label: string;
  sentiment_article_count: number;
  market_cap_category: string;
  weights: Record<string, number>;
  weight_adjustments: string[];
  evidence: {
    technical: string[];
    fundamental: string[];
  };
}

export type Rating = "Strong Buy" | "Buy" | "Hold" | "Sell" | "Strong Sell";

export interface HeatmapRow {
  rank: number;
  ticker: string;
  qm_rating: Rating;
  qm_score: number;
  tech_signal: string;
  /** API field name is tech_confidence (from Pydantic model) */
  tech_confidence: number;
  tech_score: number;
  fund_rating: string;
  fund_score: number;
  cap_category: string;
  price: number;
  cached?: boolean;
  /** Engine-detected chart patterns (Tier 2 market-wide scan) */
  detected_patterns?: PatternSummary[];
}

export interface DashboardRow extends HeatmapRow {
  trend: "improving" | "deteriorating" | "stable";
  score_change: number;
  last_analyzed: string | null;
  history_runs: number;
  /** v3 health methodology — null when the row predates health tracking */
  health_pass?: boolean | null;
  /** Engine-detected chart patterns (Tier 2 market-wide scan) */
  detected_patterns?: PatternSummary[];
}

export interface PatternSummary {
  type: string;
  direction: "bullish" | "bearish";
  confidence: number;
  status: "forming" | "active" | "completed" | "failed";
  entry?: number | null;
  stop_loss?: number | null;
  target?: number | null;
  risk_reward?: number | null;
  confirmations?: string[];
  timeframe?: string;
  multi_tf_boost?: number;
}

export interface DashboardResponse {
  rows: DashboardRow[];
  summary: { buy: number; hold: number; sell: number; total: number };
  db_entries: number;
  total_nse_count: number;
  pending_count?: number;
  generated_at: string;
  health_summary?: { known: number; pass: number; fail: number };
}

export interface LastPriceResponse {
  ticker: string;
  price: number | null;
  time: string | null;
  source: string;
}

export interface NseSymbolsResponse {
  total: number;
  symbols: string[];
}

export interface ScanProgress {
  scan_id: string;
  status: "starting" | "running" | "completed" | "failed";
  total: number;
  completed: number;
  failed: number;
  errors: string[];
}

export interface ScanStartResponse {
  scan_id: string;
  status: string;
}

export interface BatchResult {
  rows: HeatmapRow[];
  summary: { buy: number; hold: number; sell: number; total: number };
  cached_count?: number;
  fresh_count?: number;
}

export interface TickerAnalysis {
  ticker: string;
  signal: string;
  confidence: number;
  price: number;
  quantamental: QuantamentalResult;
  market_structure: Record<string, unknown>;
  trend: Record<string, unknown>;
  support_resistance: Record<string, unknown>;
  indicators: Record<string, unknown>;
  candlestick: Record<string, unknown>;
  divergence: Record<string, unknown>[];
  wyckoff: Record<string, unknown>;
  gann: Record<string, unknown>;
  sentiment: Record<string, unknown>;
  fundamentals: Record<string, unknown>;
  chart_url: string | null;
  report_text: string | null;
  cached?: boolean;
  cached_at?: string | null;
  // Confluence confirmation gate (multi-signal convolution, 2026-09-05)
  confirm_score?: number;
  confirm_count?: number;
  confirm_details?: Record<string, unknown>;
  // Weighted convolution (2026-09-05) — replaces the flat gate.
  conv_technical?: {
    score?: number;
    raw_total?: number;
    components?: Record<string, Record<string, unknown>>;
    pattern_votes?: Record<string, unknown>;
    pattern_majority?: boolean;
  };
  conv_fundamental?: {
    score?: number;
    factors?: Record<string, unknown>;
    cap_applied?: boolean;
    cap_reason?: string | null;
  };
}

export interface PortfolioRow {
  ticker: string;
  date: string;
  price: number | null;
  qm_rating: Rating;
  qm_score: number;
  tech_signal: string;
  tech_score: number;
  fund_score: number;
  cap_category: string;
  trend: "improving" | "deteriorating" | "stable";
  score_change: number;
}

export interface HistoryPoint {
  date: string;
  rating: string;
  score: number;
}

export interface TickerHistory {
  ticker: string;
  runs: number;
  current_rating: string | null;
  current_score: number | null;
  trend: string;
  history: HistoryPoint[];
}

export interface OHLCVPoint {
  time: string;  // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface OHLCVResponse {
  ticker: string;
  period: string;
  candles: OHLCVPoint[];
}

// ─── Default Indian stock watchlist ───

export const INDIAN_WATCHLIST = [
  "TCS.NS",
  "RELIANCE.NS",
  "HDFCBANK.NS",
  "INFY.NS",
  "ICICIBANK.NS",
  "HINDUNILVR.NS",
  "ITC.NS",
  "SBIN.NS",
  "BHARTIARTL.NS",
  "KOTAKBANK.NS",
  "WIPRO.NS",
  "AXISBANK.NS",
  "MARUTI.NS",
  "BAJFINANCE.NS",
  "ADANIENT.NS",
  "NTPC.NS",
  "POWERGRID.NS",
  "TITAN.NS",
  "ASIANPAINT.NS",
  "SUNPHARMA.NS",
] as const;

export type IndianTicker = (typeof INDIAN_WATCHLIST)[number];

// ─── Backtest types ───

export interface BacktestRequest {
  ticker: string;
  years: number;
  rebalance_days: number;
}

export interface BacktestGroupResult {
  group: string;
  count: number;
  avg_return_90d: number;
  win_rate_90d: number;
  sharpe_90d: number;
}

export interface BacktestComparison {
  methodology: string;
  overall_win_rate_90d: number;
  avg_return_90d: number;
  sharpe_90d: number;
  spread_return_90d: number;
  total_trades: number;
}

export interface BacktestResponse {
  ticker: string;
  total_signals: number;
  group_results: BacktestGroupResult[];
  comparisons: BacktestComparison[];
}

// ─── Pattern Backtest Types ────────────────────────────────────────────────────

export interface PatternTrade {
  pattern_type: string;
  direction: "bullish" | "bearish";
  confidence: number;
  entry_date: string;
  entry_price: number;
  stop_loss: number;
  target: number;
  exit_date: string;
  exit_price: number;
  r_multiple: number;
  bars_held: number;
  result: "win" | "loss" | "scratch";
  trend_at_entry: "uptrend" | "downtrend" | "neutral";
  confidence_breakdown?: Record<string, number>;
  entry_checklist?: Record<string, boolean>;
  failure_risk?: Record<string, number>;
  multi_tf_boost?: number;
  timeframe?: string;
}

export interface PerPatternStats {
  count: number;
  wins: number;
  losses: number;
  scratches: number;
  win_rate: number;
  total_r: number;
  avg_r: number;
}

export interface DetectedPattern {
  type: string;
  direction: string;
  confidence: number;
  confidence_breakdown: Record<string, number>;
  entry_checklist: Record<string, boolean>;
  failure_risk: Record<string, number>;
  multi_tf_boost: number;
  timeframe: string;
}

export interface PatternBacktestResponse {
  ticker: string;
  total_trades: number;
  wins: number;
  losses: number;
  scratches: number;
  win_rate: number;
  total_r: number;
  avg_win_r: number;
  avg_loss_r: number;
  trades: PatternTrade[];
  per_pattern: Record<string, PerPatternStats>;
  detected_patterns?: DetectedPattern[];
  error?: string;
  note?: string;
}

// ── Fundamentals (for Convolution view) ──

export type FundamentalVerdict =
  | "Good"
  | "Neutral"
  | "Bad"
  | "N/A (data)"
  | "N/A (sector)";

export interface FundamentalMetric {
  value: number | null;
  verdict: FundamentalVerdict;
  label: string;
  bonus?: boolean;
}

export interface FundamentalOverall {
  score: number;
  good: number;
  neutral: number;
  bad: number;
  na_data: number;
  na_sector: number;
  total_scored: number;
  signal_ratio: number;
  quality_breadth: number;
  good_pct: number;
  neutral_pct: number;
  bad_pct: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  band: string;
}

export interface FundamentalsData {
  ticker: string;
  name: string;
  sector: string;
  industry: string;
  market_cap: number;
  currency: string;
  current_price: number;
  day_high: number;
  day_low: number;
  fifty_two_week_high: number;
  fifty_two_week_low: number;
  pe_trailing: number;
  pe_forward: number;
  pb_ratio: number;
  ps_ratio: number;
  peg_ratio: number;
  dividend_yield: number;
  eps_trailing: number;
  eps_forward: number;
  book_value: number;
  revenue: number;
  revenue_growth: number;
  net_income: number;
  profit_margin: number;
  operating_margin: number;
  roe: number;
  roa: number;
  debt_to_equity: number;
  current_ratio: number;
  free_cash_flow: number;
  beta: number;
  avg_volume: number;
  shares_outstanding: number;
  held_by_insiders: number;
  held_by_institutions: number;
  short_ratio: number;
  ex_dividend_date: string;
  earnings_date: string;
  analyst_target: number;
  analyst_recommendation: string;
  fundamental_score: number;
  // ── Extended full-fundamentals fields ──
  ebitda: number;
  ebitda_margin: number;
  gross_profit: number;
  gross_margin: number;
  total_debt: number;
  total_cash: number;
  enterprise_value: number;
  ev_to_ebitda: number;
  payout_ratio: number;
  earnings_growth: number;
  revenue_per_share: number;
  operating_cash_flow: number;
  target_low: number;
  target_high: number;
  recommendation_mean: number;
  quick_ratio: number;
  roic: number | null;
  analyst_upside: number | null;
  is_financial: boolean;
  scorecard: Record<string, FundamentalMetric>;
  overall: FundamentalOverall;
}

// ────────────────────────────────────────────────────────────────────────────
// Market-wide Sector Rotation / Relative Strength (Feature 1)
// Served by GET /api/market (server-side aggregation over the snapshot +
// fundamentals sector mapping). Mirrors the "Market" nav page.
// ────────────────────────────────────────────────────────────────────────────

/** Rotation phase classification for a sector. */
export type SectorPhase = "Leading" | "Improving" | "Weakening" | "Lagging";

/** One sector's aggregate statistics. */
export interface SectorStat {
  sector: string;
  /** Number of analysed tickers mapped to this sector. */
  count: number;
  /** Average blended QM score (0-100) across the sector. */
  avg_qm_score: number;
  /** Average technical/momentum score (0-100) across the sector. */
  avg_tech_score: number;
  /** Average fundamental score (0-100) across the sector. */
  avg_fund_score: number;
  /** % of sector stocks rated Buy / Strong Buy (0-100). */
  buy_pct: number;
  /** % of sector stocks with an improving trend (0-100). */
  improving_pct: number;
  /** % of sector stocks with a deteriorating trend (0-100). */
  deteriorating_pct: number;
  /** Relative-strength percentile (1-99) vs all sectors, by avg_qm_score. */
  rs_percentile: number;
  /** Rotation phase derived from avg score + improving breadth. */
  phase: SectorPhase;
  /** Top tickers in the sector by qm_score (for the ledger). */
  leaders: MarketTicker[];
}

/** A single ticker row inside a sector (for the breakout / leader ledger). */
export interface MarketTicker {
  ticker: string;
  qm_score: number;
  qm_rating: string;
  tech_score: number;
  tech_signal: string;
  fund_score: number;
  trend: string;
  score_change: number;
  price: number;
  cap_category: string;
}

/** A single live index quote (NIFTY 50 / SENSEX / BANK NIFTY). */
export interface MarketIndex {
  symbol: string;
  name: string;
  price: number;
  change_pct: number;
  currency: string;
}

/** Full response of GET /api/market. */
export interface MarketResponse {
  generated_at: string;
  total_tickers: number;
  sectors: SectorStat[];
  /** Live index quotes (NIFTY 50 / SENSEX / BANK NIFTY) from Yahoo Finance. */
  indices: MarketIndex[];
  /** Market-wide breadth summary. */
  breadth: {
    total: number;
    buy: number;
    hold: number;
    sell: number;
    improving: number;
    deteriorating: number;
    stable: number;
    avg_qm_score: number;
  };
  /** Top movers across the whole market (largest positive score_change). */
  breakout_ledger: MarketTicker[];
}

// ── Deterministic analyzer (analysis_app) ──
export interface DeterministicHealth {
  status: string;
  snapshot_dir: string;
  snapshot_date: string | null;
  snapshot_sha: string | null;
  tickers: number;
  ohlcv_rows: number;
  fundamentals: number;
}

export interface DeterministicUniverse {
  count: number;
  universe_sha: string;
  tickers: string[];
}

export interface DeterministicState {
  regime: string;
  setup: string;
  position: string;
  reason: string;
  pattern_type: string;
  pattern_direction: string;
  entry: number | null;
  stop: number | null;
  target: number | null;
  risk_reward: number | null;
  gates: string[];
}

export interface DeterministicStock {
  ticker: string;
  as_of: string;
  price: number | null;
  signal: string;
  confidence: number;
  technical_signal: string;
  state: DeterministicState;
  timeline: { bar: string; position: string; price: number; cause: string }[];
  error: string;
}

export interface DeterministicRunSummary {
  run_id: string;
  as_of: string | null;
  tickers: number | null;
  analyzed: number | null;
  errors: number | null;
  run_sha256: string | null;
}

export interface DeterministicRunResponse {
  run_id: string;
  manifest: Record<string, unknown>;
  results: DeterministicStock[];
}

export interface DeterministicRunDetail {
  manifest: Record<string, unknown>;
  ranking: Record<string, string>[];
}
