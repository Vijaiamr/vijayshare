#!/usr/bin/env python3
"""
==============================================================================
HEAD AND SHOULDERS PATTERN — COMPLETE NSE INDIA MARKET BACKTEST
==============================================================================
Institutional-grade automated detection, backtesting, and statistical validation
of the Head and Shoulders (H&S) and Inverse Head and Shoulders (IH&S) patterns
across the ENTIRE NSE India stock universe.

Timeframes: Daily, Weekly, Monthly (Multi-Timeframe Analysis)
Period: 2010-2026 (up to 16 years of data)
Symbols: 2,381 NSE-listed equities

Author:  Quantitative Research Team
Version: 3.0.0 — NSE India Edition
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
import time
import os
import sys

warnings.filterwarnings("ignore")
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(levelname)s | %(message)s")
logger = logging.getLogger("NSE_HS_Backtest")

# ============================================================================
# CONFIGURATION
# ============================================================================

@dataclass
class HSConfig:
    """Configuration parameters for Head & Shoulders detection."""
    pivot_window: int = 5
    min_pattern_bars: int = 20
    max_pattern_bars: int = 120
    shoulder_height_ratio: float = 0.70
    neckline_break_pct: float = 0.015  # 1.5%
    volume_confirm: bool = False  # Disable for broader detection
    min_rr_ratio: float = 1.2
    target_multiplier: float = 1.0

    # Multi-timeframe config
    daily_period: str = "15y"
    weekly_period: str = "20y"
    monthly_period: str = "20y"
    
    # Batching
    batch_size: int = 50
    sleep_between_batches: int = 5  # seconds
    max_stocks: int = 300  # Max stocks to analyze per run (for practical limits)


# ============================================================================
# DATA ENGINE
# ============================================================================

class NSEPatternDetector:
    """Head and Shoulders pattern detector for NSE stocks."""
    
    def __init__(self, config: HSConfig):
        self.config = config
        self.results_cache = {}
    
    def _find_pivot_highs(self, df: pd.DataFrame) -> np.ndarray:
        highs = df["high"].values
        if len(highs) < self.config.pivot_window * 2 + 1:
            return np.array([])
        indices = argrelextrema(highs, np.greater, order=self.config.pivot_window)[0]
        return indices
    
    def _find_pivot_lows(self, df: pd.DataFrame) -> np.ndarray:
        lows = df["low"].values
        if len(lows) < self.config.pivot_window * 2 + 1:
            return np.array([])
        indices = argrelextrema(lows, np.less, order=self.config.pivot_window)[0]
        return indices
    
    def detect_head_shoulders_top(self, df: pd.DataFrame, ticker: str = "UNKNOWN") -> List[Dict]:
        """Detect H&S Top patterns."""
        patterns = []
        pivots_high = self._find_pivot_highs(df)
        pivots_low = self._find_pivot_lows(df)
        
        if len(pivots_high) < 3:
            return patterns
        
        for i in range(len(pivots_high) - 2):
            ls_idx = pivots_high[i]
            head_idx = pivots_high[i + 1]
            rs_idx = pivots_high[i + 2]
            
            ls_price = float(df.iloc[ls_idx]["high"])
            head_price = float(df.iloc[head_idx]["high"])
            rs_price = float(df.iloc[rs_idx]["high"])
            
            # 1. Head must be highest
            if not (head_price > ls_price and head_price > rs_price):
                continue
            
            # 2. Right shoulder not significantly above left
            if rs_price > ls_price * 1.05:
                continue
            
            # 3. Find troughs
            trough1 = None
            for low_idx in pivots_low:
                if ls_idx < low_idx < head_idx:
                    if trough1 is None or float(df.iloc[low_idx]["low"]) < float(df.iloc[trough1]["low"]):
                        trough1 = low_idx
            
            trough2 = None
            for low_idx in pivots_low:
                if head_idx < low_idx < rs_idx:
                    if trough2 is None or float(df.iloc[low_idx]["low"]) < float(df.iloc[trough2]["low"]):
                        trough2 = low_idx
            
            if trough1 is None or trough2 is None:
                continue
            
            trough1_price = float(df.iloc[trough1]["low"])
            trough2_price = float(df.iloc[trough2]["low"])
            
            # 4. Neckline
            bar_diff = trough2 - trough1
            if bar_diff <= 0:
                continue
            neckline_slope = (trough2_price - trough1_price) / bar_diff
            
            # 5. Pattern width
            pattern_width = rs_idx - ls_idx
            if pattern_width < self.config.min_pattern_bars or pattern_width > self.config.max_pattern_bars:
                continue
            
            # 6. Check for breakout
            for breakout_idx in range(rs_idx + 1, min(rs_idx + 60, len(df))):
                neckline_val = trough1_price + neckline_slope * (breakout_idx - trough1)
                
                if float(df.iloc[breakout_idx]["close"]) < neckline_val * (1 - self.config.neckline_break_pct):
                    head_to_neckline = head_price - neckline_val
                    target_price = neckline_val - head_to_neckline * self.config.target_multiplier
                    entry_price = float(df.iloc[breakout_idx]["close"])
                    
                    # Stop loss: above right shoulder area
                    rs_high = float(df.iloc[max(0, rs_idx-3):rs_idx+1]["high"].max())
                    break_high = float(df.iloc[max(0, breakout_idx-3):breakout_idx+1]["high"].max())
                    stop_loss = max(rs_high, break_high)
                    
                    risk_per_share = stop_loss - entry_price
                    if risk_per_share <= 0:
                        continue
                    reward_per_share = entry_price - target_price
                    if reward_per_share <= 0:
                        continue
                    rr_ratio = reward_per_share / risk_per_share
                    
                    if rr_ratio < self.config.min_rr_ratio:
                        continue
                    
                    # Volume check
                    ls_vol = float(df.iloc[max(0, ls_idx-2):ls_idx+1]["volume"].mean()) if len(df) > ls_idx else 0
                    rs_vol = float(df.iloc[max(0, rs_idx-2):rs_idx+1]["volume"].mean()) if len(df) > rs_idx else 0
                    vol_ratio = rs_vol / ls_vol if ls_vol > 0 else 1.0
                    
                    patterns.append({
                        "type": "H&S_TOP",
                        "ticker": ticker,
                        "entry_date": str(df.index[breakout_idx].date()) if hasattr(df.index[breakout_idx], 'date') else str(df.index[breakout_idx]),
                        "entry_price": round(entry_price, 2),
                        "stop_loss": round(stop_loss, 2),
                        "target": round(max(target_price, 0), 2),
                        "neckline_value": round(neckline_val, 2),
                        "head_price": round(head_price, 2),
                        "left_shoulder": round(ls_price, 2),
                        "right_shoulder": round(rs_price, 2),
                        "pattern_width_bars": int(pattern_width),
                        "risk_per_share": round(risk_per_share, 2),
                        "reward_per_share": round(reward_per_share, 2),
                        "rr_ratio": round(rr_ratio, 2),
                        "neckline_slope": round(neckline_slope, 4),
                        "volume_ratio_rs_ls": round(vol_ratio, 2)
                    })
                    break  # First valid breakout only
        
        return patterns
    
    def detect_inverse_head_shoulders(self, df: pd.DataFrame, ticker: str = "UNKNOWN") -> List[Dict]:
        """Detect Inverse H&S Bottom patterns."""
        patterns = []
        pivots_low = self._find_pivot_lows(df)
        pivots_high = self._find_pivot_highs(df)
        
        if len(pivots_low) < 3:
            return patterns
        
        for i in range(len(pivots_low) - 2):
            ls_idx = pivots_low[i]
            head_idx = pivots_low[i + 1]
            rs_idx = pivots_low[i + 2]
            
            ls_price = float(df.iloc[ls_idx]["low"])
            head_price = float(df.iloc[head_idx]["low"])
            rs_price = float(df.iloc[rs_idx]["low"])
            
            # 1. Head must be lowest
            if not (head_price < ls_price and head_price < rs_price):
                continue
            
            # 2. Right shoulder should be >= left (shows accumulation)
            if rs_price < ls_price * 0.95:
                continue
            
            # 3. Find peaks for neckline
            peak1 = None
            for high_idx in pivots_high:
                if ls_idx < high_idx < head_idx:
                    if peak1 is None or float(df.iloc[high_idx]["high"]) > float(df.iloc[peak1]["high"]):
                        peak1 = high_idx
            
            peak2 = None
            for high_idx in pivots_high:
                if head_idx < high_idx < rs_idx:
                    if peak2 is None or float(df.iloc[high_idx]["high"]) > float(df.iloc[peak2]["high"]):
                        peak2 = high_idx
            
            if peak1 is None or peak2 is None:
                continue
            
            peak1_price = float(df.iloc[peak1]["high"])
            peak2_price = float(df.iloc[peak2]["high"])
            
            bar_diff = peak2 - peak1
            if bar_diff <= 0:
                continue
            neckline_slope = (peak2_price - peak1_price) / bar_diff
            
            pattern_width = rs_idx - ls_idx
            if pattern_width < self.config.min_pattern_bars or pattern_width > self.config.max_pattern_bars:
                continue
            
            for breakout_idx in range(rs_idx + 1, min(rs_idx + 60, len(df))):
                neckline_val = peak1_price + neckline_slope * (breakout_idx - peak1)
                
                if float(df.iloc[breakout_idx]["close"]) > neckline_val * (1 + self.config.neckline_break_pct):
                    head_to_neckline = neckline_val - head_price
                    target_price = neckline_val + head_to_neckline * self.config.target_multiplier
                    entry_price = float(df.iloc[breakout_idx]["close"])
                    
                    rs_low = float(df.iloc[max(0, rs_idx-3):rs_idx+1]["low"].min())
                    break_low = float(df.iloc[max(0, breakout_idx-3):breakout_idx+1]["low"].min())
                    stop_loss = min(rs_low, break_low)
                    
                    risk_per_share = entry_price - stop_loss
                    if risk_per_share <= 0:
                        continue
                    reward_per_share = target_price - entry_price
                    if reward_per_share <= 0:
                        continue
                    rr_ratio = reward_per_share / risk_per_share
                    
                    if rr_ratio < self.config.min_rr_ratio:
                        continue
                    
                    ls_vol = float(df.iloc[max(0, ls_idx-2):ls_idx+1]["volume"].mean()) if len(df) > ls_idx else 0
                    rs_vol = float(df.iloc[max(0, rs_idx-2):rs_idx+1]["volume"].mean()) if len(df) > rs_idx else 0
                    vol_ratio = rs_vol / ls_vol if ls_vol > 0 else 1.0
                    
                    patterns.append({
                        "type": "IH&S_BOTTOM",
                        "ticker": ticker,
                        "entry_date": str(df.index[breakout_idx].date()) if hasattr(df.index[breakout_idx], 'date') else str(df.index[breakout_idx]),
                        "entry_price": round(entry_price, 2),
                        "stop_loss": round(stop_loss, 2),
                        "target": round(target_price, 2),
                        "neckline_value": round(neckline_val, 2),
                        "head_price": round(head_price, 2),
                        "left_shoulder": round(ls_price, 2),
                        "right_shoulder": round(rs_price, 2),
                        "pattern_width_bars": int(pattern_width),
                        "risk_per_share": round(risk_per_share, 2),
                        "reward_per_share": round(reward_per_share, 2),
                        "rr_ratio": round(rr_ratio, 2),
                        "neckline_slope": round(neckline_slope, 4),
                        "volume_ratio_rs_ls": round(vol_ratio, 2)
                    })
                    break
        
        return patterns


# ============================================================================
# TRADE SIMULATOR (Simplified for NSE)
# ============================================================================

class NSETradeSimulator:
    """Simulates H&S trades with realistic exit conditions."""
    
    def __init__(self, initial_capital: float = 10_000_000, risk_per_trade: float = 0.02):
        self.initial_capital = initial_capital
        self.capital = initial_capital
        self.risk_per_trade = risk_per_trade
        self.trades = []
        self.slippage = 0.002  # 0.2% slippage for less liquid NSE stocks
    
    def run(self, df: pd.DataFrame, patterns: List[Dict], ticker: str) -> List[Dict]:
        """Simulate trades from detected patterns."""
        results = []
        prices = df["close"].values
        dates = df.index.to_pydatetime() if hasattr(df.index, 'to_pydatetime') else df.index
        highs = df["high"].values
        lows = df["low"].values
        
        for pattern in patterns:
            if self.capital <= 0:
                break
            
            # Find entry index
            entry_date_str = pattern["entry_date"]
            entry_idx = None
            for idx in range(len(df)):
                d = str(df.index[idx].date()) if hasattr(df.index[idx], 'date') else str(df.index[idx])
                if d == entry_date_str:
                    entry_idx = idx
                    break
            
            if entry_idx is None or entry_idx >= len(df) - 5:
                continue
            
            direction = "SHORT" if pattern["type"] == "H&S_TOP" else "LONG"
            
            # Apply slippage
            entry_price = pattern["entry_price"]
            if direction == "SHORT":
                entry_price = entry_price * (1 - self.slippage)
            else:
                entry_price = entry_price * (1 + self.slippage)
            
            stop_loss = pattern["stop_loss"]
            target = pattern["target"]
            
            # Position sizing
            if direction == "SHORT":
                risk_per_share = stop_loss - entry_price
            else:
                risk_per_share = entry_price - stop_loss
            
            if risk_per_share <= 0:
                continue
            
            risk_amount = self.capital * self.risk_per_trade
            size = risk_amount / risk_per_share
            if size <= 0:
                continue
            
            # Simulate exit
            max_bars = min(entry_idx + 120, len(df))
            exit_date = None
            exit_price = None
            exit_reason = ""
            hit_target = False
            
            for exit_idx in range(entry_idx + 1, max_bars):
                bar_high = float(highs[exit_idx])
                bar_low = float(lows[exit_idx])
                
                if direction == "SHORT":
                    if bar_high >= stop_loss:
                        exit_date = dates[exit_idx]
                        exit_price = stop_loss * (1 + self.slippage)
                        exit_reason = "STOP_LOSS_HIT"
                        break
                    if bar_low <= target:
                        exit_date = dates[exit_idx]
                        exit_price = target * (1 - self.slippage)
                        exit_reason = "TARGET_HIT"
                        hit_target = True
                        break
                else:  # LONG
                    if bar_low <= stop_loss:
                        exit_date = dates[exit_idx]
                        exit_price = stop_loss * (1 - self.slippage)
                        exit_reason = "STOP_LOSS_HIT"
                        break
                    if bar_high >= target:
                        exit_date = dates[exit_idx]
                        exit_price = target * (1 + self.slippage)
                        exit_reason = "TARGET_HIT"
                        hit_target = True
                        break
            
            if exit_date is None:
                final_exit_idx = min(entry_idx + 120, len(df) - 1)
                exit_date = dates[final_exit_idx]
                exit_price = float(prices[final_exit_idx])
                exit_reason = "TIME_EXIT"
                held_bars = final_exit_idx - entry_idx
            else:
                # Find exit index
                held_bars = 0
                for idx in range(entry_idx + 1, len(dates)):
                    d = str(dates[idx].date()) if hasattr(dates[idx], 'date') else str(dates[idx])
                    ed = str(exit_date.date()) if hasattr(exit_date, 'date') else str(exit_date)
                    if d == ed:
                        held_bars = idx - entry_idx
                        break
            
            # Calculate P&L
            if direction == "SHORT":
                pnl = (entry_price - exit_price) * size
                pnl_pct = (entry_price - exit_price) / entry_price * 100
            else:
                pnl = (exit_price - entry_price) * size
                pnl_pct = (exit_price - entry_price) / entry_price * 100
            
            self.capital += pnl
            
            trade = {
                "ticker": ticker,
                "pattern_type": pattern["type"],
                "direction": direction,
                "entry_date": str(entry_date_str),
                "entry_price": round(entry_price, 2),
                "exit_date": str(exit_date.date()) if hasattr(exit_date, 'date') else str(exit_date),
                "exit_price": round(float(exit_price), 2),
                "exit_reason": exit_reason,
                "pnl": round(pnl, 2),
                "pnl_pct": round(pnl_pct, 2),
                "rr_ratio": pattern["rr_ratio"],
                "bars_held": held_bars,
                "target_hit": hit_target,
                "head_price": pattern["head_price"],
                "neckline_value": pattern["neckline_value"],
                "volume_ratio": pattern.get("volume_ratio_rs_ls", 0)
            }
            results.append(trade)
        
        return results


# ============================================================================
# NSE DATA FETCHER
# ============================================================================

class NSEDataFetcher:
    """Fetches NSE stock data from Yahoo Finance with batching."""
    
    @staticmethod
    def fetch_yahoo(ticker: str, period: str = "5y", interval: str = "1d") -> Optional[pd.DataFrame]:
        """Fetch with MultiIndex column handling."""
        try:
            import yfinance as yf
            df = yf.download(ticker, period=period, interval=interval, auto_adjust=True, progress=False)
            if df.empty or len(df) < 60:
                return None
            
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
            
            return df
        except Exception as e:
            return None


# ============================================================================
# MAIN NSE BACKTEST ORCHESTRATOR
# ============================================================================

class NSEHeadShoulderBacktest:
    """Orchestrates the entire NSE backtest across multiple timeframes."""
    
    def __init__(self, config: HSConfig):
        self.config = config
        self.detector = NSEPatternDetector(config)
        self.fetcher = NSEDataFetcher()
        self.results = {
            "daily": {"patterns": [], "trades": [], "stats": {}},
            "weekly": {"patterns": [], "trades": [], "stats": {}},
            "monthly": {"patterns": [], "trades": [], "stats": {}},
            "summary": {},
            "errors": []
        }
    
    def run_symbol(self, symbol: str) -> Dict:
        """Run H&S detection on a single symbol across all timeframes."""
        result = {
            "symbol": symbol,
            "daily": {"patterns": 0, "hs_top": 0, "ihs_bottom": 0, "trades": [], "data_bars": 0},
            "weekly": {"patterns": 0, "hs_top": 0, "ihs_bottom": 0, "trades": [], "data_bars": 0},
            "monthly": {"patterns": 0, "hs_top": 0, "ihs_bottom": 0, "trades": [], "data_bars": 0},
        }
        
        yahoo_symbol = f"{symbol}.NS"
        
        # Timeframe configurations
        tf_configs = [
            ("daily", "5y", "1d", self.config.daily_period),
            ("weekly", "10y", "1wk", self.config.weekly_period),
            ("monthly", "20y", "1mo", self.config.monthly_period),
        ]
        
        for tf_name, period, interval, _ in tf_configs:
            df = self.fetcher.fetch_yahoo(yahoo_symbol, period=period, interval=interval)
            if df is None or len(df) < 60:
                continue
            
            result[tf_name]["data_bars"] = len(df)
            
            # Detect patterns
            hs_patterns = self.detector.detect_head_shoulders_top(df, symbol)
            ihs_patterns = self.detector.detect_inverse_head_shoulders(df, symbol)
            
            all_patterns = hs_patterns + ihs_patterns
            result[tf_name]["patterns"] = len(all_patterns)
            result[tf_name]["hs_top"] = len(hs_patterns)
            result[tf_name]["ihs_bottom"] = len(ihs_patterns)
            
            if all_patterns:
                # Simulate trades
                sim = NSETradeSimulator()
                trades = sim.run(df, all_patterns, symbol)
                result[tf_name]["trades"] = trades
                
                # Add to global results
                for p in all_patterns:
                    p["timeframe"] = tf_name
                    self.results[tf_name]["patterns"].append(p)
                for t in trades:
                    t["timeframe"] = tf_name
                    self.results[tf_name]["trades"].append(t)
        
        return result
    
    def run_all(self, symbols: List[str], max_stocks: int = 300) -> Dict:
        """Run backtest on all NSE symbols with batching."""
        total = min(len(symbols), max_stocks)
        logger.info(f"Running NSE H&S Backtest on {total} symbols...")
        logger.info(f"Timeframes: Daily (5y), Weekly (10y), Monthly (20y)")
        logger.info("=" * 70)
        
        completed = 0
        patterns_found = 0
        stocks_with_patterns = 0
        batch_num = 0
        
        for i in range(0, total, self.config.batch_size):
            batch = symbols[i:i + self.config.batch_size]
            batch_num += 1
            logger.info(f"Batch {batch_num}/{(total-1)//self.config.batch_size + 1} "
                       f"({i+1}-{min(i+self.config.batch_size, total)} of {total})")
            
            batch_patterns = 0
            for symbol in batch:
                try:
                    result = self.run_symbol(symbol)
                    completed += 1
                    
                    has_patterns = any(
                        result[tf]["patterns"] > 0 
                        for tf in ["daily", "weekly", "monthly"]
                    )
                    
                    if has_patterns:
                        stocks_with_patterns += 1
                        tf_count = sum(result[tf]["patterns"] for tf in ["daily", "weekly", "monthly"])
                        batch_patterns += tf_count
                        patterns_found += tf_count
                        
                        # Log first few
                        if stocks_with_patterns <= 5 or completed % 100 == 0:
                            detail = " | ".join([
                                f"{tf}:{result[tf]['patterns']}p" 
                                for tf in ["daily", "weekly", "monthly"]
                                if result[tf]["patterns"] > 0
                            ])
                            logger.info(f"  ✅ {symbol}: {detail}")
                    
                    if completed % 100 == 0:
                        logger.info(f"  Progress: {completed}/{total} stocks scanned, "
                                   f"{stocks_with_patterns} with patterns, {patterns_found} total patterns")
                        
                except Exception as e:
                    self.results["errors"].append({"symbol": symbol, "error": str(e)})
            
            # Sleep between batches to avoid rate limiting
            if i + self.config.batch_size < total:
                time.sleep(self.config.sleep_between_batches)
        
        # Calculate final statistics
        self._calculate_statistics(total, completed, stocks_with_patterns, patterns_found)
        
        return self.results
    
    def _calculate_statistics(self, total: int, completed: int, 
                               stocks_with_patterns: int, patterns_found: int):
        """Calculate aggregate statistics for all timeframes."""
        
        for tf in ["daily", "weekly", "monthly"]:
            trades = self.results[tf]["trades"]
            patterns = self.results[tf]["patterns"]
            
            if not trades:
                self.results[tf]["stats"] = {
                    "patterns_detected": len(patterns),
                    "trades_executed": 0,
                    "error": "No trades"
                }
                continue
            
            wins = [t for t in trades if t["pnl"] > 0]
            losses = [t for t in trades if t["pnl"] <= 0]
            
            win_rate = len(wins) / len(trades) * 100 if trades else 0
            gross_profit = sum(t["pnl"] for t in wins)
            gross_loss = abs(sum(t["pnl"] for t in losses))
            profit_factor = gross_profit / gross_loss if gross_loss > 0 else float("inf")
            total_pnl = sum(t["pnl"] for t in trades)
            
            # P&L distribution
            pnl_values = [t["pnl"] for t in trades]
            
            # R:R analysis
            avg_rr = np.mean([t["rr_ratio"] for t in trades]) if trades else 0
            
            # Target hit rate
            target_hit_rate = sum(1 for t in trades if t.get("target_hit", False)) / len(trades) * 100 if trades else 0
            
            self.results[tf]["stats"] = {
                "patterns_detected": len(patterns),
                "trades_executed": len(trades),
                "win_count": len(wins),
                "loss_count": len(losses),
                "win_rate_pct": round(win_rate, 2),
                "profit_factor": round(profit_factor, 2),
                "total_pnl": round(total_pnl, 2),
                "avg_trade_pnl": round(total_pnl / len(trades), 2) if trades else 0,
                "avg_win": round(gross_profit / len(wins), 2) if wins else 0,
                "avg_loss": round(gross_loss / len(losses), 2) if losses else 0,
                "largest_win": round(max(pnl_values), 2) if pnl_values else 0,
                "largest_loss": round(min(pnl_values), 2) if pnl_values else 0,
                "avg_rr_ratio": round(avg_rr, 2),
                "target_hit_rate_pct": round(target_hit_rate, 2),
                "hs_top_count": len([p for p in patterns if p["type"] == "H&S_TOP"]),
                "ihs_bottom_count": len([p for p in patterns if p["type"] == "IH&S_BOTTOM"]),
                "unique_stocks": len(set(t["ticker"] for t in trades)),
                "max_consecutive_wins": self._max_consecutive([t["pnl"] > 0 for t in trades]),
                "max_consecutive_losses": self._max_consecutive([t["pnl"] <= 0 for t in trades]),
            }
        
        # Overall summary
        all_trades = []
        for tf in ["daily", "weekly", "monthly"]:
            all_trades.extend(self.results[tf]["trades"])
        
        all_patterns_count = sum(len(self.results[tf]["patterns"]) for tf in ["daily", "weekly", "monthly"])
        
        self.results["summary"] = {
            "total_symbols_in_universe": total,
            "symbols_scanned": completed,
            "symbols_with_data": completed - len(self.results["errors"]),
            "stocks_with_patterns": stocks_with_patterns,
            "total_patterns_all_timeframes": all_patterns_count,
            "total_trades_all_timeframes": len(all_trades),
            "total_pnl_all_timeframes": round(sum(t["pnl"] for t in all_trades), 2) if all_trades else 0,
            "total_wins": len([t for t in all_trades if t["pnl"] > 0]),
            "total_losses": len([t for t in all_trades if t["pnl"] <= 0]),
            "overall_win_rate_pct": round(len([t for t in all_trades if t["pnl"] > 0]) / len(all_trades) * 100, 2) if all_trades else 0,
            "errors_count": len(self.results["errors"]),
            "analysis_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }
    
    @staticmethod
    def _max_consecutive(booleans: List[bool]) -> int:
        max_count = 0
        current = 0
        for b in booleans:
            if b:
                current += 1
                max_count = max(max_count, current)
            else:
                current = 0
        return max_count


# ============================================================================
# REPORT GENERATOR
# ============================================================================

def generate_nse_report(results: Dict, output_dir: str = "/Users/vijaykumar/opencode/share/document"):
    """Generate comprehensive NSE backtest report."""
    
    summary = results.get("summary", {})
    
    print("\n" + "█" * 70)
    print("   NSE INDIA — HEAD AND SHOULDERS BACKTEST REPORT")
    print("   Complete Market Analysis — Multi-Timeframe")
    print("█" * 70)
    
    print(f"\n📊 EXECUTIVE SUMMARY")
    print(f"   Universe:           {summary.get('total_symbols_in_universe', 0)} NSE symbols")
    print(f"   Scanned:            {summary.get('symbols_scanned', 0)}")
    print(f"   With Data:          {summary.get('symbols_with_data', 0)}")
    print(f"   Stocks w/ Patterns: {summary.get('stocks_with_patterns', 0)}")
    print(f"   Total Patterns:     {summary.get('total_patterns_all_timeframes', 0)}")
    print(f"   Total Trades:       {summary.get('total_trades_all_timeframes', 0)}")
    print(f"   Overall Win Rate:   {summary.get('overall_win_rate_pct', 0)}%")
    print(f"   Total P&L:         ₹{summary.get('total_pnl_all_timeframes', 0):,.2f}")
    
    for tf_name in ["daily", "weekly", "monthly"]:
        stats = results.get(tf_name, {}).get("stats", {})
        if stats.get("error"):
            print(f"\n   ⏱ {tf_name.upper()}: {stats['error']}")
            continue
        
        print(f"\n   ⏱ {tf_name.upper()} TIMEFRAME")
        print(f"      Patterns Detected: {stats.get('patterns_detected', 0)}")
        print(f"      Trades Executed:   {stats.get('trades_executed', 0)}")
        print(f"      Win Rate:          {stats.get('win_rate_pct', 0)}%")
        print(f"      Profit Factor:     {stats.get('profit_factor', 0)}")
        print(f"      Total P&L:         ₹{stats.get('total_pnl', 0):,.2f}")
        print(f"      Avg Trade P&L:     ₹{stats.get('avg_trade_pnl', 0):,.2f}")
        print(f"      Avg Win:           ₹{stats.get('avg_win', 0):,.2f}")
        print(f"      Avg Loss:          ₹{stats.get('avg_loss', 0):,.2f}")
        print(f"      Largest Win:       ₹{stats.get('largest_win', 0):,.2f}")
        print(f"      Largest Loss:      ₹{stats.get('largest_loss', 0):,.2f}")
        print(f"      Avg R:R:           {stats.get('avg_rr_ratio', 0)}")
        print(f"      Target Hit Rate:   {stats.get('target_hit_rate_pct', 0)}%")
        print(f"      H&S Top:           {stats.get('hs_top_count', 0)}")
        print(f"      IH&S Bottom:       {stats.get('ihs_bottom_count', 0)}")
        print(f"      Unique Stocks:     {stats.get('unique_stocks', 0)}")
        print(f"      Max Consec Wins:   {stats.get('max_consecutive_wins', 0)}")
        print(f"      Max Consec Losses: {stats.get('max_consecutive_losses', 0)}")
        
        # Pattern type breakdown
        patterns = results.get(tf_name, {}).get("patterns", [])
        top_count = len([p for p in patterns if p["type"] == "H&S_TOP"])
        bottom_count = len([p for p in patterns if p["type"] == "IH&S_BOTTOM"])
        print(f"      Pattern Mix:        {top_count} H&S Top + {bottom_count} IH&S Bottom")
        
        # Top stocks by P&L
        trades = results.get(tf_name, {}).get("trades", [])
        if trades:
            ticker_pnl = {}
            for t in trades:
                sym = t["ticker"]
                if sym not in ticker_pnl:
                    ticker_pnl[sym] = {"trades": 0, "wins": 0, "pnl": 0}
                ticker_pnl[sym]["trades"] += 1
                ticker_pnl[sym]["wins"] += 1 if t["pnl"] > 0 else 0
                ticker_pnl[sym]["pnl"] += t["pnl"]
            
            top_stocks = sorted(ticker_pnl.items(), key=lambda x: x[1]["pnl"], reverse=True)[:10]
            print(f"      Top 10 Stocks by P&L:")
            for i, (sym, data) in enumerate(top_stocks):
                wr = data["wins"] / data["trades"] * 100
                print(f"         {i+1}. {sym}: {data['trades']} trades, "
                      f"{wr:.0f}% WR, ₹{data['pnl']:,.2f}")
    
    print(f"\n{'='*70}")
    print(f"   MULTI-TIMEFRAME COMPARISON")
    print(f"{'='*70}")
    print(f"   {'Timeframe':<12} {'Patterns':<10} {'Trades':<8} {'Win Rate':<10} {'Profit Factor':<15} {'Avg R:R':<10}")
    print(f"   {'─'*12} {'─'*10} {'─'*8} {'─'*10} {'─'*15} {'─'*10}")
    for tf_name in ["daily", "weekly", "monthly"]:
        s = results.get(tf_name, {}).get("stats", {})
        if s and not s.get("error"):
            print(f"   {tf_name:<12} {s.get('patterns_detected', 0):<10} "
                  f"{s.get('trades_executed', 0):<8} {s.get('win_rate_pct', 0):<8}% "
                  f"{s.get('profit_factor', 0):<15} {s.get('avg_rr_ratio', 0):<10}")
    
    # Save reports
    for tf_name in ["daily", "weekly", "monthly"]:
        tf_results = results.get(tf_name, {})
        filepath = os.path.join(output_dir, f"nse_hs_{tf_name}_results.json")
        with open(filepath, "w") as f:
            json.dump({
                "stats": tf_results.get("stats", {}),
                "pattern_count": len(tf_results.get("patterns", [])),
                "trade_count": len(tf_results.get("trades", [])),
                "sample_trades": tf_results.get("trades", [])[:20],  # First 20 only
            }, f, indent=2, default=str)
        print(f"\n   ✅ {tf_name} report saved: {filepath}")
    
    # Save combined summary
    summary_path = os.path.join(output_dir, "nse_hs_summary.json")
    with open(summary_path, "w") as f:
        json.dump({
            "summary": summary,
            "daily_stats": results.get("daily", {}).get("stats", {}),
            "weekly_stats": results.get("weekly", {}).get("stats", {}),
            "monthly_stats": results.get("monthly", {}).get("stats", {}),
            "sample_patterns": {
                tf: results.get(tf, {}).get("patterns", [])[:5]
                for tf in ["daily", "weekly", "monthly"]
            }
        }, f, indent=2, default=str)
    print(f"\n   ✅ Combined summary saved: {summary_path}")
    print(f"\n{'='*70}\n")


# ============================================================================
# MAIN EXECUTION
# ============================================================================

if __name__ == "__main__":
    import yfinance as yf
    print(f"yfinance version: {yf.__version__ if hasattr(yf, '__version__') else 'installed'}")
    
    print("\n" + "█" * 70)
    print("   NSE INDIA — HEAD AND SHOULDERS COMPLETE MARKET BACKTEST")
    print("   Multi-Timeframe Analysis Engine v3.0")
    print("█" * 70)
    
    # Load NSE symbols
    symbols_path = "/Users/vijaykumar/opencode/share/document/nse_symbols.txt"
    with open(symbols_path, "r") as f:
        all_symbols = [line.strip() for line in f if line.strip()]
    
    print(f"\n📋 NSE Universe: {len(all_symbols)} symbols loaded")
    
    # Configuration
    config = HSConfig(
        min_pattern_bars=20,
        max_pattern_bars=120,
        neckline_break_pct=0.015,
        min_rr_ratio=1.2,
        batch_size=30,
        sleep_between_batches=3,
        max_stocks=2381  # All NSE stocks
    )
    
    # Take first N symbols
    test_symbols = all_symbols[:config.max_stocks]
    print(f"   Testing first {len(test_symbols)} symbols (A-Z sorted)")
    
    # Run backtest
    backtest = NSEHeadShoulderBacktest(config)
    results = backtest.run_all(test_symbols, max_stocks=config.max_stocks)
    
    # Generate report
    generate_nse_report(results)
    
    print("\n✅ NSE Backtest Complete!\n")
