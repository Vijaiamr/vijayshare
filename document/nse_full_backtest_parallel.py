#!/usr/bin/env python3
"""
NSE Full Universe Head & Shoulders Backtest — Parallel Execution
Processes all 2,381 NSE symbols across 3 timeframes using ThreadPoolExecutor.
"""
import json, os, time, sys, logging, warnings, traceback, math
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Optional
import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")
logging.basicConfig(level=logging.INFO, format="%(asctime)s | %(message)s")
logger = logging.getLogger("NSE_FULL")

DOC_DIR = "/Users/vijaykumar/opencode/share/document"
SYMBOLS_FILE = os.path.join(DOC_DIR, "nse_symbols.txt")
RESULTS_DIR = DOC_DIR

# ── Load all symbols ──────────────────────────────────────────────
with open(SYMBOLS_FILE) as f:
    ALL_SYMBOLS = [line.strip() for line in f if line.strip()]
TOTAL = len(ALL_SYMBOLS)
logger.info(f"Loaded {TOTAL} NSE symbols")

# ── Helper: flatten MultiIndex columns ────────────────────────────
def flatten_cols(df):
    if df is None or df.empty:
        return None
    cols = []
    for c in df.columns:
        if isinstance(c, tuple):
            cols.append(c[0].lower().replace(" ", "_"))
        else:
            cols.append(str(c).lower().replace(" ", "_"))
    df.columns = cols
    return df

# ── Fetch a single symbol for all 3 timeframes ────────────────────
def fetch_symbol_data(symbol: str) -> dict:
    """Fetch all 3 timeframes for one symbol."""
    import yfinance as yf
    yahoo_sym = f"{symbol}.NS"
    result = {"symbol": symbol, "daily": None, "weekly": None, "monthly": None, "error": None}
    
    try:
        # Daily (5y)
        df_d = yf.download(yahoo_sym, period="5y", interval="1d", auto_adjust=True, progress=False)
        df_d = flatten_cols(df_d)
        if df_d is not None and len(df_d) >= 60:
            result["daily"] = df_d
        
        # Weekly (10y)
        df_w = yf.download(yahoo_sym, period="10y", interval="1wk", auto_adjust=True, progress=False)
        df_w = flatten_cols(df_w)
        if df_w is not None and len(df_w) >= 60:
            result["weekly"] = df_w
        
        # Monthly (20y)
        df_m = yf.download(yahoo_sym, period="20y", interval="1mo", auto_adjust=True, progress=False)
        df_m = flatten_cols(df_m)
        if df_m is not None and len(df_m) >= 20:
            result["monthly"] = df_m
            
    except Exception as e:
        result["error"] = str(e)[:100]
    
    return result

# ── Detection (copied from existing engine) ───────────────────────
from scipy.signal import argrelextrema

PIVOT_WINDOW = 5
MIN_BARS = 20
MAX_BARS = 120
NECKLINE_BREAK = 0.015
MIN_RR = 1.2
TARGET_MULT = 1.0

def find_pivots(series, order, greater):
    vals = series.values
    if len(vals) < order * 2 + 1:
        return np.array([])
    if greater:
        return argrelextrema(vals, np.greater, order=order)[0]
    else:
        return argrelextrema(vals, np.less, order=order)[0]

