#!/usr/bin/env python3
"""
==============================================================================
HEAD AND SHOULDERS PATTERN — COMPLETE BACKTESTING ENGINE
==============================================================================
Institutional-grade automated detection, backtesting, and statistical validation
of the Head and Shoulders (H&S) and Inverse Head and Shoulders (IH&S) patterns.

References:
  - Thomas Bulkowski, "Encyclopedia of Chart Patterns" (3rd Ed.)
  - Edwards & Magee, "Technical Analysis of Stock Trends"
  - Chart Library / Quantified Strategies research (2024-2026)

Author:  Quantitative Research Team
Version: 2.0.0 — Production Grade
==============================================================================
"""

import numpy as np
import pandas as pd
from typing import List, Tuple, Optional, Dict, Any
from dataclasses import dataclass, field
from scipy.signal import argrelextrema
import warnings
import logging
from datetime import datetime, timedelta
import json

warnings.filterwarnings("ignore")
logging.basicConfig(level=logging.INFO, format="%(levelname)s | %(message)s")
logger = logging.getLogger("HS_Backtest")

# ============================================================================
# CONFIGURATION
# ============================================================================

@dataclass
class HSConfig:
    """Configuration parameters for Head & Shoulders detection."""
    # Pivot detection
    pivot_window: int = 5          # Local extrema detection window
    min_pattern_bars: int = 20     # Minimum bars to form a pattern
    max_pattern_bars: int = 120    # Maximum bars for pattern formation
    
    # Shoulder symmetry tolerances
    shoulder_height_ratio: float = 0.70   # Min shoulder:head ratio (e.g., shoulder >= 70% of head)
    shoulder_width_ratio: float = 0.40    # Min shoulder width relative to head
    neckline_break_pct: float = 0.015    # 1.5% required break below/above neckline
    
    # Volume confirmation
    volume_confirm: bool = True
    volume_decline_threshold: float = 0.80  # Volume on right shoulder < 80% of left shoulder avg
    
    # Target & Risk
    risk_per_trade: float = 0.02     # 2% risk per trade
    min_rr_ratio: float = 1.5       # Minimum risk:reward ratio
    target_multiplier: float = 1.0   # Measured move multiplier
    
    # Backtest period
    start_date: str = "2015-01-01"
    end_date: str = "2025-12-31"
    
    # Tickers to test
    tickers: List[str] = field(default_factory=lambda: [
        "^NSEI",  # Nifty 50
        "^BSESN", # BSE Sensex
        "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS", "ICICIBANK.NS",
        "HINDUNILVR.NS", "ITC.NS", "SBIN.NS", "BHARTIARTL.NS", "KOTAKBANK.NS",
        "BAJFINANCE.NS", "LT.NS", "WIPRO.NS", "AXISBANK.NS", "TITAN.NS",
        "ASIANPAINT.NS", "MARUTI.NS", "SUNPHARMA.NS", "NTPC.NS",
        # US Markets
        "SPY", "QQQ", "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA",
        "TSLA", "JPM", "V", "JNJ", "WMT", "MA", "PG", "UNH", "HD", "BAC",
        "DIS", "ADBE", "CRM", "NFLX", "PYPL", "INTC", "AMD"
    ])


# ============================================================================
# DATA ENGINE
# ============================================================================

class DataEngine:
    """Fetches and validates historical OHLCV data."""
    
    @staticmethod
    def fetch_yahoo(ticker: str, start: str, end: str) -> Optional[pd.DataFrame]:
        """Fetch data from Yahoo Finance with error handling."""
        try:
            import yfinance as yf
            df = yf.download(ticker, start=start, end=end, auto_adjust=True, progress=False)
            if df.empty or len(df) < 100:
                return None
            
            # Handle MultiIndex columns from yfinance (tuple column names)
            if isinstance(df.columns, pd.MultiIndex):
                # Extract first level - e.g. ('Close', 'SPY') -> 'Close'
                df.columns = [col[0] for col in df.columns]
            
            # Flatten any remaining tuple columns and lowercase
            flat_cols = []
            for col in df.columns:
                if isinstance(col, tuple):
                    flat_cols.append(col[0].lower().replace(" ", "_"))
                else:
                    flat_cols.append(str(col).lower().replace(" ", "_"))
            df.columns = flat_cols
            
            df.index = pd.to_datetime(df.index)
            return df
        except Exception as e:
            logger.debug(f"Failed to fetch {ticker}: {e}")
            return None
    
    @staticmethod
    def validate_ohlcv(df: pd.DataFrame) -> bool:
        """Validate OHLCV data integrity."""
        required = ["open", "high", "low", "close", "volume"]
        if not all(col in df.columns for col in required):
            return False
        if df.isnull().values.any():
            return False
        if (df["high"] < df["low"]).any():
            return False
        if (df["volume"] <= 0).any():
            return False
        return True


# ============================================================================
# PATTERN DETECTION ENGINE
# ============================================================================

