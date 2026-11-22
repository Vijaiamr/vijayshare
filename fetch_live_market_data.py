#!/usr/bin/env python3
"""
fetch_live_market_data.py
=========================
Reusable tool to fetch LIVE market data for any symbol (default HDFCBANK.NS)
from the VijayMaruthi platform AND yfinance, cross-check them, and emit a
clean, structured result (JSON + readable summary).

Sources (in priority order, per the Technical/Fundamental Analyst handbooks):
  1. VijayMaruthi platform (primary, NSE/BSE focus)
       - POST http://localhost:8765/api/v1/analyze   (full quantamental snapshot)
       - GET  http://localhost:3001/api/dashboard    (screening / context)
       - GET  http://localhost:3001/api/ohlcv/{SYM}  (raw candles)
       - GET  http://localhost:3001/api/fundamentals/{SYM}
  2. yfinance (fallback / cross-check / US-crypto-FX)
  3. Cross-check price + key levels between sources.

Usage:
  python3 fetch_live_market_data.py HDFCBANK.NS
  python3 fetch_live_market_data.py HDFCBANK.NS --json
  python3 fetch_live_market_data.py HDFCBANK.NS --period 1y --out /tmp/hdfc.json
  python3 fetch_live_market_data.py --list-symbols          # show a few known tickers

  # Batch mode
  python3 fetch_live_market_data.py --batch HDFCBANK.NS ICICIBANK.NS SBIN.NS
  python3 fetch_live_market_data.py --batch-file symbols.txt --json --out /tmp/batch.json

  # Derivatives (options OI/IV/Greeks + futures) and intraday
  python3 fetch_live_market_data.py HDFCBANK.NS --derivatives
  python3 fetch_live_market_data.py HDFCBANK.NS --intraday --intraday-interval 15m

  # Chart generation (OHLCV + SMA/RSI/MACD/volume -> PNG)
  python3 fetch_live_market_data.py HDFCBANK.NS --chart /tmp/hdfc.png
  python3 fetch_live_market_data.py --batch HDFCBANK.NS ICICIBANK.NS --chart /tmp/charts/

  # Watchlist / portfolio tracking (persists snapshots over time)
  python3 fetch_live_market_data.py --watch-add HDFCBANK.NS ICICIBANK.NS SBIN.NS
  python3 fetch_live_market_data.py --watch-list
  python3 fetch_live_market_data.py --watch-update          # fetch + report changes
  python3 fetch_live_market_data.py --watch-remove SBIN.NS
  python3 fetch_live_market_data.py --watchlist /path/to/state.json --watch-update

The APP_TOKEN is auto-discovered from the platform's frontend/.env.local
(or sync/.app_token). Override with --token.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ---------------------------------------------------------------------------
# Configuration / discovery
# ---------------------------------------------------------------------------

PLATFORM_ANALYZE = "http://localhost:8765/api/v1/analyze"
PLATFORM_DASHBOARD = "http://localhost:3001/api/dashboard"
PLATFORM_OHLCV = "http://localhost:3001/api/ohlcv/{sym}"
PLATFORM_FUNDAMENTALS = "http://localhost:3001/api/fundamentals/{sym}"

# Candidate locations for the shared app token (searched in order).
TOKEN_CANDIDATES = [
    Path("/Users/vijaykumar/projecs /opencode/share/vijaymaruthi/frontend/.env.local"),
    Path("/Users/vijaykumar/projecs /opencode/share/vijaymaruthi/sync/.app_token"),
    Path("/Users/vijaykumar/projecs /opencode/share/vijaymaruthi/sync/.env"),
]

KNOWN_SYMBOLS = [
    "HDFCBANK.NS", "ICICIBANK.NS", "SBIN.NS", "KOTAKBANK.NS", "AXISBANK.NS",
    "RELIANCE.NS", "TCS.NS", "INFY.NS", "TATAMOTORS.NS", "LIKHITHA.NS",
]


def discover_token() -> str | None:
    """Locate the shared APP_TOKEN from known platform files."""
    for path in TOKEN_CANDIDATES:
        try:
            if not path.exists():
                continue
            text = path.read_text(errors="ignore")
            for line in text.splitlines():
                line = line.strip()
                if line.startswith("APP_TOKEN="):
                    val = line.split("=", 1)[1].strip().strip('"').strip("'")
                    if val:
                        return val
                # .app_token files may contain the bare token
                if "=" not in line and len(line) > 20 and not line.startswith("#"):
                    return line
        except Exception:
            continue
    return None


# ---------------------------------------------------------------------------
# HTTP helpers (stdlib only, no extra deps for the platform calls)
# ---------------------------------------------------------------------------

def _http_get(url: str, timeout: float = 15.0) -> dict | list | None:
    import urllib.request
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "vijaymaruthi-fetch/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"    [http] GET {url} -> ERROR: {e}", file=sys.stderr)
        return None


def _http_post(url: str, payload: dict, timeout: float = 60.0) -> dict | None:
    import urllib.request
    try:
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url, data=data, method="POST",
            headers={"Content-Type": "application/json", "User-Agent": "vijaymaruthi-fetch/1.0"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"    [http] POST {url} -> ERROR: {e}", file=sys.stderr)
        return None


# ---------------------------------------------------------------------------
# Platform fetchers
# ---------------------------------------------------------------------------

def fetch_platform_analyze(ticker: str, token: str | None) -> dict | None:
    """Full quantamental snapshot from the FastAPI backend (port 8765)."""
    print(f"  [platform] analyze {ticker} ...", file=sys.stderr)
    return _http_post(PLATFORM_ANALYZE, {"ticker": ticker})


def fetch_platform_dashboard(token: str | None) -> list | None:
    """Screening/context rows (2400+ scored)."""
    url = PLATFORM_DASHBOARD + (f"?token={token}" if token else "")
    print("  [platform] dashboard ...", file=sys.stderr)
    data = _http_get(url)
    if isinstance(data, dict):
        return data.get("rows") or data.get("data") or []
    return data if isinstance(data, list) else None


def fetch_platform_ohlcv(symbol: str, period: str, token: str | None) -> list | None:
    """Raw OHLCV candles from the Next.js frontend (port 3001)."""
    url = PLATFORM_OHLCV.format(sym=symbol) + f"?period={period}" + (f"&token={token}" if token else "")
    print(f"  [platform] ohlcv {symbol} ({period}) ...", file=sys.stderr)
    data = _http_get(url)
    if isinstance(data, dict):
        return data.get("candles") or []
    return None


def fetch_platform_fundamentals(symbol: str, token: str | None) -> dict | None:
    """Normalized fundamentals detail (may 404 for symbols without backfill)."""
    url = PLATFORM_FUNDAMENTALS.format(sym=symbol) + (f"?token={token}" if token else "")
    print(f"  [platform] fundamentals {symbol} ...", file=sys.stderr)
    return _http_get(url)


# ---------------------------------------------------------------------------
# yfinance fetchers (fallback / cross-check)
# ---------------------------------------------------------------------------

def fetch_yfinance(ticker: str, period: str = "1y") -> dict:
    """Fetch quote + OHLCV + fundamentals from yfinance."""
    import yfinance as yf
    print(f"  [yfinance] {ticker} ...", file=sys.stderr)
    result: dict = {"ok": False, "error": None}

    try:
        t = yf.Ticker(ticker)
        info = {}
        try:
            info = t.info or {}
        except Exception as e:
            print(f"    [yfinance] info failed: {e}", file=sys.stderr)

        hist = t.history(period=period, interval="1d", auto_adjust=True)
        candles = []
        if hist is not None and not hist.empty:
            # Flatten MultiIndex columns if present
            if hasattr(hist.columns, "get_level_values"):
                hist.columns = hist.columns.get_level_values(0)
            for idx, row in hist.iterrows():
                try:
                    if any(pd_isna(row.get(c)) for c in ["Open", "High", "Low", "Close", "Volume"]):
                        continue
                    date_str = idx.strftime("%Y-%m-%d") if hasattr(idx, "strftime") else str(idx)[:10]
                    candles.append({
                        "time": date_str,
                        "open": float(row["Open"]),
                        "high": float(row["High"]),
                        "low": float(row["Low"]),
                        "close": float(row["Close"]),
                        "volume": int(row["Volume"]),
                    })
                except Exception:
                    continue

        result.update({
            "ok": True,
            "info": info,
            "candles": candles,
            "candle_count": len(candles),
            "last_close": candles[-1]["close"] if candles else None,
            "last_time": candles[-1]["time"] if candles else None,
        })
    except Exception as e:
        result["error"] = str(e)
        print(f"    [yfinance] ERROR: {e}", file=sys.stderr)
    return result


def fetch_yfinance_derivatives(ticker: str) -> dict:
    """Fetch options chain (OI/IV/Greeks) + futures OI from yfinance.

    Returns a dict with:
      - options: list of expiries, and for the nearest expiry the top call/put
        strikes by open interest with IV + greeks
      - futures: open interest / volume if available (yfinance coverage varies)
    """
    import yfinance as yf
    print(f"  [yfinance] derivatives {ticker} ...", file=sys.stderr)
    result: dict = {"ok": False, "error": None, "options": {}, "futures": {}}
    try:
        t = yf.Ticker(ticker)
        expiries = []
        try:
            expiries = list(t.options or [])
        except Exception as e:
            print(f"    [yfinance] options list failed: {e}", file=sys.stderr)

        result["options"]["expiries"] = expiries

        # Nearest expiry chain — top strikes by OI
        if expiries:
            try:
                chain = t.option_chain(expiries[0])
                calls, puts = chain.calls, chain.puts

                def _top_oi(df, kind):
                    if df is None or df.empty:
                        return []
                    df = df.copy()
                    df = df[df["openInterest"].notna()].sort_values("openInterest", ascending=False)
                    out = []
                    for _, r in df.head(8).iterrows():
                        out.append({
                            "strike": float(r.get("strike")),
                            "openInterest": int(r.get("openInterest") or 0),
                            "volume": int(r.get("volume") or 0),
                            "impliedVolatility": round(float(r.get("impliedVolatility") or 0), 4),
                            "lastPrice": float(r.get("lastPrice") or 0),
                            "delta": round(float(r.get("delta") or 0), 3),
                            "gamma": round(float(r.get("gamma") or 0), 4),
                            "theta": round(float(r.get("theta") or 0), 3),
                            "vega": round(float(r.get("vega") or 0), 3),
                        })
                    return out

                result["options"]["nearest_expiry"] = expiries[0]
                result["options"]["top_calls_by_oi"] = _top_oi(calls, "call")
                result["options"]["top_puts_by_oi"] = _top_oi(puts, "put")
            except Exception as e:
                print(f"    [yfinance] option chain failed: {e}", file=sys.stderr)

        # Futures OI (yfinance coverage is inconsistent; best-effort)
        try:
            fut = t.get_futures_chain() if hasattr(t, "get_futures_chain") else None
            if fut is not None:
                result["futures"]["available"] = True
                result["futures"]["data"] = fut
            else:
                result["futures"]["available"] = False
                result["futures"]["note"] = "Futures chain not exposed by yfinance for this symbol."
        except Exception as e:
            result["futures"]["available"] = False
            result["futures"]["note"] = f"Futures chain unavailable: {e}"

        result["ok"] = True
    except Exception as e:
        result["error"] = str(e)
        print(f"    [yfinance] derivatives ERROR: {e}", file=sys.stderr)
    return result


def fetch_yfinance_intraday(ticker: str, interval: str = "5m", period: str = "1d") -> dict:
    """Fetch intraday OHLCV candles (e.g. 1m/5m/15m/1h) from yfinance."""
    import yfinance as yf
    print(f"  [yfinance] intraday {ticker} ({interval}/{period}) ...", file=sys.stderr)
    result: dict = {"ok": False, "error": None, "candles": [], "candle_count": 0}
    try:
        df = yf.download(ticker, period=period, interval=interval, progress=False, auto_adjust=True)
        if df is not None and not df.empty:
            if hasattr(df.columns, "get_level_values"):
                df.columns = df.columns.get_level_values(0)
            candles = []
            for idx, row in df.iterrows():
                try:
                    if any(pd_isna(row.get(c)) for c in ["Open", "High", "Low", "Close", "Volume"]):
                        continue
                    ts = idx.strftime("%Y-%m-%d %H:%M:%S") if hasattr(idx, "strftime") else str(idx)
                    candles.append({
                        "time": ts,
                        "open": float(row["Open"]),
                        "high": float(row["High"]),
                        "low": float(row["Low"]),
                        "close": float(row["Close"]),
                        "volume": int(row["Volume"]),
                    })
                except Exception:
                    continue
            result["candles"] = candles
            result["candle_count"] = len(candles)
            result["last_close"] = candles[-1]["close"] if candles else None
            result["last_time"] = candles[-1]["time"] if candles else None
            result["ok"] = True
    except Exception as e:
        result["error"] = str(e)
        print(f"    [yfinance] intraday ERROR: {e}", file=sys.stderr)
    return result


def pd_isna(v) -> bool:
    try:
        import pandas as pd
        return bool(pd.isna(v))
    except Exception:
        return v is None


# ---------------------------------------------------------------------------
# Indicator computation (from raw candles — never trust memory)
# ---------------------------------------------------------------------------

def compute_indicators(candles: list[dict]) -> dict:
    """Compute RSI(14), MACD(12,26,9), SMA(20/50/200), ATR(14) from candles."""
    closes = [c["close"] for c in candles]
    highs = [c["high"] for c in candles]
    lows = [c["low"] for c in candles]
    vols = [c["volume"] for c in candles]
    n = len(closes)
    out: dict = {"candle_count": n}

    def sma(values, period):
        if len(values) < period:
            return None
        return sum(values[-period:]) / period

    def ema_series(values, period):
        if not values:
            return []
        k = 2 / (period + 1)
        ema = [values[0]]
        for v in values[1:]:
            ema.append(v * k + ema[-1] * (1 - k))
        return ema

    # SMAs
    out["sma20"] = sma(closes, 20)
    out["sma50"] = sma(closes, 50)
    out["sma200"] = sma(closes, 200)
    last = closes[-1] if closes else None
    out["price"] = last
    out["above_sma20"] = last is not None and out["sma20"] is not None and last > out["sma20"]
    out["above_sma50"] = last is not None and out["sma50"] is not None and last > out["sma50"]
    out["above_sma200"] = last is not None and out["sma200"] is not None and last > out["sma200"]

    # RSI(14) — Wilder's smoothing
    if n > 14:
        gains, losses = [], []
        for i in range(1, n):
            ch = closes[i] - closes[i - 1]
            gains.append(max(ch, 0))
            losses.append(max(-ch, 0))
        avg_gain = sum(gains[:14]) / 14
        avg_loss = sum(losses[:14]) / 14
        for i in range(14, len(gains)):
            avg_gain = (avg_gain * 13 + gains[i]) / 14
            avg_loss = (avg_loss * 13 + losses[i]) / 14
        if avg_loss == 0:
            out["rsi14"] = 100.0
        else:
            rs = avg_gain / avg_loss
            out["rsi14"] = 100 - (100 / (1 + rs))
        out["rsi_status"] = ("Oversold" if out["rsi14"] <= 30
                             else "Overbought" if out["rsi14"] >= 70 else "Neutral")

    # MACD(12,26,9)
    if n > 26:
        ema12 = ema_series(closes, 12)
        ema26 = ema_series(closes, 26)
        macd_line = [a - b for a, b in zip(ema12, ema26)]
        signal = ema_series(macd_line, 9)
        hist = [m - s for m, s in zip(macd_line, signal)]
        out["macd"] = macd_line[-1]
        out["macd_signal"] = signal[-1]
        out["macd_hist"] = hist[-1]
        out["macd_cross"] = ("Bullish" if out["macd"] > out["macd_signal"] else "Bearish")
        out["macd_above_zero"] = out["macd"] > 0

    # ATR(14)
    if n > 14:
        trs = []
        for i in range(1, n):
            tr = max(highs[i] - lows[i],
                     abs(highs[i] - closes[i - 1]),
                     abs(lows[i] - closes[i - 1]))
            trs.append(tr)
        out["atr14"] = sum(trs[-14:]) / 14
        out["atr_pct"] = (out["atr14"] / last * 100) if last else None

    # Volume context
    if len(vols) >= 20:
        avg20 = sum(vols[-20:]) / 20
        out["vol_ratio_vs_20"] = vols[-1] / avg20 if avg20 else None
        out["last_volume"] = vols[-1]
        out["avg_vol_20"] = avg20

    # 52-week range
    if closes:
        out["52w_high"] = max(closes)
        out["52w_low"] = min(closes)
        out["pct_off_high"] = (last / out["52w_high"] - 1) * 100 if out["52w_high"] else None
        out["pct_above_low"] = (last / out["52w_low"] - 1) * 100 if out["52w_low"] else None

    return out


# ---------------------------------------------------------------------------
# Cross-check
# ---------------------------------------------------------------------------

def cross_check(platform_price, yf_price, symbol: str) -> dict:
    """Compare platform vs yfinance price; flag material disagreement."""
    result = {"platform_price": platform_price, "yfinance_price": yf_price}
    if platform_price is None or yf_price is None:
        result["status"] = "partial"
        result["note"] = "One source missing price; using available source."
        return result
    diff_pct = (yf_price - platform_price) / platform_price * 100
    result["diff_pct"] = round(diff_pct, 2)
    if abs(diff_pct) > 1.0:
        result["status"] = "DISAGREE"
        result["note"] = f"Material price disagreement ({diff_pct:+.2f}%) — investigate before relying on either."
    else:
        result["status"] = "agree"
        result["note"] = f"Sources agree within {abs(diff_pct):.2f}%."
    return result


# ---------------------------------------------------------------------------
# Chart generation (OHLCV + indicators -> PNG)
# ---------------------------------------------------------------------------

def generate_chart(candles: list[dict], symbol: str, out_path: str,
                   title: str | None = None) -> dict:
    """Render a candlestick chart with SMA/RSI/MACD/volume to a PNG.

    Uses mplfinance (installed as a dependency). Returns a dict with the
    output path and status. If mplfinance is unavailable, falls back to a
    plain matplotlib line chart so the tool never hard-fails on charts.
    """
    import os
    result: dict = {"ok": False, "path": out_path, "error": None}

    if not candles:
        result["error"] = "No candles to chart."
        return result

    # Ensure the parent directory exists
    try:
        parent = os.path.dirname(os.path.abspath(out_path))
        if parent:
            os.makedirs(parent, exist_ok=True)
    except Exception as e:
        result["error"] = f"Could not create output directory: {e}"
        return result

    try:
        import pandas as pd
        import matplotlib
        matplotlib.use("Agg")  # headless backend
        import matplotlib.pyplot as plt

        df = pd.DataFrame(candles)
        df["time"] = pd.to_datetime(df["time"])
        df = df.set_index("time")
        df = df[["open", "high", "low", "close", "volume"]].astype(float)
        df.columns = ["Open", "High", "Low", "Close", "Volume"]

        # Compute SMAs for overlay
        df["SMA20"] = df["Close"].rolling(20).mean()
        df["SMA50"] = df["Close"].rolling(50).mean()
        df["SMA200"] = df["Close"].rolling(200).mean()

        # RSI(14) for the subplot
        delta = df["Close"].diff()
        gain = delta.clip(lower=0)
        loss = -delta.clip(upper=0)
        avg_gain = gain.ewm(alpha=1 / 14, min_periods=14).mean()
        avg_loss = loss.ewm(alpha=1 / 14, min_periods=14).mean()
        rs = avg_gain / avg_loss
        df["RSI"] = 100 - (100 / (1 + rs))

        # MACD(12,26,9) for the subplot
        ema12 = df["Close"].ewm(span=12, adjust=False).mean()
        ema26 = df["Close"].ewm(span=26, adjust=False).mean()
        df["MACD"] = ema12 - ema26
        df["MACD_signal"] = df["MACD"].ewm(span=9, adjust=False).mean()
        df["MACD_hist"] = df["MACD"] - df["MACD_signal"]

        # Try mplfinance for a proper candlestick chart
        try:
            import mplfinance as mpf
            apds = [
                mpf.make_addplot(df["SMA20"], color="blue", width=1.0),
                mpf.make_addplot(df["SMA50"], color="orange", width=1.0),
                mpf.make_addplot(df["SMA200"], color="purple", width=1.0),
            ]
            # RSI panel
            apds.append(mpf.make_addplot(df["RSI"], panel=2, color="purple", ylabel="RSI"))
            # MACD panel
            apds.append(mpf.make_addplot(df["MACD"], panel=3, color="blue", ylabel="MACD"))
            apds.append(mpf.make_addplot(df["MACD_signal"], panel=3, color="orange"))
            apds.append(mpf.make_addplot(df["MACD_hist"], panel=3, type="bar", color="gray"))

            mpf.plot(
                df[["Open", "High", "Low", "Close", "Volume"]],
                type="candle",
                style="yahoo",
                volume=True,
                addplot=apds,
                panel_ratios=(6, 1, 2, 2),
                title=title or f"{symbol} — OHLCV + Indicators",
                figsize=(14, 9),
                savefig=dict(fname=out_path, dpi=120, bbox_inches="tight"),
                warn_too_much_data=10000,
            )
            result["ok"] = True
            result["engine"] = "mplfinance"
            return result
        except Exception as e:
            # Fallback: plain matplotlib line chart
            print(f"    [chart] mplfinance failed ({e}); using matplotlib fallback", file=sys.stderr)

        fig, axes = plt.subplots(4, 1, figsize=(14, 10), sharex=True,
                                 gridspec_kw={"height_ratios": [6, 1, 2, 2]})
        ax_price, ax_vol, ax_rsi, ax_macd = axes

        ax_price.plot(df.index, df["Close"], color="#1f77b4", lw=1.2, label="Close")
        ax_price.plot(df.index, df["SMA20"], color="blue", lw=0.8, label="SMA20")
        ax_price.plot(df.index, df["SMA50"], color="orange", lw=0.8, label="SMA50")
        ax_price.plot(df.index, df["SMA200"], color="purple", lw=0.8, label="SMA200")
        ax_price.set_title(title or f"{symbol} — OHLCV + Indicators")
        ax_price.legend(loc="upper left", fontsize=8)
        ax_price.grid(alpha=0.3)

        ax_vol.bar(df.index, df["Volume"], color="#888888", width=1.0)
        ax_vol.set_ylabel("Volume")
        ax_vol.grid(alpha=0.3)

        ax_rsi.plot(df.index, df["RSI"], color="purple", lw=1.0)
        ax_rsi.axhline(70, color="red", lw=0.6, ls="--")
        ax_rsi.axhline(30, color="green", lw=0.6, ls="--")
        ax_rsi.set_ylabel("RSI")
        ax_rsi.set_ylim(0, 100)
        ax_rsi.grid(alpha=0.3)

        ax_macd.plot(df.index, df["MACD"], color="blue", lw=1.0, label="MACD")
        ax_macd.plot(df.index, df["MACD_signal"], color="orange", lw=1.0, label="Signal")
        ax_macd.bar(df.index, df["MACD_hist"], color="gray", width=1.0)
        ax_macd.axhline(0, color="black", lw=0.6)
        ax_macd.set_ylabel("MACD")
        ax_macd.legend(loc="upper left", fontsize=8)
        ax_macd.grid(alpha=0.3)

        fig.tight_layout()
        fig.savefig(out_path, dpi=120, bbox_inches="tight")
        plt.close(fig)
        result["ok"] = True
        result["engine"] = "matplotlib"
        return result
    except Exception as e:
        result["error"] = str(e)
        print(f"    [chart] ERROR: {e}", file=sys.stderr)
        return result


# ---------------------------------------------------------------------------
# Watchlist / portfolio tracking
# ---------------------------------------------------------------------------

WATCHLIST_DEFAULT_FILE = Path("/Users/vijaykumar/projecs /opencode/share/.watchlist.json")


def _load_watchlist(path: Path) -> dict:
    """Load the watchlist state file (symbols + last snapshot)."""
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            pass
    return {"symbols": [], "history": {}}


def _save_watchlist(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, default=str))


def watchlist_add(path: Path, symbols: list[str]) -> dict:
    """Add symbols to the watchlist."""
    state = _load_watchlist(path)
    added, existing = [], []
    for s in symbols:
        s = s.strip()
        if not s:
            continue
        if s in state["symbols"]:
            existing.append(s)
        else:
            state["symbols"].append(s)
            added.append(s)
    _save_watchlist(path, state)
    return {"added": added, "existing": existing, "symbols": state["symbols"]}


def watchlist_remove(path: Path, symbols: list[str]) -> dict:
    """Remove symbols from the watchlist."""
    state = _load_watchlist(path)
    removed = [s for s in symbols if s in state["symbols"]]
    state["symbols"] = [s for s in state["symbols"] if s not in symbols]
    _save_watchlist(path, state)
    return {"removed": removed, "symbols": state["symbols"]}


def watchlist_list(path: Path) -> dict:
    """List watchlist symbols and their last-known snapshot."""
    state = _load_watchlist(path)
    return {"symbols": state["symbols"], "history": state.get("history", {})}


def watchlist_update(path: Path, token: str | None, period: str = "1y",
                     with_derivatives: bool = False, with_intraday: bool = False,
                     intraday_interval: str = "5m") -> dict:
    """Fetch fresh data for every watchlist symbol and report changes vs last run."""
    state = _load_watchlist(path)
    symbols = state["symbols"]
    history = state.setdefault("history", {})

    report = {"updated_at_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S"),
              "symbols_checked": len(symbols), "changes": [], "errors": []}

    for sym in symbols:
        try:
            r = run(sym, period, token, with_derivatives=with_derivatives,
                    with_intraday=with_intraday, intraday_interval=intraday_interval)
            price = r["cross_check"].get("platform_price") or r["cross_check"].get("yfinance_price")
            prev = history.get(sym, {})

            change = {
                "symbol": sym,
                "price": price,
                "prev_price": prev.get("price"),
                "signal": r["platform"].get("signal"),
                "prev_signal": prev.get("signal"),
                "tech_score": r["platform"].get("tech_score"),
                "fund_score": r["platform"].get("fund_score"),
                "cross_check": r["cross_check"].get("status"),
            }

            # Compute price change vs previous snapshot
            if prev.get("price") and price:
                change["price_change_pct"] = round((price - prev["price"]) / prev["price"] * 100, 2)
            else:
                change["price_change_pct"] = None

            # Signal change detection
            if prev.get("signal") and prev["signal"] != r["platform"].get("signal"):
                change["signal_changed"] = True
                change["signal_change"] = f"{prev['signal']} -> {r['platform'].get('signal')}"
            else:
                change["signal_changed"] = False

            report["changes"].append(change)

            # Persist this snapshot
            history[sym] = {
                "price": price,
                "signal": r["platform"].get("signal"),
                "tech_score": r["platform"].get("tech_score"),
                "fund_score": r["platform"].get("fund_score"),
                "updated_at_utc": report["updated_at_utc"],
            }
        except Exception as e:
            report["errors"].append({"symbol": sym, "error": str(e)})

    _save_watchlist(path, state)
    return report


def print_watchlist_report(report: dict) -> None:
    print("\n" + "=" * 72)
    print(f"  WATCHLIST UPDATE — {report['updated_at_utc']}  ({report['symbols_checked']} symbols)")
    print("=" * 72)
    for c in report["changes"]:
        sym = c["symbol"]
        price = c["price"]
        prev = c["prev_price"]
        chg = c["price_change_pct"]
        sig = c["signal"]
        sig_flag = ""
        if c.get("signal_changed"):
            sig_flag = f"  ⚠ SIGNAL: {c['signal_change']}"
        chg_str = f"{chg:+.2f}%" if chg is not None else "n/a"
        prev_str = f"{prev}" if prev is not None else "—"
        print(f"  {sym:<16} price {price} (prev {prev_str}, {chg_str})  signal {sig}{sig_flag}")
    if report["errors"]:
        print("\n  ERRORS:")
        for e in report["errors"]:
            print(f"    {e['symbol']}: {e['error']}")
    print("=" * 72 + "\n")


# ---------------------------------------------------------------------------
# Main orchestration
# ---------------------------------------------------------------------------

def run(symbol: str, period: str, token: str | None, verbose: bool = True,
        with_derivatives: bool = False, with_intraday: bool = False,
        intraday_interval: str = "5m", chart_path: str | None = None) -> dict:
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    result: dict = {
        "symbol": symbol,
        "fetched_at_utc": ts,
        "token_found": bool(token),
        "platform": {},
        "yfinance": {},
        "indicators": {},
        "cross_check": {},
    }

    # --- Platform ---
    analyze = fetch_platform_analyze(symbol, token)
    if analyze:
        result["platform"]["analyze"] = analyze
        result["platform"]["signal"] = analyze.get("signal")
        result["platform"]["confidence"] = analyze.get("confidence")
        result["platform"]["price"] = analyze.get("price")
        q = analyze.get("quantamental") or {}
        result["platform"]["tech_signal"] = q.get("technical_signal")
        result["platform"]["tech_score"] = q.get("technical_score")
        result["platform"]["fund_rating"] = q.get("fundamental_rating")
        result["platform"]["fund_score"] = q.get("fundamental_score")
        result["platform"]["blended"] = q.get("blended_rating")
        result["platform"]["blended_score"] = q.get("blended_score")
        result["platform"]["market_structure"] = analyze.get("market_structure")
        result["platform"]["indicators"] = analyze.get("indicators")

    # Dashboard row for this symbol (context / peer comparison)
    rows = fetch_platform_dashboard(token)
    if rows:
        match = next((r for r in rows if r.get("ticker", "").upper() == symbol.upper()), None)
        if match:
            result["platform"]["dashboard_row"] = match

    # Raw candles from platform (may be empty for symbols without backfill)
    platform_candles = fetch_platform_ohlcv(symbol, period, token)
    if platform_candles:
        result["platform"]["candles"] = platform_candles
        result["platform"]["candle_count"] = len(platform_candles)

    # Fundamentals from platform
    fund = fetch_platform_fundamentals(symbol, token)
    if fund:
        result["platform"]["fundamentals"] = fund

    # --- yfinance (fallback / cross-check) ---
    yf_data = fetch_yfinance(symbol, period)
    result["yfinance"] = yf_data

    # --- Optional: derivatives (options OI/IV/Greeks + futures) ---
    if with_derivatives:
        result["derivatives"] = fetch_yfinance_derivatives(symbol)

    # --- Optional: intraday candles ---
    if with_intraday:
        result["intraday"] = fetch_yfinance_intraday(symbol, interval=intraday_interval)

    # --- Indicators from the best available candle set ---
    candles = platform_candles or yf_data.get("candles") or []
    if candles:
        result["indicators"] = compute_indicators(candles)
        result["indicators"]["source"] = "platform" if platform_candles else "yfinance"

    # --- Cross-check price ---
    # Prefer the most live figure from each source:
    #   platform: analyze.price > dashboard.price; yfinance: info.currentPrice > last_close
    platform_price = result["platform"].get("price")
    if platform_price is None:
        dr = result["platform"].get("dashboard_row") or {}
        platform_price = dr.get("price")
    yf_info = yf_data.get("info") or {}
    yf_current = yf_info.get("currentPrice") or yf_info.get("regularMarketPrice")
    yf_price = yf_current or yf_data.get("last_close")
    result["cross_check"] = cross_check(platform_price, yf_price, symbol)
    # record which sub-price was used for transparency
    result["cross_check"]["platform_price_source"] = (
        "analyze" if result["platform"].get("price") else "dashboard"
    )
    result["cross_check"]["yfinance_price_source"] = "info.currentPrice" if yf_current else "last_close"

    # --- Optional: generate chart PNG ---
    if chart_path:
        result["chart"] = generate_chart(candles, symbol, chart_path)

    return result


def print_summary(result: dict) -> None:
    s = result["symbol"]
    print("\n" + "=" * 64)
    print(f"  LIVE MARKET DATA — {s}")
    print(f"  Fetched (UTC): {result['fetched_at_utc']}   Token found: {result['token_found']}")
    print("=" * 64)

    p = result["platform"]
    print("\n[PLATFORM]")
    print(f"  Signal: {p.get('signal')}  (conf {p.get('confidence')})")
    print(f"  Tech:   {p.get('tech_signal')}  score {p.get('tech_score')}")
    print(f"  Fund:   {p.get('fund_rating')}  score {p.get('fund_score')}")
    print(f"  Blended:{p.get('blended')}  score {p.get('blended_score')}")
    print(f"  Price:  {p.get('price')}")
    ms = p.get("market_structure") or {}
    if ms:
        print(f"  Structure: {ms.get('structure')}")
    ind = p.get("indicators") or {}
    rsi = ind.get("rsi") or {}
    if rsi:
        print(f"  RSI: {rsi.get('value')} ({rsi.get('status')})")
    macd = ind.get("macd") or {}
    if macd:
        print(f"  MACD: {macd.get('crossover')} (hist {round(macd.get('histogram', 0), 2)})")

    y = result["yfinance"]
    print("\n[yfinance]")
    print(f"  ok: {y.get('ok')}  candles: {y.get('candle_count')}  last_close: {y.get('last_close')} ({y.get('last_time')})")
    info = y.get("info") or {}
    if info:
        print(f"  currentPrice: {info.get('currentPrice') or info.get('regularMarketPrice')}")
        print(f"  marketCap: {info.get('marketCap')}  beta: {info.get('beta')}")
        print(f"  52w high/low: {info.get('fiftyTwoWeekHigh')} / {info.get('fiftyTwoWeekLow')}")

    ind2 = result["indicators"]
    if ind2:
        print("\n[INDICATORS (computed from candles)]")
        print(f"  source: {ind2.get('source')}  candles: {ind2.get('candle_count')}")
        print(f"  price: {ind2.get('price')}  SMA20: {round(ind2['sma20'],2) if ind2.get('sma20') else None}  SMA50: {round(ind2['sma50'],2) if ind2.get('sma50') else None}  SMA200: {round(ind2['sma200'],2) if ind2.get('sma200') else None}")
        print(f"  RSI14: {round(ind2['rsi14'],2) if ind2.get('rsi14') else None} ({ind2.get('rsi_status')})")
        print(f"  MACD: {round(ind2.get('macd'),2) if ind2.get('macd') is not None else None} / signal {round(ind2.get('macd_signal'),2) if ind2.get('macd_signal') is not None else None} -> {ind2.get('macd_cross')}")
        print(f"  ATR14: {round(ind2.get('atr14'),2) if ind2.get('atr14') else None} ({round(ind2.get('atr_pct'),2) if ind2.get('atr_pct') else None}%)")
        print(f"  52w high/low: {ind2.get('52w_high')} / {ind2.get('52w_low')}  (off high {round(ind2.get('pct_off_high'),1) if ind2.get('pct_off_high') is not None else None}%)")

    cc = result["cross_check"]
    print("\n[CROSS-CHECK]")
    print(f"  platform: {cc.get('platform_price')}  yfinance: {cc.get('yfinance_price')}  -> {cc.get('status')}: {cc.get('note')}")

    # Optional: derivatives
    der = result.get("derivatives")
    if der:
        print("\n[DERIVATIVES]")
        opts = der.get("options") or {}
        exp = opts.get("nearest_expiry")
        print(f"  expiries: {opts.get('expiries')}")
        if exp:
            print(f"  nearest expiry: {exp}")
            calls = opts.get("top_calls_by_oi") or []
            puts = opts.get("top_puts_by_oi") or []
            if calls:
                print("  Top calls by OI:")
                for c in calls:
                    print(f"    {c['strike']}  OI {c['openInterest']}  IV {c['impliedVolatility']}  delta {c['delta']}")
            if puts:
                print("  Top puts by OI:")
                for p in puts:
                    print(f"    {p['strike']}  OI {p['openInterest']}  IV {p['impliedVolatility']}  delta {p['delta']}")
        fut = der.get("futures") or {}
        print(f"  futures available: {fut.get('available')}  {fut.get('note', '')}")

    # Optional: intraday
    intra = result.get("intraday")
    if intra:
        print("\n[INTRADAY]")
        print(f"  candles: {intra.get('candle_count')}  last_close: {intra.get('last_close')} ({intra.get('last_time')})")

    print("=" * 64 + "\n")


def main() -> int:
    ap = argparse.ArgumentParser(description="Fetch live market data from VijayMaruthi platform + yfinance.")
    ap.add_argument("symbol", nargs="?", default="HDFCBANK.NS", help="Ticker, e.g. HDFCBANK.NS (default)")
    ap.add_argument("--period", default="1y", help="OHLCV period (default 1y)")
    ap.add_argument("--token", default=None, help="Override APP_TOKEN")
    ap.add_argument("--json", action="store_true", help="Emit raw JSON to stdout")
    ap.add_argument("--out", default=None, help="Write JSON to a file")
    ap.add_argument("--list-symbols", action="store_true", help="Print known symbols and exit")

    # Batch mode
    ap.add_argument("--batch", nargs="+", metavar="SYM", default=None,
                    help="Fetch multiple symbols at once, e.g. --batch HDFCBANK.NS ICICIBANK.NS SBIN.NS")
    ap.add_argument("--batch-file", default=None,
                    help="File with one symbol per line to fetch in batch")

    # Derivatives / intraday
    ap.add_argument("--derivatives", action="store_true",
                    help="Also fetch options chain (OI/IV/Greeks) + futures OI")
    ap.add_argument("--intraday", action="store_true",
                    help="Also fetch intraday candles")
    ap.add_argument("--intraday-interval", default="5m",
                    help="Intraday interval: 1m/5m/15m/30m/1h (default 5m)")
    ap.add_argument("--intraday-period", default="1d",
                    help="Intraday period: 1d/5d/1mo (default 1d)")

    # Chart generation
    ap.add_argument("--chart", default=None, metavar="PATH",
                    help="Render OHLCV + indicators to a PNG at PATH (e.g. --chart /tmp/hdfc.png)")

    # Watchlist / portfolio mode
    ap.add_argument("--watchlist", default=None, metavar="FILE",
                    help="Watchlist state file (default .watchlist.json in the tool dir)")
    ap.add_argument("--watch-add", nargs="+", metavar="SYM", default=None,
                    help="Add symbols to the watchlist, e.g. --watch-add HDFCBANK.NS ICICIBANK.NS")
    ap.add_argument("--watch-remove", nargs="+", metavar="SYM", default=None,
                    help="Remove symbols from the watchlist")
    ap.add_argument("--watch-list", action="store_true",
                    help="List watchlist symbols and last-known snapshots")
    ap.add_argument("--watch-update", action="store_true",
                    help="Fetch fresh data for all watchlist symbols and report changes")
    args = ap.parse_args()

    if args.list_symbols:
        print("\n".join(KNOWN_SYMBOLS))
        return 0

    token = args.token or discover_token()
    if not token:
        print("WARNING: APP_TOKEN not found — platform routes may return Unauthorized.", file=sys.stderr)

    # --- Watchlist mode ---
    watch_file = Path(args.watchlist) if args.watchlist else WATCHLIST_DEFAULT_FILE
    if args.watch_add:
        res = watchlist_add(watch_file, args.watch_add)
        print(f"Added: {res['added']}  (already present: {res['existing']})")
        print(f"Watchlist now: {res['symbols']}")
        return 0
    if args.watch_remove:
        res = watchlist_remove(watch_file, args.watch_remove)
        print(f"Removed: {res['removed']}")
        print(f"Watchlist now: {res['symbols']}")
        return 0
    if args.watch_list:
        res = watchlist_list(watch_file)
        print(f"Watchlist ({len(res['symbols'])} symbols): {res['symbols']}")
        for sym, snap in (res.get("history") or {}).items():
            print(f"  {sym:<16} price {snap.get('price')}  signal {snap.get('signal')}  "
                  f"tech {snap.get('tech_score')}  fund {snap.get('fund_score')}  "
                  f"updated {snap.get('updated_at_utc')}")
        return 0
    if args.watch_update:
        report = watchlist_update(watch_file, token, args.period,
                                  with_derivatives=args.derivatives,
                                  with_intraday=args.intraday,
                                  intraday_interval=args.intraday_interval)
        if not args.json:
            print_watchlist_report(report)
        if args.json:
            print(json.dumps(report, indent=2, default=str))
        if args.out:
            Path(args.out).write_text(json.dumps(report, indent=2, default=str))
            print(f"Wrote JSON to {args.out}")
        return 0

    # --- Resolve the symbol list (single, --batch, or --batch-file) ---
    symbols: list[str] = []
    if args.batch:
        symbols = args.batch
    elif args.batch_file:
        try:
            symbols = [ln.strip() for ln in Path(args.batch_file).read_text().splitlines()
                       if ln.strip() and not ln.strip().startswith("#")]
        except Exception as e:
            print(f"ERROR reading batch file: {e}", file=sys.stderr)
            return 1
    else:
        symbols = [args.symbol]

    # --- Fetch each symbol ---
    results = []
    for sym in symbols:
        print(f"\n>>> Fetching {sym} ...", file=sys.stderr)
        # Default chart path if --chart given without a path for a single symbol
        chart_path = args.chart
        if chart_path and len(symbols) > 1:
            # For batch, derive per-symbol chart path from a directory or pattern
            p = Path(chart_path)
            if p.suffix:  # user gave a file path -> use as-is (last wins) or dir
                chart_path = str(p.parent / f"{sym.replace('.', '_')}{p.suffix}")
            else:
                chart_path = str(p / f"{sym.replace('.', '_')}.png")
        r = run(sym, args.period, token,
                with_derivatives=args.derivatives,
                with_intraday=args.intraday,
                intraday_interval=args.intraday_interval,
                chart_path=chart_path)
        results.append(r)
        if not args.json:
            print_summary(r)
            if chart_path and r.get("chart"):
                print(f"  [chart] saved: {r['chart'].get('path')} (engine {r['chart'].get('engine')})")

    # --- Output ---
    if len(results) == 1:
        payload = results[0]
    else:
        payload = {"batch": True, "count": len(results), "results": results}

    if args.json:
        print(json.dumps(payload, indent=2, default=str))

    if args.out:
        Path(args.out).write_text(json.dumps(payload, indent=2, default=str))
        print(f"Wrote JSON to {args.out}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