def detect_and_trade(symbol: str, df: pd.DataFrame, tf_name: str) -> tuple:
    """Detect patterns and simulate trades on single timeframe DataFrame.
    Returns (patterns_list, trades_list)
    """
    import yfinance as yf
    from scipy.signal import argrelextrema
    
    patterns = []
    
    pivots_high = find_pivots(df["high"], PIVOT_WINDOW, True)
    pivots_low = find_pivots(df["low"], PIVOT_WINDOW, False)
    closes = df["close"].values
    highs = df["high"].values
    lows = df["low"].values
    dates = df.index.to_pydatetime() if hasattr(df.index, 'to_pydatetime') else df.index
    
    # ── H&S Top detection ──
    if len(pivots_high) >= 3:
        for i in range(len(pivots_high) - 2):
            ls_i, h_i, rs_i = pivots_high[i], pivots_high[i+1], pivots_high[i+2]
            ls_p, h_p, rs_p = float(highs[ls_i]), float(highs[h_i]), float(highs[rs_i])
            if not (h_p > ls_p and h_p > rs_p): continue
            if rs_p > ls_p * 1.05: continue
            
            # Find troughs
            t1 = min([p for p in pivots_low if ls_i < p < h_i], default=None, 
                     key=lambda p: lows[p] if p is not None else float('inf'))
            t2 = min([p for p in pivots_low if h_i < p < rs_i], default=None,
                     key=lambda p: lows[p] if p is not None else float('inf'))
            if t1 is None or t2 is None: continue
            
            t1_p, t2_p = float(lows[t1]), float(lows[t2])
            bar_diff = t2 - t1
            if bar_diff <= 0: continue
            slope = (t2_p - t1_p) / bar_diff
            width = rs_i - ls_i
            if width < MIN_BARS or width > MAX_BARS: continue
            
            # Breakout scan
            for bi in range(rs_i + 1, min(rs_i + 60, len(df))):
                nv = t1_p + slope * (bi - t1)
                if float(closes[bi]) < nv * (1 - NECKLINE_BREAK):
                    ht = h_p - nv
                    target = nv - ht * TARGET_MULT
                    ep = float(closes[bi])
                    rs_h = float(highs[max(0, rs_i-3):rs_i+1].max())
                    bh = float(highs[max(0, bi-3):bi+1].max())
                    sl = max(rs_h, bh)
                    risk = sl - ep
                    if risk <= 0: continue
                    reward = ep - target
                    if reward <= 0: continue
                    rr = reward / risk
                    if rr < MIN_RR: continue
                    
                    ls_v = float(df.iloc[max(0, ls_i-2):ls_i+1]["volume"].mean())
                    rs_v = float(df.iloc[max(0, rs_i-2):rs_i+1]["volume"].mean())
                    vr = rs_v / ls_v if ls_v > 0 else 1.0
                    
                    patterns.append({
                        "type": "H&S_TOP", "ticker": symbol, "timeframe": tf_name,
                        "entry_date": str(dates[bi].date()) if hasattr(dates[bi], 'date') else str(dates[bi]),
                        "entry_price": round(ep, 2), "stop_loss": round(sl, 2),
                        "target": round(max(target, 0), 2), "neckline_value": round(nv, 2),
                        "head_price": round(h_p, 2), "left_shoulder": round(ls_p, 2),
                        "right_shoulder": round(rs_p, 2), "pattern_width_bars": int(width),
                        "risk_per_share": round(risk, 2), "reward_per_share": round(reward, 2),
                        "rr_ratio": round(rr, 2), "neckline_slope": round(slope, 4),
                        "volume_ratio_rs_ls": round(vr, 2)
                    })
                    break
    
    # ── IH&S Bottom detection ──
    if len(pivots_low) >= 3:
        for i in range(len(pivots_low) - 2):
            ls_i, h_i, rs_i = pivots_low[i], pivots_low[i+1], pivots_low[i+2]
            ls_p, h_p, rs_p = float(lows[ls_i]), float(lows[h_i]), float(lows[rs_i])
            if not (h_p < ls_p and h_p < rs_p): continue
            if rs_p < ls_p * 0.95: continue
            
            p1 = max([p for p in pivots_high if ls_i < p < h_i], default=None,
                     key=lambda p: highs[p] if p is not None else -float('inf'))
            p2 = max([p for p in pivots_high if h_i < p < rs_i], default=None,
                     key=lambda p: highs[p] if p is not None else -float('inf'))
            if p1 is None or p2 is None: continue
            
            p1_p, p2_p = float(highs[p1]), float(highs[p2])
            bar_diff = p2 - p1
            if bar_diff <= 0: continue
            slope = (p2_p - p1_p) / bar_diff
            width = rs_i - ls_i
            if width < MIN_BARS or width > MAX_BARS: continue
            
            for bi in range(rs_i + 1, min(rs_i + 60, len(df))):
                nv = p1_p + slope * (bi - p1)
                if float(closes[bi]) > nv * (1 + NECKLINE_BREAK):
                    ht = nv - h_p
                    target = nv + ht * TARGET_MULT
                    ep = float(closes[bi])
                    rs_l = float(lows[max(0, rs_i-3):rs_i+1].min())
                    bl = float(lows[max(0, bi-3):bi+1].min())
                    sl = min(rs_l, bl)
                    risk = ep - sl
                    if risk <= 0: continue
                    reward = target - ep
                    if reward <= 0: continue
                    rr = reward / risk
                    if rr < MIN_RR: continue
                    
                    ls_v = float(df.iloc[max(0, ls_i-2):ls_i+1]["volume"].mean())
                    rs_v = float(df.iloc[max(0, rs_i-2):rs_i+1]["volume"].mean())
                    vr = rs_v / ls_v if ls_v > 0 else 1.0
                    
                    patterns.append({
                        "type": "IH&S_BOTTOM", "ticker": symbol, "timeframe": tf_name,
                        "entry_date": str(dates[bi].date()) if hasattr(dates[bi], 'date') else str(dates[bi]),
                        "entry_price": round(ep, 2), "stop_loss": round(sl, 2),
                        "target": round(target, 2), "neckline_value": round(nv, 2),
                        "head_price": round(h_p, 2), "left_shoulder": round(ls_p, 2),
                        "right_shoulder": round(rs_p, 2), "pattern_width_bars": int(width),
                        "risk_per_share": round(risk, 2), "reward_per_share": round(reward, 2),
                        "rr_ratio": round(rr, 2), "neckline_slope": round(slope, 4),
                        "volume_ratio_rs_ls": round(vr, 2)
                    })
                    break
    
    # ── Simulate trades ──
    trades = []
    capital = 10_000_000
    risk_pct = 0.02
    slippage = 0.002
    
    for p in patterns:
        if capital <= 0: break
        ed = p["entry_date"]
        ei = None
        for idx in range(len(df)):
            d = str(dates[idx].date()) if hasattr(dates[idx], 'date') else str(dates[idx])
            if d == ed:
                ei = idx; break
        if ei is None or ei >= len(df) - 5: continue
        
        direction = "SHORT" if p["type"] == "H&S_TOP" else "LONG"
        ep = p["entry_price"] * (1 - slippage) if direction == "SHORT" else p["entry_price"] * (1 + slippage)
        sl = p["stop_loss"]; tgt = p["target"]
        
        risk_ps = sl - ep if direction == "SHORT" else ep - sl
        if risk_ps <= 0: continue
        size = (capital * risk_pct) / risk_ps
        if size <= 0: continue
        
        max_bars = min(ei + 120, len(df))
        exit_date, exit_price, exit_reason = None, None, ""
        hit_tgt = False
        
        for xi in range(ei + 1, max_bars):
            bh, bl = float(highs[xi]), float(lows[xi])
            if direction == "SHORT":
                if bh >= sl: exit_date, exit_price, exit_reason = dates[xi], sl * (1 + slippage), "STOP_LOSS_HIT"; break
                if bl <= tgt: exit_date, exit_price, exit_reason = dates[xi], tgt * (1 - slippage), "TARGET_HIT"; hit_tgt = True; break
            else:
                if bl <= sl: exit_date, exit_price, exit_reason = dates[xi], sl * (1 - slippage), "STOP_LOSS_HIT"; break
                if bh >= tgt: exit_date, exit_price, exit_reason = dates[xi], tgt * (1 + slippage), "TARGET_HIT"; hit_tgt = True; break
        
        if exit_date is None:
            fi = min(ei + 120, len(df) - 1)
            exit_date, exit_price = dates[fi], float(closes[fi])
            exit_reason = "TIME_EXIT"
            held = fi - ei
        else:
            held = 0
            for idx in range(ei + 1, len(dates)):
                d1 = str(dates[idx].date()) if hasattr(dates[idx], 'date') else str(dates[idx])
                d2 = str(exit_date.date()) if hasattr(exit_date, 'date') else str(exit_date)
                if d1 == d2: held = idx - ei; break
        
        # Guard against NaN values
        if exit_price is None or (isinstance(exit_price, float) and math.isnan(exit_price)):
            continue
        if isinstance(ep, float) and math.isnan(ep):
            continue
        if size <= 0 or (isinstance(size, float) and math.isnan(size)):
            continue
        
        pnl = ((ep - exit_price) if direction == "SHORT" else (exit_price - ep)) * size
        if isinstance(pnl, float) and math.isnan(pnl):
            continue
        pnl_pct = ((ep - exit_price) / ep * 100) if direction == "SHORT" else ((exit_price - ep) / ep * 100)
        capital += pnl
        
        trades.append({
            "ticker": symbol, "pattern_type": p["type"], "direction": direction,
            "entry_date": ed, "entry_price": round(ep, 2),
            "exit_date": str(exit_date.date()) if hasattr(exit_date, 'date') else str(exit_date),
            "exit_price": round(float(exit_price), 2), "exit_reason": exit_reason,
            "pnl": round(pnl, 2), "pnl_pct": round(pnl_pct, 2),
            "rr_ratio": p["rr_ratio"], "bars_held": held, "target_hit": hit_tgt,
            "head_price": p["head_price"], "neckline_value": p["neckline_value"],
            "volume_ratio": p.get("volume_ratio_rs_ls", 0), "timeframe": tf_name
        })
    
    return patterns, trades