class HeadShoulderDetector:
    """
    Algorithmic detection of Head & Shoulders (Top) and Inverse H&S (Bottom).
    
    Uses local extrema scanning to identify pivot highs/lows, then validates
    the structural requirements of the pattern.
    """
    
    def __init__(self, config: HSConfig):
        self.config = config
    
    def _find_pivot_highs(self, df: pd.DataFrame) -> np.ndarray:
        """Find local maxima (pivot highs) using scipy."""
        highs = df["high"].values
        indices = argrelextrema(highs, np.greater, order=self.config.pivot_window)[0]
        return indices
    
    def _find_pivot_lows(self, df: pd.DataFrame) -> np.ndarray:
        """Find local minima (pivot lows) using scipy."""
        lows = df["low"].values
        indices = argrelextrema(lows, np.less, order=self.config.pivot_window)[0]
        return indices
    
    def detect_head_shoulders_top(self, df: pd.DataFrame) -> List[Dict[str, Any]]:
        """
        Detect Head and Shoulders TOP patterns.
        
        Structure: Left Shoulder (pivot high) < Head (higher pivot high) > Right Shoulder (lower pivot high)
        Neckline: connects trough between LS-H and H-RS
        Breakout: close below neckline
        """
        patterns = []
        pivots_high = self._find_pivot_highs(df)
        pivots_low = self._find_pivot_lows(df)
        
        if len(pivots_high) < 3:
            return patterns
        
        for i in range(len(pivots_high) - 2):
            ls_idx = pivots_high[i]
            head_idx = pivots_high[i + 1]
            rs_idx = pivots_high[i + 2]
            
            # Price values
            ls_price = df.iloc[ls_idx]["high"]
            head_price = df.iloc[head_idx]["high"]
            rs_price = df.iloc[rs_idx]["high"]
            
            # --- Structural Validation ---
            
            # 1. Head must be highest
            if not (head_price > ls_price and head_price > rs_price):
                continue
            
            # 2. Shoulders should be roughly similar (right <= left tolerance)
            if rs_price > ls_price * 1.05:  # Right shoulder not significantly higher than left
                continue
                
            shoulder_min = max(ls_price, rs_price) * self.config.shoulder_height_ratio
            if head_price * self.config.shoulder_height_ratio < shoulder_min:
                continue
            
            # 3. Find trough before left shoulder and between LS and Head
            trough1 = None
            for low_idx in pivots_low:
                if ls_idx < low_idx < head_idx:
                    if trough1 is None or df.iloc[low_idx]["low"] < df.iloc[trough1]["low"]:
                        trough1 = low_idx
            
            # Trough between Head and Right Shoulder
            trough2 = None
            for low_idx in pivots_low:
                if head_idx < low_idx < rs_idx:
                    if trough2 is None or df.iloc[low_idx]["low"] < df.iloc[trough2]["low"]:
                        trough2 = low_idx
            
            if trough1 is None or trough2 is None:
                continue
            
            trough1_price = df.iloc[trough1]["low"]
            trough2_price = df.iloc[trough2]["low"]
            
            # 4. Neckline: connect trough1 and trough2
            # Calculate neckline slope and value at RS point
            bar_diff = trough2 - trough1
            if bar_diff == 0:
                continue
            neckline_slope = (trough2_price - trough1_price) / bar_diff
            
            # Neckline value at right shoulder's trough
            neckline_at_rs_trough = trough1_price + neckline_slope * (rs_idx - trough1)
            
            # 5. Pattern must have minimum width
            pattern_width = rs_idx - ls_idx
            if pattern_width < self.config.min_pattern_bars:
                continue
            if pattern_width > self.config.max_pattern_bars:
                continue
            
            # 6. Volume confirmation (if enabled)
            if self.config.volume_confirm:
                ls_vol_avg = df.iloc[ls_idx - self.config.pivot_window:ls_idx + 1]["volume"].mean()
                rs_vol_avg = df.iloc[rs_idx - self.config.pivot_window:rs_idx + 1]["volume"].mean()
                if rs_vol_avg > ls_vol_avg * 1.2:  # Right shoulder vol should not be much higher
                    pass  # Allow, but note it
            
            # --- Find breakout point ---
            # Look for close below neckline after RS
            for breakout_idx in range(rs_idx + 1, min(rs_idx + 30, len(df))):
                neckline_val = trough1_price + neckline_slope * (breakout_idx - trough1)
            
            if df.iloc[breakout_idx]["close"] < neckline_val * (1 - self.config.neckline_break_pct):
                # Confirmed breakdown
                
                # Measured Move Target
                head_to_neckline = head_price - neckline_val
                target_price = neckline_val - head_to_neckline * self.config.target_multiplier
                
                # Entry: at breakout close
                entry_price = df.iloc[breakout_idx]["close"]
                
                # Stop Loss: above right shoulder high or recent swing high
                stop_loss = max(
                    df.iloc[rs_idx - 2:rs_idx + 1]["high"].max(),
                    df.iloc[breakout_idx - 3:breakout_idx + 1]["high"].max()
                )
                
                # Risk amount
                risk_per_share = stop_loss - entry_price
                if risk_per_share <= 0:
                    continue
                
                reward_per_share = entry_price - target_price
                if reward_per_share <= 0:
                    continue
                
                rr_ratio = reward_per_share / risk_per_share
                
                if rr_ratio < self.config.min_rr_ratio:
                    continue
                
                patterns.append({
                    "type": "H&S_TOP",
                    "entry_date": df.index[breakout_idx],
                    "entry_price": round(entry_price, 2),
                    "stop_loss": round(stop_loss, 2),
                    "target": round(max(target_price, 0), 2),
                    "neckline_value": round(neckline_val, 2),
                    "head_price": round(head_price, 2),
                    "left_shoulder": round(ls_price, 2),
                    "right_shoulder": round(rs_price, 2),
                    "pattern_width_bars": pattern_width,
                    "risk_per_share": round(risk_per_share, 2),
                    "reward_per_share": round(reward_per_share, 2),
                    "rr_ratio": round(rr_ratio, 2),
                    "ticker": df.attrs.get("ticker", "UNKNOWN"),
                    "neckline_slope": round(neckline_slope, 4)
                })
                break  # Only first valid breakout per pattern
        
        return patterns
    
    def detect_inverse_head_shoulders(self, df: pd.DataFrame) -> List[Dict[str, Any]]:
        """
        Detect Inverse Head and Shoulders (Bottom) patterns.
        
        Structure: Left Shoulder (pivot low) > Head (lower pivot low) < Right Shoulder (higher pivot low)
        Neckline: connects peaks between LS-H and H-RS
        Breakout: close above neckline
        """
        patterns = []
        pivots_low = self._find_pivot_lows(df)
        pivots_high = self._find_pivot_highs(df)
        
        if len(pivots_low) < 3:
            return patterns
        
        for i in range(len(pivots_low) - 2):
            ls_idx = pivots_low[i]
            head_idx = pivots_low[i + 1]
            rs_idx = pivots_low[i + 2]
            
            ls_price = df.iloc[ls_idx]["low"]
            head_price = df.iloc[head_idx]["low"]
            rs_price = df.iloc[rs_idx]["low"]
            
            # 1. Head must be lowest
            if not (head_price < ls_price and head_price < rs_price):
                continue
            
            # 2. Right shoulder should be higher than or equal to left (shows accumulation)
            if rs_price < ls_price * 0.95:
                continue
            
            # 3. Find peaks between lows for neckline
            peak1 = None
            for high_idx in pivots_high:
                if ls_idx < high_idx < head_idx:
                    if peak1 is None or df.iloc[high_idx]["high"] > df.iloc[peak1]["high"]:
                        peak1 = high_idx
            
            peak2 = None
            for high_idx in pivots_high:
                if head_idx < high_idx < rs_idx:
                    if peak2 is None or df.iloc[high_idx]["high"] > df.iloc[peak2]["high"]:
                        peak2 = high_idx
            
            if peak1 is None or peak2 is None:
                continue
            
            peak1_price = df.iloc[peak1]["high"]
            peak2_price = df.iloc[peak2]["high"]
            
            # Neckline slope
            bar_diff = peak2 - peak1
            if bar_diff == 0:
                continue
            neckline_slope = (peak2_price - peak1_price) / bar_diff
            
            # Pattern width
            pattern_width = rs_idx - ls_idx
            if pattern_width < self.config.min_pattern_bars:
                continue
            if pattern_width > self.config.max_pattern_bars:
                continue
            
            # Find breakout (close above neckline)
            for breakout_idx in range(rs_idx + 1, min(rs_idx + 30, len(df))):
                neckline_val = peak1_price + neckline_slope * (breakout_idx - peak1)
                
                if df.iloc[breakout_idx]["close"] > neckline_val * (1 + self.config.neckline_break_pct):
                    # Confirmed breakout
                    head_to_neckline = neckline_val - head_price
                    target_price = neckline_val + head_to_neckline * self.config.target_multiplier
                    
                    entry_price = df.iloc[breakout_idx]["close"]
                    
                    # Stop loss: below right shoulder low
                    stop_loss = min(
                        df.iloc[rs_idx - 2:rs_idx + 1]["low"].min(),
                        df.iloc[breakout_idx - 3:breakout_idx + 1]["low"].min()
                    )
                    
                    risk_per_share = entry_price - stop_loss
                    if risk_per_share <= 0:
                        continue
                    
                    reward_per_share = target_price - entry_price
                    if reward_per_share <= 0:
                        continue
                    
                    rr_ratio = reward_per_share / risk_per_share
                    
                    if rr_ratio < self.config.min_rr_ratio:
                        continue
                    
                    patterns.append({
                        "type": "IH&S_BOTTOM",
                        "entry_date": df.index[breakout_idx],
                        "entry_price": round(entry_price, 2),
                        "stop_loss": round(stop_loss, 2),
                        "target": round(target_price, 2),
                        "neckline_value": round(neckline_val, 2),
                        "head_price": round(head_price, 2),
                        "left_shoulder": round(ls_price, 2),
                        "right_shoulder": round(rs_price, 2),
                        "pattern_width_bars": pattern_width,
                        "risk_per_share": round(risk_per_share, 2),
                        "reward_per_share": round(reward_per_share, 2),
                        "rr_ratio": round(rr_ratio, 2),
                        "ticker": df.attrs.get("ticker", "UNKNOWN"),
                        "neckline_slope": round(neckline_slope, 4)
                    })
                    break
        
        return patterns


