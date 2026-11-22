"""
Pydantic models for the VijayMaruthi Wealth API.
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


# ── Request Models ──

class AnalyzeRequest(BaseModel):
    ticker: str = Field(..., description="Ticker symbol (e.g. AAPL, HDFCBANK.NS)")
    period: str = Field("1y", description="Data period (1mo, 3mo, 6mo, 1y, 2y, 5y, max)")
    sentiment: bool = Field(False, description="Enable news NLP sentiment analysis")
    save_db: bool = Field(True, description="Persist to SQLite database")
    force: bool = Field(False, description="Skip cache, force fresh analysis")
    manual_data: Optional[str] = Field(None, description="Path to manual override JSON")
    options: bool = Field(False, description="Include options analysis")


class BatchAnalyzeRequest(BaseModel):
    tickers: List[str] = Field(..., description="List of ticker symbols")
    period: str = Field("1y")
    sentiment: bool = Field(False)
    save_db: bool = Field(True)
    force: bool = Field(False)


class BacktestRequest(BaseModel):
    ticker: str = Field(..., description="Ticker to backtest")
    years: int = Field(3, description="Years of history", ge=1, le=10)
    rebalance_days: int = Field(63, description="Rebalance interval in trading days", ge=5)


# ── Response Models ──

class EvidenceGroup(BaseModel):
    technical: List[str] = Field(default_factory=list)
    fundamental: List[str] = Field(default_factory=list)


class QuantamentalResult(BaseModel):
    blended_score: float
    blended_rating: str
    technical_score: float
    technical_confidence: float
    technical_signal: str
    fundamental_score: float
    fundamental_rating: str
    sentiment_score: float = 0.0
    sentiment_label: str = "Neutral"
    sentiment_article_count: int = 0
    market_cap_category: str
    weights: Dict[str, float]
    weight_adjustments: List[str] = Field(default_factory=list)
    evidence: EvidenceGroup


class HealthCheck(BaseModel):
    """v3 health methodology — per-stock scan quality gates."""
    checks: Dict[str, bool] = Field(default_factory=dict)
    health_pass: bool = False
    report_nan: int = 0
    report_len: int = 0
    sector: Optional[str] = None
    risk_flags: Any = None
    yoy_rev: Any = None
    yoy_ni: Any = None
    fund_rating: str = "N/A"
    quality_gates: List[str] = Field(default_factory=list)
    technical_signal: Optional[str] = None


class TickerAnalysisResponse(BaseModel):
    ticker: str
    timestamp: str = Field(default_factory=lambda: datetime.now().isoformat())
    signal: str
    confidence: float
    price: float
    quantamental: QuantamentalResult
    market_structure: Dict[str, Any] = Field(default_factory=dict)
    trend: Dict[str, Any] = Field(default_factory=dict)
    support_resistance: Dict[str, Any] = Field(default_factory=dict)
    indicators: Dict[str, Any] = Field(default_factory=dict)
    candlestick: Dict[str, Any] = Field(default_factory=dict)
    divergence: List[Dict[str, Any]] = Field(default_factory=list)
    wyckoff: Dict[str, Any] = Field(default_factory=dict)
    gann: Dict[str, Any] = Field(default_factory=dict)
    sentiment: Dict[str, Any] = Field(default_factory=dict)
    fundamentals: Dict[str, Any] = Field(default_factory=dict)
    chart_url: Optional[str] = None
    report_text: Optional[str] = None
    cached: bool = False
    cached_at: Optional[str] = None
    quality_gates: List[str] = Field(default_factory=list)
    technical_signal: Optional[str] = None
    health: Optional[HealthCheck] = None
    # Real-engine trade levels (from _classify_signal) — used by the Auto Pilot
    # so it trades on the SAME analysis engine as the rest of the platform.
    entry_zone: Optional[List[Optional[float]]] = None
    targets: List[float] = Field(default_factory=list)
    invalidation: Optional[float] = None
    # Confluence confirmation gate (multi-signal convolution, 2026-09-05)
    confirm_score: float = 0.0
    confirm_count: int = 0
    confirm_details: Dict[str, Any] = Field(default_factory=dict)
    # Weighted convolution (2026-09-05) — replaces the flat gate.
    conv_technical: Dict[str, Any] = Field(default_factory=dict)
    conv_fundamental: Dict[str, Any] = Field(default_factory=dict)


class HeatmapRow(BaseModel):
    rank: int
    ticker: str
    qm_rating: str
    qm_score: float
    tech_signal: str
    tech_confidence: float
    tech_score: float
    fund_rating: str
    fund_score: float
    cap_category: str
    price: float
    cached: bool = False
    detected_patterns: List["PatternSummary"] = []


class PatternSummary(BaseModel):
    """Lightweight pattern summary for market-wide scans (Tier 2, 2026-09-06)."""
    type: str
    direction: str = "bullish"
    confidence: int = 0
    status: str = "forming"
    entry: Optional[float] = None
    stop_loss: Optional[float] = None
    target: Optional[float] = None
    risk_reward: Optional[float] = None
    confirmations: List[str] = []
    timeframe: str = "daily"
    multi_tf_boost: float = 1.0


class DashboardRow(BaseModel):
    """Enriched row with DB trend data for the full-picture dashboard."""
    rank: int
    ticker: str
    qm_rating: str
    qm_score: float
    tech_signal: str
    tech_confidence: float
    tech_score: float
    fund_rating: str
    fund_score: float
    cap_category: str
    price: float
    cached: bool = False
    trend: str = "stable"
    score_change: float = 0.0
    last_analyzed: Optional[str] = None
    history_runs: int = 0
    health_pass: Optional[bool] = None
    detected_patterns: List["PatternSummary"] = []


class DashboardResponse(BaseModel):
    rows: List[DashboardRow]
    summary: Dict[str, int] = Field(default_factory=dict)
    db_entries: int = 0
    total_nse_count: int = 0
    pending_count: int = 0
    generated_at: str = Field(default_factory=lambda: datetime.now().isoformat())
    health_summary: Dict[str, int] = Field(default_factory=dict)


class BatchAnalysisResponse(BaseModel):
    rows: List[HeatmapRow]
    summary: Dict[str, int] = Field(default_factory=dict)
    cached_count: int = 0
    fresh_count: int = 0


class BacktestSignalResponse(BaseModel):
    date: str
    price: float
    qm_rating: str
    qm_score: float
    forward_return_90d: Optional[float] = None


class BacktestGroupResult(BaseModel):
    group: str
    count: int
    avg_return_90d: float
    win_rate_90d: float
    sharpe_90d: float


class BacktestComparison(BaseModel):
    methodology: str
    overall_win_rate_90d: float
    avg_return_90d: float
    sharpe_90d: float
    spread_return_90d: float
    total_trades: int


class BacktestResponse(BaseModel):
    ticker: str
    total_signals: int
    group_results: List[BacktestGroupResult] = Field(default_factory=list)
    comparisons: List[BacktestComparison] = Field(default_factory=list)


class PortfolioRow(BaseModel):
    ticker: str
    date: str
    price: Optional[float]
    qm_rating: str
    qm_score: float
    tech_signal: str
    tech_score: float
    fund_score: float
    cap_category: str
    trend: str
    score_change: float


class HistoryPoint(BaseModel):
    date: str
    rating: str
    score: float


class TickerHistoryResponse(BaseModel):
    ticker: str
    runs: int
    current_rating: Optional[str]
    current_score: Optional[float]
    trend: str
    history: List[HistoryPoint]


class OHLCVPoint(BaseModel):
    time: str  # ISO date string
    open: float
    high: float
    low: float
    close: float
    volume: int


class OHLCVResponse(BaseModel):
    ticker: str
    period: str
    candles: List[OHLCVPoint]


class LastPriceResponse(BaseModel):
    ticker: str
    price: Optional[float]
    time: Optional[str] = None
    source: str = "daily"


class NseSymbolsResponse(BaseModel):
    total: int
    symbols: List[str]


class ScanProgress(BaseModel):
    scan_id: str
    status: str  # "starting" | "running" | "completed" | "failed"
    total: int = 0
    completed: int = 0
    failed: int = 0
    errors: List[str] = Field(default_factory=list)


class ScanStartResponse(BaseModel):
    scan_id: str
    status: str = "started"


class HealthResponse(BaseModel):
    status: str = "ok"
    version: str = "4.0.0"
    modules: Dict[str, bool] = Field(default_factory=dict)