# ── Process one symbol (all TFs) ──────────────────────────────────
def process_symbol(symbol: str) -> dict:
    """Full pipeline for one symbol."""
    result = {"symbol": symbol, "total_patterns": 0, "total_trades": 0, 
              "daily": {"p": 0, "hs": 0, "ihs": 0, "t": 0},
              "weekly": {"p": 0, "hs": 0, "ihs": 0, "t": 0},
              "monthly": {"p": 0, "hs": 0, "ihs": 0, "t": 0},
              "patterns": [], "trades": []}
    
    data = fetch_symbol_data(symbol)
    if data["error"]:
        result["error"] = data["error"]
        return result
    
    for tf_name in ["daily", "weekly", "monthly"]:
        df = data[tf_name]
        if df is None:
            continue
        patterns, trades = detect_and_trade(symbol, df, tf_name)
        hs = len([p for p in patterns if p["type"] == "H&S_TOP"])
        ihs = len([p for p in patterns if p["type"] == "IH&S_BOTTOM"])
        result[tf_name] = {"p": len(patterns), "hs": hs, "ihs": ihs, "t": len(trades)}
        result["total_patterns"] += len(patterns)
        result["total_trades"] += len(trades)
        result["patterns"].extend(patterns)
        result["trades"].extend(trades)
    
    return result