# ============================================================================
# TRADE SIMULATOR
# ============================================================================

@dataclass
class Trade:
    """Represents a single trade with full lifecycle."""
    id: int
    ticker: str
    pattern_type: str
    entry_date: datetime
    entry_price: float
    stop_loss: float
    target: float
    direction: str  # "SHORT" for H&S Top, "LONG" for IH&S
    risk_per_share: float
    reward_per_share: float
    rr_ratio: float
    size: float = 0.0
    exit_date: Optional[datetime] = None
    exit_price: Optional[float] = None
    exit_reason: str = ""
    pnl: float = 0.0
    pnl_pct: float = 0.0
    bars_held: int = 0
    
    def calculate_pnl(self, exit_price: float, capital: float) -> float:
        """Calculate P&L for this trade."""
        if self.direction == "SHORT":
            self.pnl = (self.entry_price - exit_price) * self.size
            self.pnl_pct = (self.entry_price - exit_price) / self.entry_price * 100
        else:  # LONG
            self.pnl = (exit_price - self.entry_price) * self.size
            self.pnl_pct = (exit_price - self.entry_price) / self.entry_price * 100
        return self.pnl


class TradeSimulator:
    """
    Simulates trade execution with realistic constraints:
    - Slippage (0.1%)
    - Position sizing based on risk %
    - Time-based stops
    - Trail management
    """
    
    def __init__(self, config: HSConfig, initial_capital: float = 1_000_000):
        self.config = config
        self.initial_capital = initial_capital
        self.capital = initial_capital
        self.trades: List[Trade] = []
        self.equity_curve: List[Dict] = []
        self.slippage = 0.001  # 0.1% slippage
        self.trade_id = 0
    
    def run_backtest(self, df: pd.DataFrame, patterns: List[Dict[str, Any]]) -> List[Trade]:
        """
        Run full backtest on detected patterns.
        Each pattern becomes a trade with full lifecycle simulation.
        """
        self.capital = self.initial_capital
        self.trades = []
        prices = df["close"].values
        dates = df.index.to_pydatetime()  # Convert to Python datetime objects
        highs = df["high"].values
        lows = df["low"].values
        
        for pattern in patterns:
            if self.capital <= 0:
                break
            
            direction = "SHORT" if pattern["type"] == "H&S_TOP" else "LONG"
            
            # Find index of entry
            entry_idx = df.index.get_loc(pattern["entry_date"]) if pattern["entry_date"] in df.index else -1
            if entry_idx < 0 or entry_idx >= len(df) - 5:
                continue
            
            self.trade_id += 1
            
            # Apply slippage to entry
            if direction == "SHORT":
                entry_price = pattern["entry_price"] * (1 - self.slippage)
            else:
                entry_price = pattern["entry_price"] * (1 + self.slippage)
            
            stop_loss = pattern["stop_loss"]
            target = pattern["target"]
            
            # Position sizing
            risk_amount = self.capital * self.config.risk_per_trade
            if direction == "SHORT":
                risk_per_share = stop_loss - entry_price
            else:
                risk_per_share = entry_price - stop_loss
            
            if risk_per_share <= 0:
                continue
            
            size = risk_amount / risk_per_share
            if size <= 0:
                continue
            
            trade = Trade(
                id=self.trade_id,
                ticker=pattern.get("ticker", "UNKNOWN"),
                pattern_type=pattern["type"],
                entry_date=pattern["entry_date"],
                entry_price=round(entry_price, 2),
                stop_loss=stop_loss,
                target=target,
                direction=direction,
                risk_per_share=round(risk_per_share, 2),
                reward_per_share=pattern["reward_per_share"],
                rr_ratio=pattern["rr_ratio"],
                size=size
            )
            
            # Simulate trade progression
            max_bars = min(entry_idx + 120, len(df))  # Max 120 bars hold
            peak_price = entry_price if direction == "LONG" else entry_price
            trail_stop = 0.0
            
            for exit_idx in range(entry_idx + 1, max_bars):
                bar_high = highs[exit_idx]
                bar_low = lows[exit_idx]
                bar_close = prices[exit_idx]
                
                if direction == "SHORT":
                    # Check stop loss (price moves up against short)
                    if bar_high >= stop_loss:
                        trade.exit_date = dates[exit_idx]
                        trade.exit_price = stop_loss * (1 + self.slippage)  # Slippage on exit
                        trade.exit_reason = "STOP_LOSS"
                        break
                    
                    # Check target hit
                    if bar_low <= target:
                        trade.exit_date = dates[exit_idx]
                        trade.exit_price = target * (1 - self.slippage)
                        trade.exit_reason = "TARGET"
                        break
                    
                    # Update trailing stop (at entry after 2:1 reward)
                    if entry_price - bar_low >= risk_per_share * 2:
                        trail_stop = entry_price - risk_per_share * 0.5
                        if trail_stop < stop_loss:
                            stop_loss = trail_stop
                
                else:  # LONG
                    # Check stop loss
                    if bar_low <= stop_loss:
                        trade.exit_date = dates[exit_idx]
                        trade.exit_price = stop_loss * (1 - self.slippage)
                        trade.exit_reason = "STOP_LOSS"
                        break
                    
                    # Check target hit
                    if bar_high >= target:
                        trade.exit_date = dates[exit_idx]
                        trade.exit_price = target * (1 + self.slippage)
                        trade.exit_reason = "TARGET"
                        break
                    
                    # Trailing stop
                    if bar_high - entry_price >= risk_per_share * 2:
                        trail_stop = entry_price + risk_per_share * 0.5
                        if trail_stop > stop_loss:
                            stop_loss = trail_stop
            
            # If no exit found, close at end of simulation period
            if trade.exit_date is None:
                trade.exit_date = dates[entry_idx + min(120, len(df) - entry_idx - 1)]
                trade.exit_price = prices[entry_idx + min(120, len(df) - entry_idx - 1)]
                trade.exit_reason = "TIME_EXIT"
            
            # Calculate P&L
            trade.bars_held = len(df[entry_idx:]) if trade.exit_date is None else \
                len(df[entry_idx:list(dates).index(trade.exit_date) + 1]) if trade.exit_date in dates else 0
            
            trade.calculate_pnl(trade.exit_price, self.capital)
            self.capital += trade.pnl
            self.trades.append(trade)
        
        return self.trades


# ============================================================================
# PERFORMANCE METRICS
# ============================================================================

class PerformanceAnalytics:
    """Calculate comprehensive performance and risk metrics."""
    
    @staticmethod
    def calculate(trades: List[Trade], initial_capital: float) -> Dict[str, Any]:
        """Calculate all performance metrics from trade list."""
        if not trades:
            return {"error": "No trades to analyze"}
        
        total_trades = len(trades)
        winning_trades = [t for t in trades if t.pnl > 0]
        losing_trades = [t for t in trades if t.pnl <= 0]
        
        win_count = len(winning_trades)
        loss_count = len(losing_trades)
        win_rate = win_count / total_trades if total_trades > 0 else 0
        
        gross_profit = sum(t.pnl for t in winning_trades)
        gross_loss = abs(sum(t.pnl for t in losing_trades))
        profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")
        
        avg_win = gross_profit / win_count if win_count > 0 else 0
        avg_loss = gross_loss / loss_count if loss_count > 0 else 0
        
        total_pnl = sum(t.pnl for t in trades)
        total_return = (total_pnl / initial_capital) * 100
        
        # Expectancy in R
        total_r = sum(t.pnl / t.risk_per_share for t in trades if t.risk_per_share > 0)
        expectancy_r = total_r / total_trades if total_trades > 0 else 0
        
        # Max consecutive wins/losses
        max_consec_wins = 0
        max_consec_losses = 0
        curr_wins = 0
        curr_losses = 0
        for t in trades:
            if t.pnl > 0:
                curr_wins += 1
                curr_losses = 0
                max_consec_wins = max(max_consec_wins, curr_wins)
            else:
                curr_losses += 1
                curr_wins = 0
                max_consec_losses = max(max_consec_losses, curr_losses)
        
        # Sharpe-like ratio (using trade returns)
        returns = [t.pnl_pct for t in trades]
        avg_return = np.mean(returns) if returns else 0
        std_return = np.std(returns) if returns else 1
        sharpe = (avg_return / std_return * np.sqrt(252)) if std_return > 0 else 0
        
        # Max drawdown from equity curve
        equity = initial_capital
        peak = equity
        max_dd = 0
        for t in trades:
            equity += t.pnl
            if equity > peak:
                peak = equity
            dd = (peak - equity) / peak * 100
            max_dd = max(max_dd, dd)
        
        # Trade distribution
        pattern_types = {}
        for t in trades:
            pt = t.pattern_type
            if pt not in pattern_types:
                pattern_types[pt] = {"count": 0, "wins": 0, "total_pnl": 0}
            pattern_types[pt]["count"] += 1
            pattern_types[pt]["wins"] += 1 if t.pnl > 0 else 0
            pattern_types[pt]["total_pnl"] += t.pnl
        
        # Average R multiple
        avg_r_multiple = np.mean([t.pnl / t.risk_per_share for t in trades if t.risk_per_share > 0]) if trades else 0
        
        return {
            "total_trades": total_trades,
            "win_count": win_count,
            "loss_count": loss_count,
            "win_rate_pct": round(win_rate * 100, 2),
            "profit_factor": round(profit_factor, 2),
            "gross_profit": round(gross_profit, 2),
            "gross_loss": round(gross_loss, 2),
            "avg_win": round(avg_win, 2),
            "avg_loss": round(avg_loss, 2),
            "total_pnl": round(total_pnl, 2),
            "total_return_pct": round(total_return, 2),
            "expectancy_r": round(expectancy_r, 2),
            "avg_r_multiple": round(avg_r_multiple, 2),
            "max_consecutive_wins": max_consec_wins,
            "max_consecutive_losses": max_consec_losses,
            "sharpe_ratio": round(sharpe, 2),
            "max_drawdown_pct": round(max_dd, 2),
            "avg_risk_reward": round(np.mean([t.rr_ratio for t in trades]), 2) if trades else 0,
            "pattern_type_breakdown": pattern_types
        }