# ── Stats calculator ──────────────────────────────────────────────
def compute_stats(trades_list):
    if not trades_list:
        return {"trades_executed": 0, "win_rate_pct": 0}
    # Filter out NaN P&L trades
    clean = [t for t in trades_list if not (isinstance(t.get("pnl"), float) and math.isnan(t["pnl"]))]
    if not clean:
        return {"trades_executed": len(trades_list), "win_rate_pct": 0, "warning": "all_trades_have_nan_pnl"}
    trades_list = clean
    wins = [t for t in trades_list if t["pnl"] > 0]
    losses = [t for t in trades_list if t["pnl"] <= 0]
    n = len(trades_list)
    wr = len(wins) / n * 100
    gp = sum(t["pnl"] for t in wins)
    gl = abs(sum(t["pnl"] for t in losses))
    pf = gp / gl if gl > 0 else float('inf')
    total_pnl = sum(t["pnl"] for t in trades_list)
    pnl_vals = [t["pnl"] for t in trades_list]
    avg_rr = np.mean([t["rr_ratio"] for t in trades_list]) if trades_list else 0
    thr = sum(1 for t in trades_list if t.get("target_hit")) / n * 100 if n else 0
    
    def max_cons(booleans):
        mx, cur = 0, 0
        for b in booleans:
            cur = cur + 1 if b else 0
            mx = max(mx, cur)
        return mx
    
    return {
        "trades_executed": n, "win_count": len(wins), "loss_count": len(losses),
        "win_rate_pct": round(wr, 2), "profit_factor": round(pf, 2),
        "total_pnl": round(total_pnl, 2),
        "avg_trade_pnl": round(total_pnl / n, 2) if n else 0,
        "avg_win": round(gp / len(wins), 2) if wins else 0,
        "avg_loss": round(gl / len(losses), 2) if losses else 0,
        "largest_win": round(max(pnl_vals), 2) if pnl_vals else 0,
        "largest_loss": round(min(pnl_vals), 2) if pnl_vals else 0,
        "avg_rr_ratio": round(avg_rr, 2),
        "target_hit_rate_pct": round(thr, 2),
        "max_consecutive_wins": max_cons([t["pnl"] > 0 for t in trades_list]),
        "max_consecutive_losses": max_cons([t["pnl"] <= 0 for t in trades_list]),
    }


# ════════════════════════════════════════════════════════════════
# MAIN — PARALLEL EXECUTION
# ════════════════════════════════════════════════════════════════

def main():
    import yfinance as yf
    logger.info(f"yfinance version: {yf.__version__ if hasattr(yf, '__version__') else 'installed'}")
    logger.info(f"NSE Full Universe: {TOTAL} symbols")
    logger.info("Parallel execution: max_workers=6, batch_size=60")
    t0 = time.time()
    
    BATCH_SIZE = 60     # Stocks per batch
    MAX_WORKERS = 6     # Parallel threads
    SLEEP_BETWEEN = 4   # Seconds between batches
    
    # Store all results
    all_patterns = {"daily": [], "weekly": [], "monthly": []}
    all_trades = {"daily": [], "weekly": [], "monthly": []}
    stats_per_stock = {}
    error_count = 0
    stocks_with_patterns = set()
    total_processed = 0
    last_save_time = time.time()
    
    for batch_start in range(0, TOTAL, BATCH_SIZE):
        batch = ALL_SYMBOLS[batch_start:batch_start + BATCH_SIZE]
        batch_end = min(batch_start + BATCH_SIZE, TOTAL)
        batch_num = batch_start // BATCH_SIZE + 1
        total_batches = (TOTAL - 1) // BATCH_SIZE + 1
        
        logger.info(f"Batch {batch_num}/{total_batches} ({batch_start+1}-{batch_end} of {TOTAL})")
        
        batch_patterns_count = 0
        batch_trades_count = 0
        
        with ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
            futures = {executor.submit(process_symbol, sym): sym for sym in batch}
            for future in as_completed(futures):
                sym = futures[future]
                try:
                    res = future.result()
                    total_processed += 1
                    
                    if res.get("error"):
                        error_count += 1
                        if error_count <= 3 or total_processed % 500 == 0:
                            logger.info(f"  ⚠ {sym}: {res['error'][:80]}")
                        continue
                    
                    stats_per_stock[sym] = res
                    bp = res["total_patterns"]
                    bt = res["total_trades"]
                    batch_patterns_count += bp
                    batch_trades_count += bt
                    
                    if bp > 0:
                        stocks_with_patterns.add(sym)
                        # Log first few or every 100th
                        if len(stocks_with_patterns) <= 5 or total_processed % 200 == 0:
                            detail = " | ".join([f"{tf}:{res[tf]['p']}p" for tf in ["daily","weekly","monthly"] if res[tf]["p"] > 0])
                            logger.info(f"  ✅ {sym}: {detail}")
                    
                    # Accumulate
                    for tf in ["daily", "weekly", "monthly"]:
                        all_patterns[tf].extend([p for p in res.get("patterns", []) if p["timeframe"] == tf])
                        all_trades[tf].extend([t for t in res.get("trades", []) if t["timeframe"] == tf])
                        
                except Exception as e:
                    error_count += 1
                    if error_count <= 5:
                        logger.info(f"  ❌ {sym}: {str(e)[:80]}")
        
        elapsed = time.time() - t0
        rate = total_processed / (elapsed / 60) if elapsed > 0 else 0
        logger.info(f"  → Batch done: {batch_patterns_count}p, {batch_trades_count}t | "
                   f"Progress: {total_processed}/{TOTAL} ({total_processed/TOTAL*100:.1f}%), "
                   f"{len(stocks_with_patterns)} with patterns | "
                   f"Rate: {rate:.0f} stocks/min | Elapsed: {elapsed/60:.1f}min")
        
        # Incremental save every 5 minutes
        if time.time() - last_save_time > 300:
            _save_intermediate(all_patterns, all_trades, total_processed, len(stocks_with_patterns), error_count)
            last_save_time = time.time()
        
        # Sleep between batches
        if batch_end < TOTAL:
            time.sleep(SLEEP_BETWEEN)
    
    # ── Final statistics ──
    total_elapsed = time.time() - t0
    logger.info(f"\n{'='*70}")
    logger.info(f"BACKTEST COMPLETE — {total_processed} stocks in {total_elapsed/60:.1f} min")
    logger.info(f"{'='*70}")
    
    # Compute per-TF stats
    daily_stats = compute_stats(all_trades["daily"])
    weekly_stats = compute_stats(all_trades["weekly"])
    monthly_stats = compute_stats(all_trades["monthly"])
    
    all_trades_flat = all_trades["daily"] + all_trades["weekly"] + all_trades["monthly"]
    overall_stats = compute_stats(all_trades_flat)
    
    # Add pattern type counts
    for tf in ["daily", "weekly", "monthly"]:
        s = {"daily": daily_stats, "weekly": weekly_stats, "monthly": monthly_stats}[tf]
        s["patterns_detected"] = len(all_patterns[tf])
        s["hs_top_count"] = len([p for p in all_patterns[tf] if p["type"] == "H&S_TOP"])
        s["ihs_bottom_count"] = len([p for p in all_patterns[tf] if p["type"] == "IH&S_BOTTOM"])
        s["unique_stocks"] = len(set(t["ticker"] for t in all_trades[tf]))
    
    summary = {
        "total_symbols_in_universe": TOTAL,
        "symbols_scanned": total_processed,
        "symbols_with_data": total_processed - error_count,
        "stocks_with_patterns": len(stocks_with_patterns),
        "total_patterns_all_timeframes": sum(len(all_patterns[tf]) for tf in ["daily","weekly","monthly"]),
        "total_trades_all_timeframes": len(all_trades_flat),
        "total_pnl_all_timeframes": round(sum(t["pnl"] for t in all_trades_flat), 2) if all_trades_flat else 0,
        "total_wins": len([t for t in all_trades_flat if t["pnl"] > 0]),
        "total_losses": len([t for t in all_trades_flat if t["pnl"] <= 0]),
        "overall_win_rate_pct": round(overall_stats["win_rate_pct"], 2) if overall_stats else 0,
        "errors_count": error_count,
        "analysis_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "elapsed_minutes": round(total_elapsed / 60, 1)
    }
    
    # Save final results
    _save_final(all_patterns, all_trades, daily_stats, weekly_stats, monthly_stats, summary)
    
    # Print summary
    print(f"\n{'█'*70}")
    print(f"   NSE INDIA — FULL HEAD & SHOULDERS BACKTEST RESULTS")
    print(f"{'█'*70}")
    print(f"\n📊 EXECUTIVE SUMMARY")
    print(f"   Universe:           {TOTAL} NSE symbols")
    print(f"   Scanned:            {total_processed}")
    print(f"   With Data:          {total_processed - error_count}")
    print(f"   Stocks w/ Patterns: {len(stocks_with_patterns)}")
    print(f"   Total Patterns:     {summary['total_patterns_all_timeframes']}")
    print(f"   Total Trades:       {summary['total_trades_all_timeframes']}")
    print(f"   Total Wins:         {summary['total_wins']}")
    print(f"   Total Losses:       {summary['total_losses']}")
    print(f"   Overall Win Rate:   {summary['overall_win_rate_pct']}%")
    print(f"   Total P&L:         ₹{summary['total_pnl_all_timeframes']:,.2f}")
    print(f"   Elapsed:            {summary['elapsed_minutes']} min")
    
    for tf_name, s in [("Daily", daily_stats), ("Weekly", weekly_stats), ("Monthly", monthly_stats)]:
        if s.get("trades_executed", 0) == 0:
            print(f"\n   ⏱ {tf_name}: No trades")
            continue
        print(f"\n   ⏱ {tf_name} TIMEFRAME")
        print(f"      Patterns: {s.get('patterns_detected',0)} | Trades: {s['trades_executed']} | "
              f"WR: {s['win_rate_pct']}% | PF: {s['profit_factor']}")
        print(f"      Total P&L: ₹{s['total_pnl']:,.2f} | Avg: ₹{s['avg_trade_pnl']:,.2f} | "
              f"Avg R:R: {s['avg_rr_ratio']}")
        print(f"      Targets Hit: {s['target_hit_rate_pct']}% | "
              f"H&S:{s['hs_top_count']} IH&S:{s['ihs_bottom_count']}")
    
    print(f"\n{'='*70}")
    print(f"   RESULTS SAVED TO: {RESULTS_DIR}")
    print(f"{'='*70}\n")