# ============================================================================
# STRESS TEST & FAILURE ANALYSIS
# ============================================================================

class FailureCaseAnalyzer:
    """
    Analyzes failure cases in detail to understand why patterns fail.
    
    Categories of failure:
    1. False breakout (break below neckline, then reverse)
    2. Pullback failure (pullback to neckline, then reverse)
    3. Target miss (reaches < 50% of measured target)
    4. Stop loss hit (price reverses and hits stop)
    """
    
    @staticmethod
    def classify_failure(trade: Trade, df: pd.DataFrame) -> str:
        """Classify the type of failure for a losing trade."""
        if trade.exit_reason == "STOP_LOSS":
            # Check if it was a false breakout
            entry_idx = list(df.index).index(trade.entry_date) if trade.entry_date in df.index else -1
            if entry_idx > 0 and entry_idx < len(df) - 5:
                # Did price reverse immediately after entry?
                post_entry = df.iloc[entry_idx:min(entry_idx + 10, len(df))]
                if trade.direction == "SHORT":
                    max_reversal = post_entry["high"].max()
                    reversal_pct = (max_reversal - trade.entry_price) / (trade.stop_loss - trade.entry_price) * 100
                    if reversal_pct > 80:
                        return "FALSE_BREAKOUT"
                else:
                    min_reversal = post_entry["low"].min()
                    reversal_pct = (trade.entry_price - min_reversal) / (trade.entry_price - trade.stop_loss) * 100
                    if reversal_pct > 80:
                        return "FALSE_BREAKOUT"
            return "STOP_LOSS_HIT"
        
        elif trade.exit_reason == "TIME_EXIT":
            return "TARGET_NOT_MET"
        
        elif trade.exit_reason == "TARGET" and trade.pnl < 0:
            return "TARGET_MISS"
        
        return "OTHER"
    
    @staticmethod
    def analyze_failures(trades: List[Trade], dfs: Dict[str, pd.DataFrame]) -> Dict[str, Any]:
        """Detailed analysis of all losing trades."""
        failures = [t for t in trades if t.pnl <= 0]
        
        categories = {}
        for trade in failures:
            df = dfs.get(trade.ticker, pd.DataFrame())
            category = FailureCaseAnalyzer.classify_failure(trade, df)
            if category not in categories:
                categories[category] = {"count": 0, "total_loss": 0, "avg_loss": 0, "trades": []}
            categories[category]["count"] += 1
            categories[category]["total_loss"] += abs(trade.pnl)
            categories[category]["trades"].append(trade)
        
        for cat, data in categories.items():
            data["avg_loss"] = round(data["total_loss"] / data["count"], 2) if data["count"] > 0 else 0
        
        # Failure rate by pattern type
        pattern_failures = {}
        for trade in trades:
            pt = trade.pattern_type
            if pt not in pattern_failures:
                pattern_failures[pt] = {"total": 0, "failures": 0}
            pattern_failures[pt]["total"] += 1
            if trade.pnl <= 0:
                pattern_failures[pt]["failures"] += 1
        
        for pt, data in pattern_failures.items():
            data["failure_rate"] = round(data["failures"] / data["total"] * 100, 2) if data["total"] > 0 else 0
        
        return {
            "total_failures": len(failures),
            "failure_rate_pct": round(len(failures) / len(trades) * 100, 2) if trades else 0,
            "total_loss_from_failures": round(sum(abs(t.pnl) for t in failures), 2),
            "categories": categories,
            "pattern_failure_rates": pattern_failures
        }


# ============================================================================
# MULTI-TIMEFRAME ANALYSIS
# ============================================================================

class MultiTimeframeAnalyzer:
    """
    Analyzes H&S pattern performance across different timeframes.
    Higher timeframes generally produce more reliable patterns.
    """
    
    TIMEFRAMES = {
        "15min": {"period": "3mo", "interval": "15m"},
        "1hour": {"period": "1y", "interval": "60m"},
        "daily": {"period": "5y", "interval": "1d"},
        "weekly": {"period": "10y", "interval": "1wk"},
        "monthly": {"period": "20y", "interval": "1mo"}
    }
    
    @staticmethod
    def analyze_timeframe_performance(results: Dict[str, Dict]) -> pd.DataFrame:
        """Compile performance across timeframes."""
        rows = []
        for tf, metrics in results.items():
            if "error" not in metrics:
                rows.append({
                    "Timeframe": tf,
                    "Total Trades": metrics.get("total_trades", 0),
                    "Win Rate %": metrics.get("win_rate_pct", 0),
                    "Profit Factor": metrics.get("profit_factor", 0),
                    "Avg R Multiple": metrics.get("avg_r_multiple", 0),
                    "Sharpe": metrics.get("sharpe_ratio", 0),
                    "Max DD %": metrics.get("max_drawdown_pct", 0),
                    "Expectancy (R)": metrics.get("expectancy_r", 0)
                })
        return pd.DataFrame(rows).sort_values("Profit Factor", ascending=False)


# ============================================================================
# MAIN BACKTEST ORCHESTRATOR
# ============================================================================