def _save_intermediate(all_patterns, all_trades, processed, stocks_w_pat, errors):
    """Save intermediate results (called periodically)."""
    for tf in ["daily", "weekly", "monthly"]:
        ts = all_trades[tf][:50]  # Save up to 50 sample trades
        fp = os.path.join(RESULTS_DIR, f"nse_hs_{tf}_results.json")
        with open(fp, "w") as f:
            json.dump({"stats": {"trades_executed": len(all_trades[tf]), "patterns_detected": len(all_patterns[tf]),
                                 "intermediate": True, "processed": processed, "stocks_with_patterns": stocks_w_pat,
                                 "errors": errors},
                        "pattern_count": len(all_patterns[tf]),
                        "trade_count": len(all_trades[tf]),
                        "sample_trades": ts}, f, indent=2, default=str)


def _save_final(all_patterns, all_trades, ds, ws, ms, summary):
    """Save final complete results."""
    # Per-TF files
    for tf_name, s, trades_key in [("daily", ds, "daily"), ("weekly", ws, "weekly"), ("monthly", ms, "monthly")]:
        s["patterns_detected"] = len(all_patterns[tf_name])
        fp = os.path.join(RESULTS_DIR, f"nse_hs_{tf_name}_results.json")
        with open(fp, "w") as f:
            json.dump({
                "stats": s,
                "pattern_count": len(all_patterns[tf_name]),
                "trade_count": len(all_trades[tf_name]),
                "sample_trades": all_trades[tf_name][:100]  # First 100 only
            }, f, indent=2, default=str)
    
    # Summary
    fp = os.path.join(RESULTS_DIR, "nse_hs_summary.json")
    with open(fp, "w") as f:
        json.dump({
            "summary": summary,
            "daily_stats": ds,
            "weekly_stats": ws,
            "monthly_stats": ms,
            "sample_patterns": {
                tf: all_patterns[tf][:10] for tf in ["daily", "weekly", "monthly"]
            }
        }, f, indent=2, default=str)
    
    logger.info("Final results saved to disk")


if __name__ == "__main__":
    main()