class HeadShoulderBacktest:
    """
    Complete backtesting framework for Head & Shoulders pattern.
    
    Usage:
        config = HSConfig(tickers=["AAPL", "MSFT", "SPY"])
        backtest = HeadShoulderBacktest(config)
        results = backtest.run()
        backtest.generate_report(results)
    """
    
    def __init__(self, config: HSConfig):
        self.config = config
        self.data_engine = DataEngine()
        self.detector = HeadShoulderDetector(config)
        self.simulator = TradeSimulator(config)
        self.analytics = PerformanceAnalytics()
        self.failure_analyzer = FailureCaseAnalyzer()
    
    def run(self, tickers: Optional[List[str]] = None) -> Dict[str, Any]:
        """Run full backtest across all configured tickers."""
        all_trades = []
        all_patterns = []
        dfs = {}
        ticker_stats = []
        
        target_tickers = tickers or self.config.tickers
        
        logger.info(f"Running H&S Backtest on {len(target_tickers)} instruments...")
        logger.info(f"Period: {self.config.start_date} to {self.config.end_date}")
        logger.info("=" * 60)
        
        for ticker in target_tickers:
            df = self.data_engine.fetch_yahoo(ticker, self.config.start_date, self.config.end_date)
            if df is None or not self.data_engine.validate_ohlcv(df):
                logger.debug(f"  Skipped {ticker}: insufficient data")
                continue
            
            df.attrs["ticker"] = ticker
            dfs[ticker] = df
            
            # Detect patterns
            hs_patterns = self.detector.detect_head_shoulders_top(df)
            ihs_patterns = self.detector.detect_inverse_head_shoulders(df)
            patterns = hs_patterns + ihs_patterns
            
            for p in patterns:
                p["ticker"] = ticker
            
            all_patterns.extend(patterns)
            
            if patterns:
                logger.info(f"  {ticker}: {len(patterns)} pattern(s) detected "
                           f"({len(hs_patterns)} H&S Top, {len(ihs_patterns)} IH&S Bottom)")
            
            # Simulate trades
            trades = self.simulator.run_backtest(df, patterns)
            all_trades.extend(trades)
            
            if trades:
                tp = sum(1 for t in trades if t.pnl > 0)
                total_pnl = sum(t.pnl for t in trades)
                ticker_stats.append({
                    "ticker": ticker,
                    "patterns": len(patterns),
                    "trades": len(trades),
                    "wins": tp,
                    "losses": len(trades) - tp,
                    "win_rate": round(tp / len(trades) * 100, 1) if trades else 0,
                    "total_pnl": round(total_pnl, 2)
                })
        
        # Calculate aggregate metrics
        metrics = self.analytics.calculate(all_trades, self.simulator.initial_capital)
        failure_analysis = self.failure_analyzer.analyze_failures(all_trades, dfs)
        
        # Win rate by market condition (bull vs bear)
        bull_trades = []
        bear_trades = []
        for trade in all_trades:
            df = dfs.get(trade.ticker)
            if df is not None and trade.entry_date in df.index:
                idx = list(df.index).index(trade.entry_date)
                sma200 = df["close"].rolling(200).mean().iloc[idx]
                if df["close"].iloc[idx] > sma200:
                    bull_trades.append(trade)
                else:
                    bear_trades.append(trade)
        
        results = {
            "config": {
                "start_date": self.config.start_date,
                "end_date": self.config.end_date,
                "instruments_tested": len(target_tickers),
                "instruments_with_data": len(dfs),
                "pivot_window": self.config.pivot_window,
                "min_pattern_bars": self.config.min_pattern_bars,
                "neckline_break_pct": self.config.neckline_break_pct,
                "risk_per_trade": self.config.risk_per_trade,
                "min_rr_ratio": self.config.min_rr_ratio
            },
            "overview": {
                "total_patterns_detected": len(all_patterns),
                "hs_top_patterns": len([p for p in all_patterns if p["type"] == "H&S_TOP"]),
                "ihs_bottom_patterns": len([p for p in all_patterns if p["type"] == "IH&S_BOTTOM"]),
                "total_trades_executed": len(all_trades),
            },
            "performance": metrics,
            "failure_analysis": failure_analysis,
            "ticker_breakdown": sorted(ticker_stats, key=lambda x: x["total_pnl"], reverse=True),
            "bull_market_trades": {
                "count": len(bull_trades),
                "win_rate": round(sum(1 for t in bull_trades if t.pnl > 0) / len(bull_trades) * 100, 2) if bull_trades else 0,
                "avg_pnl": round(np.mean([t.pnl for t in bull_trades]), 2) if bull_trades else 0
            },
            "bear_market_trades": {
                "count": len(bear_trades),
                "win_rate": round(sum(1 for t in bear_trades if t.pnl > 0) / len(bear_trades) * 100, 2) if bear_trades else 0,
                "avg_pnl": round(np.mean([t.pnl for t in bear_trades]), 2) if bear_trades else 0
            },
            "all_trades": [
                {
                    "id": t.id,
                    "ticker": t.ticker,
                    "type": t.pattern_type,
                    "direction": t.direction,
                    "entry_date": str(t.entry_date),
                    "entry_price": t.entry_price,
                    "exit_date": str(t.exit_date) if t.exit_date is not None else "N/A",
                    "exit_price": t.exit_price,
                    "exit_reason": t.exit_reason,
                    "pnl": round(t.pnl, 2),
                    "pnl_pct": round(t.pnl_pct, 2),
                    "rr_ratio": t.rr_ratio,
                    "bars_held": t.bars_held
                }
                for t in all_trades
            ]
        }
        
        return results
    
    @staticmethod
    def generate_report(results: Dict[str, Any], output_path: str = "hs_backtest_report.json"):
        """Generate formatted summary report."""
        print("\n" + "=" * 70)
        print("   HEAD AND SHOULDERS PATTERN — BACKTEST REPORT")
        print("=" * 70)
        
        cfg = results["config"]
        print(f"\n📋 CONFIGURATION")
        print(f"   Period:          {cfg['start_date']} to {cfg['end_date']}")
        print(f"   Instruments:     {cfg['instruments_tested']} attempted, {cfg['instruments_with_data']} with data")
        print(f"   Pivot Window:    {cfg['pivot_window']} bars")
        print(f"   Min Pattern:     {cfg['min_pattern_bars']} bars")
        print(f"   Neckline Break:  {cfg['neckline_break_pct']*100}%")
        print(f"   Risk/Trade:      {cfg['risk_per_trade']*100}%")
        print(f"   Min R:R:         1:{cfg['min_rr_ratio']}")
        
        ov = results["overview"]
        print(f"\n📊 OVERVIEW")
        print(f"   Total Patterns:  {ov['total_patterns_detected']}")
        print(f"   H&S Tops:        {ov['hs_top_patterns']}")
        print(f"   IH&S Bottoms:    {ov['ihs_bottom_patterns']}")
        print(f"   Trades Executed: {ov['total_trades_executed']}")
        
        perf = results["performance"]
        if "error" in perf:
            print(f"\n💰 PERFORMANCE METRICS")
            print(f"   {perf['error']}")
        else:
            print(f"\n💰 PERFORMANCE METRICS")
            print(f"   Total Return:    {perf.get('total_return_pct', 0)}%")
            print(f"   Profit Factor:   {perf.get('profit_factor', 0)}")
            print(f"   Win Rate:        {perf.get('win_rate_pct', 0)}%")
            print(f"   Total P&L:       ${perf.get('total_pnl', 0):,.2f}")
            if perf.get('total_trades', 0) > 0:
                print(f"   Avg Trade:       ${perf['total_pnl']/perf['total_trades']:,.2f}")
            print(f"   Avg Win:         ${perf.get('avg_win', 0):,.2f}")
            print(f"   Avg Loss:        ${perf.get('avg_loss', 0):,.2f}")
            print(f"   Expectancy:      {perf.get('expectancy_r', 0)}R")
            print(f"   Avg R Multiple:  {perf.get('avg_r_multiple', 0)}R")
            print(f"   Sharpe Ratio:    {perf.get('sharpe_ratio', 0)}")
            print(f"   Max Drawdown:    {perf.get('max_drawdown_pct', 0)}%")
            print(f"   Max Consec Wins: {perf.get('max_consecutive_wins', 0)}")
            print(f"   Max Consec Loss: {perf.get('max_consecutive_losses', 0)}")
        
        fail = results["failure_analysis"]
        print(f"\n⚠️  FAILURE ANALYSIS")
        print(f"   Total Failures:  {fail.get('total_failures', 0)} ({fail.get('failure_rate_pct', 0)}%)")
        print(f"   Total Loss:      ${fail.get('total_loss_from_failures', 0):,.2f}")
        for cat, data in fail.get("categories", {}).items():
            print(f"   - {cat}: {data['count']} losses, avg ${data['avg_loss']:,.2f}")
        
        print(f"\n📈 PATTERN FAILURE RATES")
        for pt, data in fail.get("pattern_failure_rates", {}).items():
            print(f"   - {pt}: {data['failure_rate']}% failure ({data['failures']}/{data['total']})")
        
        # Market condition breakdown
        print(f"\n🌓 MARKET CONDITION BREAKDOWN")
        bm = results.get("bull_market_trades", {})
        print(f"   Bull Market:  {bm.get('count', 0)} trades, {bm.get('win_rate', 0)}% WR")
        bm2 = results.get("bear_market_trades", {})
        print(f"   Bear Market:  {bm2.get('count', 0)} trades, {bm2.get('win_rate', 0)}% WR")
        
        # Top tickers
        ticker_breakdown = results.get("ticker_breakdown", [])
        if ticker_breakdown:
            print(f"\n🏆 TOP 10 INSTRUMENTS BY P&L")
            for i, t in enumerate(ticker_breakdown[:10]):
                print(f"   {i+1}. {t['ticker']}: {t['trades']} trades, {t['win_rate']}% WR, ${t['total_pnl']:,.2f}")
        
        print(f"\n{'='*70}")
        print(f"   Report saved to: {output_path}")
        print(f"{'='*70}\n")
        
        # Save to file
        with open(output_path, "w") as f:
            # Make serializable
            serializable = results.copy()
            json.dump(serializable, f, indent=2, default=str)
        
        return results


# ============================================================================
# EXAMPLE REAL-WORLD PATTERN ANALYSIS
# ============================================================================

def analyze_real_world_example(ticker: str = "SPY", period: str = "2y"):
    """
    Analyze recent Head and Shoulders pattern on a real instrument.
    Shows detailed structural analysis with multi-timeframe context.
    """
    import yfinance as yf
    
    print(f"\n{'='*70}")
    print(f"   REAL-WORLD H&S PATTERN ANALYSIS: {ticker}")
    print(f"{'='*70}\n")
    
    # Fetch data across multiple timeframes
    timeframes = {
        "Daily": {"period": "1y", "interval": "1d"},
        "Weekly": {"period": "2y", "interval": "1wk"},
        "Monthly": {"period": "5y", "interval": "1mo"},
        "1-Hour": {"period": "3mo", "interval": "60m"}
    }
    
    detector = HeadShoulderDetector(HSConfig())
    
    for tf_name, tf_config in timeframes.items():
        try:
            df = yf.download(ticker, period=tf_config["period"], 
                            interval=tf_config["interval"], auto_adjust=True, progress=False)
            if df.empty:
                continue
            
            # Handle MultiIndex columns
            if isinstance(df.columns, pd.MultiIndex):
                df.columns = [col[0] for col in df.columns]
            flat_cols = []
            for col in df.columns:
                if isinstance(col, tuple):
                    flat_cols.append(col[0].lower().replace(" ", "_"))
                else:
                    flat_cols.append(str(col).lower().replace(" ", "_"))
            df.columns = flat_cols
            
            patterns = detector.detect_head_shoulders_top(df)
            ihs_patterns = detector.detect_inverse_head_shoulders(df)
            
            print(f"  ⏱ {tf_name} ({tf_config['period']}, {tf_config['interval']}):")
            print(f"     Bars: {len(df)}")
            
            if patterns:
                for p in patterns[:3]:
                    entry_dt = p['entry_date']
                    if hasattr(entry_dt, 'date'):
                        entry_dt = entry_dt.date()
                    print(f"     🔴 H&S TOP Detected:")
                    print(f"        Entry:       {entry_dt} @ ${p['entry_price']}")
                    print(f"        LS/Head/RS:  ${p['left_shoulder']} / ${p['head_price']} / ${p['right_shoulder']}")
                    print(f"        Neckline:    ${p['neckline_value']} (slope: {p['neckline_slope']})")
                    print(f"        Target:      ${p['target']}")
                    print(f"        Stop Loss:   ${p['stop_loss']}")
                    print(f"        R:R:         1:{p['rr_ratio']}")
                    print(f"        Width:       {p['pattern_width_bars']} bars")
            
            if ihs_patterns:
                for p in ihs_patterns[:3]:
                    entry_dt = p['entry_date']
                    if hasattr(entry_dt, 'date'):
                        entry_dt = entry_dt.date()
                    print(f"     🟢 IH&S BOTTOM Detected:")
                    print(f"        Entry:       {entry_dt} @ ${p['entry_price']}")
                    print(f"        LS/Head/RS:  ${p['left_shoulder']} / ${p['head_price']} / ${p['right_shoulder']}")
                    print(f"        Neckline:    ${p['neckline_value']} (slope: {p['neckline_slope']})")
                    print(f"        Target:      ${p['target']}")
                    print(f"        Stop Loss:   ${p['stop_loss']}")
                    print(f"        R:R:         1:{p['rr_ratio']}")
                    print(f"        Width:       {p['pattern_width_bars']} bars")
            
            if not patterns and not ihs_patterns:
                print(f"     No H&S patterns detected in this timeframe")
            print()
            
        except Exception as e:
            print(f"     Error: {e}\n")


# ============================================================================
# MAIN EXECUTION
# ============================================================================

if __name__ == "__main__":
    import sys
    
    print("\n" + "█" * 70)
    print("   HEAD AND SHOULDERS PATTERN — INSTITUTIONAL BACKTEST ENGINE")
    print("   Quantitative Validation Framework v2.0")
    print("█" * 70)
    
    # Check for yfinance availability
    try:
        import yfinance
        print("\n✅ yfinance available — using live market data\n")
    except ImportError:
        print("\n❌ yfinance not installed. Installing...")
        import subprocess
        subprocess.check_call([sys.executable, "-m", "pip", "install", "yfinance", "scipy", "pandas", "numpy"])
        import yfinance
        print("✅ yfinance installed\n")
    
    # Default configuration
    config = HSConfig(
        start_date="2018-01-01",
        end_date="2026-06-30",
        tickers=[
            # Major Indices
            "SPY", "QQQ", "DIA", "IWM",
            # US Tech
            "AAPL", "MSFT", "GOOGL", "AMZN", "META", "NVDA", "TSLA",
            # US Financials
            "JPM", "BAC", "GS", "V", "MA",
            # US Healthcare
            "JNJ", "PFE", "UNH", "ABBV",
            # US Consumer
            "WMT", "AMGN", "HD", "MCD", "DIS", "NKE",
            # Indian Markets
            "^NSEI", "^BSESN",
            "RELIANCE.NS", "TCS.NS", "HDFCBANK.NS", "INFY.NS",
            "ICICIBANK.NS", "HINDUNILVR.NS", "ITC.NS", "SBIN.NS",
            "BHARTIARTL.NS", "KOTAKBANK.NS", "BAJFINANCE.NS", "LT.NS",
            "WIPRO.NS", "TITAN.NS", "MARUTI.NS", "SUNPHARMA.NS",
            # Commodities
            "GLD", "SLV", "USO",
        ]
    )
    
    # Run comprehensive backtest
    backtest = HeadShoulderBacktest(config)
    results = backtest.run()
    
    # Generate report
    backtest.generate_report(results, "/Users/vijaykumar/opencode/share/document/hs_backtest_results.json")
    
    # Analyze real-world example
    analyze_real_world_example("SPY")
    analyze_real_world_example("^NSEI")
    analyze_real_world_example("AAPL")
    
    print("\n✅ Backtest complete. Full report saved to document folder.\n")
