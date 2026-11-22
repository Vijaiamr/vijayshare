"""Backtest — replay the exact temporal boundary per day with SimulationClock.

Two entry modes:

- ``days=N`` (backward compat): replay the last N trading dates present in
  ``market_daily`` (old behavior).
- date range: replay every trading date D in ``[start, end]`` (default: the
  last ``years`` calendar years ending today). When ``start`` is given and
  ``end`` is omitted, ``end`` = Dec 31 of ``start.year + years - 1``
  (e.g. start 2000-01-01, years 5 → end 2004-12-31).

For each trading date D:
- simulate morning at D 09:00 (features as_of D-1 16:00, predict);
- simulate evening at D 16:00 (validate with the D close bar).

Pattern gating (no force-fit): predictions are only made when a deterministic
pattern fires (``allow_skip=True``). Skipped days are counted. Validated
pattern outcomes accumulate in ``pattern_stats`` and are promoted into
versioned knowledge at the end via ``promote_pattern_knowledge``.

Performance: indicator series are precomputed ONCE per symbol (vectorized
pandas) and sliced per day — ``build_features`` is never called per day, which
keeps a 5-year × 11-symbol replay fast.

The temporal boundary is enforced in code: an assertion verifies that every
feature set used for a D prediction has ``last_date < D`` (i.e. only bars with
``available_at <= D-1 16:00``).
"""

from __future__ import annotations

import sqlite3
from datetime import date, timedelta
from typing import Any

import pandas as pd

from .. import config
from ..clock import SimulationClock, ist_now, morning_data_as_of, predict_at
from ..learning.knowledge import (
    current_knowledge,
    negative_patterns,
    positive_symbols,
    promote_pattern_knowledge,
    update_pattern_stats,
)
from ..market.features import MIN_BARS
from ..market.fetch import ensure_daily, ensure_daily_range
from ..market.indicators import adx, atr, bollinger, ema, macd, rsi, sma, volume_sma
from ..market.regime import HIGH_VOL_ATR_PCT, ADX_TREND_THRESHOLD
from ..prediction.engine import predict_symbol
from ..validation.engine import confidence_bucket, validate_predictions
from .morning import _model_for
from .runs import active_symbols, begin_run, finish_run

MIN_BARS_FOR_BACKTEST = 100
WARMUP_DAYS = 60


# ── Date helpers ────────────────────────────────────────────────────────────

def _trading_dates(conn: sqlite3.Connection) -> list[date]:
    rows = conn.execute("SELECT DISTINCT date FROM market_daily ORDER BY date").fetchall()
    return [date.fromisoformat(r["date"]) for r in rows]


def _trading_dates_in_range(
    conn: sqlite3.Connection, start: date, end: date
) -> list[date]:
    rows = conn.execute(
        """SELECT DISTINCT date FROM market_daily
           WHERE date >= ? AND date <= ? ORDER BY date""",
        (start.isoformat(), end.isoformat()),
    ).fetchall()
    return [date.fromisoformat(r["date"]) for r in rows]


def _resolve_range(
    start: str | date | None,
    end: str | date | None,
    years: int | None,
) -> tuple[date, date]:
    """Resolve the backtest window from CLI-style arguments.

    - ``start`` omitted → ``today - years`` (approximate); ``end`` omitted → today.
    - ``start`` given, ``end`` omitted → ``end`` = Dec 31 of
      ``start.year + years - 1`` (e.g. 2000-01-01 + 5 years → 2004-12-31).
    - both given → used as-is (``years`` ignored).
    """
    if years is None:
        years = 5
    today = ist_now().date()
    if start is None:
        start_d = today - timedelta(days=365 * years)
        end_d = end if end is not None else today
    else:
        start_d = date.fromisoformat(str(start))
        if end is None:
            end_d = date(start_d.year + years - 1, 12, 31)
        else:
            end_d = date.fromisoformat(str(end))
    if isinstance(end_d, str):
        end_d = date.fromisoformat(end_d)
    if start_d > end_d:
        raise ValueError(f"backtest start {start_d} is after end {end_d}")
    return start_d, end_d


# ── Precomputed indicator frame ─────────────────────────────────────────────

def _regime_series(df: pd.DataFrame) -> pd.Series:
    """Vectorized per-row regime classification matching ``classify_regime``.

    Replicates ``market/regime.py`` logic for every row of ``df`` so the
    backtest can slice a precomputed regime column instead of re-classifying
    per day.
    """
    close = df["close"]
    n = pd.Series(range(1, len(df) + 1), index=df.index)
    atr14 = atr(df, 14)
    atr_pct = atr14 / close * 100.0
    atr_pct = atr_pct.where(n >= 15, 0.0)  # classify_regime guards n >= 15

    sma20 = sma(close, 20)
    sma50 = sma(close, 50)
    adx14 = adx(df, 14)
    slope20 = sma20.pct_change(5) * 100.0

    regime = pd.Series("range", index=df.index, dtype=object)
    regime[atr_pct > HIGH_VOL_ATR_PCT] = "high_volatility"

    valid = sma20.notna() & sma50.notna() & adx14.notna()
    trend_up = valid & (sma20 > sma50) & (slope20 > 0.0) & (adx14 >= ADX_TREND_THRESHOLD)
    trend_down = valid & (sma20 < sma50) & (slope20 < 0.0) & (adx14 >= ADX_TREND_THRESHOLD)
    regime[trend_up] = "trend_up"
    regime[trend_down] = "trend_down"

    # Fallback when SMA50/ADX are unavailable (< 50 bars).
    fb_up = sma20.notna() & (close > sma20) & (slope20 > 0.0)
    fb_down = sma20.notna() & (close < sma20) & (slope20 < 0.0)
    regime[fb_up & ~trend_up & ~trend_down] = "trend_up"
    regime[fb_down & ~trend_up & ~trend_down] = "trend_down"
    return regime


def _precompute_symbol(
    conn: sqlite3.Connection, symbol: str, end: date
) -> pd.DataFrame | None:
    """Load all bars for ``symbol`` (up to ``end``) and compute indicators once.

    Returns a DataFrame indexed by date with raw OHLCV plus every indicator
    column used by the pattern gate and the LLM prompt. ``None`` when the
    symbol has no bars.
    """
    rows = conn.execute(
        """SELECT date, open, high, low, close, volume, available_at
           FROM market_daily
           WHERE symbol = ? AND date <= ?
           ORDER BY date""",
        (symbol, end.isoformat()),
    ).fetchall()
    if not rows:
        return None
    df = pd.DataFrame([dict(r) for r in rows])
    df = df.drop_duplicates(subset="date", keep="last")
    df["date"] = pd.to_datetime(df["date"])
    df = df.set_index("date")

    close = df["close"]
    df["sma20"] = sma(close, 20)
    df["sma50"] = sma(close, 50)
    df["ema12"] = ema(close, 12)
    df["ema26"] = ema(close, 26)
    df["rsi14"] = rsi(close, 14)
    macd_df = macd(close)
    df["macd"] = macd_df["macd"]
    df["macd_signal"] = macd_df["signal"]
    df["macd_hist"] = macd_df["hist"]
    df["atr"] = atr(df, 14)
    df["atr_pct"] = df["atr"] / close * 100.0
    df["adx"] = adx(df, 14)
    boll = bollinger(close, 20)
    df["bollinger_upper"] = boll["upper"]
    df["bollinger_mid"] = boll["mid"]
    df["bollinger_lower"] = boll["lower"]
    df["volume_sma20"] = volume_sma(df["volume"], 20)
    df["high_20"] = df["high"].rolling(20, min_periods=20).max()
    df["low_20"] = df["low"].rolling(20, min_periods=20).min()
    df["prev_close"] = close.shift(1)
    df["return_1d"] = close.pct_change(1) * 100.0
    df["return_5d"] = close.pct_change(5) * 100.0
    df["return_10d"] = close.pct_change(10) * 100.0
    df["return_20d"] = close.pct_change(20) * 100.0
    df["regime"] = _regime_series(df)
    return df


def _f(value: Any) -> float | None:
    """Float of a scalar, or None when NaN."""
    if value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return None if pd.isna(v) else v


def _features_from_slice(
    symbol: str, before: pd.DataFrame, as_of_iso: str
) -> dict[str, Any]:
    """Build a features dict from the last row of a precomputed slice.

    ``before`` is the precomputed frame sliced to dates strictly before the
    run date D (i.e. bars observable at D-1 16:00 IST). Mirrors the keys of
    ``build_features`` so the pattern gate and LLM prompt work unchanged.
    """
    row = before.iloc[-1]
    close = float(row["close"])
    return {
        "ok": True,
        "symbol": symbol,
        "as_of": as_of_iso,
        "bars": len(before),
        "last_date": str(row.name.date()),
        "last_close": close,
        "prev_close": _f(row.get("prev_close")) or close,
        "return_1d": _f(row.get("return_1d")),
        "return_5d": _f(row.get("return_5d")),
        "return_10d": _f(row.get("return_10d")),
        "return_20d": _f(row.get("return_20d")),
        "sma20": _f(row.get("sma20")),
        "sma50": _f(row.get("sma50")),
        "ema12": _f(row.get("ema12")),
        "ema26": _f(row.get("ema26")),
        "rsi14": _f(row.get("rsi14")),
        "macd": _f(row.get("macd")),
        "macd_signal": _f(row.get("macd_signal")),
        "macd_hist": _f(row.get("macd_hist")),
        "atr": _f(row.get("atr")),
        "atr_pct": _f(row.get("atr_pct")),
        "adx": _f(row.get("adx")),
        "bollinger_upper": _f(row.get("bollinger_upper")),
        "bollinger_mid": _f(row.get("bollinger_mid")),
        "bollinger_lower": _f(row.get("bollinger_lower")),
        "volume_sma20": _f(row.get("volume_sma20")),
        "last_volume": int(row["volume"]),
        "high_20": _f(row.get("high_20")),
        "low_20": _f(row.get("low_20")),
        "regime": str(row.get("regime", "range")),
        "recent_closes": [float(c) for c in before["close"].iloc[-10:].tolist()],
    }


# ── Backtest ────────────────────────────────────────────────────────────────

def run_backtest(
    conn: sqlite3.Connection,
    *,
    start: str | date | None = None,
    end: str | date | None = None,
    years: int | None = 5,
    days: int | None = None,
    mode: str = "baseline",
    validate_mode: str = "deterministic",
    llm_client: Any = None,
    min_bars: int = 100,
) -> dict[str, Any]:
    """Replay trading days with the exact temporal boundary and return a summary.

    ``days`` (backward compat): replay the last ``days`` trading dates.
    Otherwise replay every trading date in ``[start, end]`` (default: last
    ``years`` calendar years). Predictions are pattern-gated (``allow_skip``),
    validated deterministically (or by the validator agent), and pattern
    outcomes accumulate into ``pattern_stats`` + knowledge.

    Returns an aggregate summary with per-symbol coverage, per-pattern stats,
    knowledge promotion counts, and per-day results.
    """
    symbols = active_symbols(conn)
    if not symbols:
        raise ValueError("no active symbols to backtest")

    # ── Resolve window + ensure data ────────────────────────────────────────
    if days is not None and start is None and end is None:
        # Backward-compat path: last N trading dates.
        for symbol in symbols:
            ensure_daily(conn, symbol, ist_now(), min_bars=MIN_BARS_FOR_BACKTEST)
        dates = _trading_dates(conn)
        if len(dates) < days + 30:
            raise ValueError(
                f"not enough trading dates for backtest: need >= {days + 30}, "
                f"have {len(dates)}"
            )
        run_dates = dates[-days:]
        start_d, end_d = run_dates[0], run_dates[-1]
    else:
        start_d, end_d = _resolve_range(start, end, years)
        fetch_start = start_d - timedelta(days=WARMUP_DAYS)
        for symbol in symbols:
            ensure_daily_range(conn, symbol, fetch_start, end_d)
        run_dates = _trading_dates_in_range(conn, start_d, end_d)
        if not run_dates:
            raise ValueError(
                f"no trading dates in range [{start_d}, {end_d}] for backtest"
            )

    # ── Precompute indicator series ONCE per symbol ─────────────────────────
    precomputed: dict[str, pd.DataFrame | None] = {}
    for symbol in symbols:
        precomputed[symbol] = _precompute_symbol(conn, symbol, end_d)

    kv = current_knowledge(conn)
    prompt_version = config.PROMPT_VERSION
    knowledge_version = kv["knowledge_version"]
    knowledge_hash = kv["knowledge_hash"]
    # Knowledge gate: compute the negative (symbol, pattern) set ONCE so the
    # per-day loop never re-queries the DB (2,000 symbols × 1,200 days).
    neg_patterns = negative_patterns(conn, knowledge_hash)
    # v3 gates: symbol gate (positive-knowledge symbols only) + pattern gate
    # (globally negative-expectancy patterns) + direction gate (down-only).
    pos_symbols = positive_symbols(conn, knowledge_hash) if config.SYMBOL_GATE else None
    suppress_patterns = set(config.SUPPRESS_PATTERNS) if config.SUPPRESS_PATTERNS else None
    direction_gate = config.DIRECTION_GATE or None
    model = _model_for(mode, llm_client)

    clock = SimulationClock()
    results: list[dict[str, Any]] = []
    preds_by_day: dict[str, list[dict]] = {}
    skipped_by_symbol: dict[str, int] = {s: 0 for s in symbols}
    validation_by_pred_id: dict[int, dict[str, Any]] = {}

    # ── Recursive per-day loop ──────────────────────────────────────────────
    for D in run_dates:
        clock.set(predict_at(D))
        run_id = begin_run(conn, "backtest", D, predict_at(D), force=True)
        if run_id is None:  # pragma: no cover - force=True always returns an id
            continue

        preds: list[dict] = []
        skipped = 0
        for symbol in symbols:
            pre = precomputed.get(symbol)
            if pre is None or len(pre) < min_bars:
                continue  # symbol lacks enough history for this backtest
            before = pre[pre.index < pd.Timestamp(D)]
            if len(before) < MIN_BARS:
                continue  # not enough warmup bars for features on this day
            features = _features_from_slice(
                symbol, before, morning_data_as_of(D).isoformat()
            )
            # Temporal boundary enforcement: no D bars in a D prediction.
            assert features["last_date"] < D.isoformat(), (
                f"future leakage: {symbol} features for {D} include "
                f"{features['last_date']}"
            )
            pred = predict_symbol(
                conn,
                symbol,
                D,
                features,
                llm_client,
                prompt_version,
                None,
                knowledge_version,
                knowledge_hash,
                model,
                mode=mode,
                daily_run_id=run_id,
                allow_skip=True,
                neg_patterns=neg_patterns,
                pos_symbols=pos_symbols,
                suppress_patterns=suppress_patterns,
                direction_gate=direction_gate,
            )
            if pred is None:
                skipped += 1
                skipped_by_symbol[symbol] += 1
            else:
                preds.append(pred)

        market_rows: dict[str, dict[str, Any]] = {}
        for symbol in symbols:
            row = conn.execute(
                """SELECT * FROM market_daily
                   WHERE symbol = ? AND date = ?
                   ORDER BY data_version DESC LIMIT 1""",
                (symbol, D.isoformat()),
            ).fetchone()
            if row:
                market_rows[symbol] = dict(row)

        summary = validate_predictions(
            conn,
            D,
            market_rows,
            mode=validate_mode,
            llm_client=llm_client,
            daily_run_id=run_id,
        )

        # Accumulate validation results (only for THIS run's predictions).
        for p in preds:
            v = conn.execute(
                "SELECT * FROM validation WHERE prediction_id = ?", (p["id"],)
            ).fetchone()
            if v:
                vdict = dict(v)
                validation_by_pred_id[p["id"]] = vdict
                # Update pattern stats only for predictions with a pattern.
                pattern = p.get("pattern")
                if pattern:
                    update_pattern_stats(conn, p["symbol"], pattern, vdict["hit"])

        prompt_hash = preds[0]["prompt_hash"] if preds else ""
        finish_run(
            conn,
            run_id,
            status="completed",
            prompt_version=prompt_version,
            prompt_hash=prompt_hash,
            knowledge_version=knowledge_version,
            knowledge_hash=knowledge_hash,
            model=model,
        )
        preds_by_day[D.isoformat()] = preds
        results.append(
            {
                "run_date": D.isoformat(),
                "run_id": run_id,
                "predictions": len(preds),
                "skipped": skipped,
                "validation": summary,
            }
        )

    # ── Promote accumulated pattern knowledge ───────────────────────────────
    knowledge = promote_pattern_knowledge(conn, min_obs=config.KNOWLEDGE_MIN_OBS)

    # ── Aggregate ───────────────────────────────────────────────────────────
    all_preds: list[dict] = []
    for D_str in sorted(preds_by_day):
        all_preds.extend(preds_by_day[D_str])

    hits = sum(1 for p in all_preds if validation_by_pred_id.get(p["id"], {}).get("hit"))
    skipped_total = sum(skipped_by_symbol.values())

    per_direction: dict[str, dict[str, Any]] = {}
    calibration: dict[str, dict[str, Any]] = {}
    for p in all_preds:
        v = validation_by_pred_id.get(p["id"])
        d = per_direction.setdefault(p["direction"], {"n": 0, "hits": 0})
        d["n"] += 1
        if v and v["hit"]:
            d["hits"] += 1
        if v:
            bucket = confidence_bucket(p["confidence"])
            c = calibration.setdefault(bucket, {"n": 0, "hits": 0})
            c["n"] += 1
            c["hits"] += v["hit"]
    for d in per_direction.values():
        d["hit_rate"] = round(d["hits"] / d["n"], 4) if d["n"] else 0.0
    for c in calibration.values():
        c["hit_rate"] = round(c["hits"] / c["n"], 4) if c["n"] else 0.0

    per_symbol: dict[str, dict[str, Any]] = {}
    for symbol in symbols:
        pre = precomputed.get(symbol)
        info: dict[str, Any] = {
            "first_date": str(pre.index[0].date()) if pre is not None and len(pre) else None,
            "last_date": str(pre.index[-1].date()) if pre is not None and len(pre) else None,
            "bars": len(pre) if pre is not None else 0,
            "predictions": 0,
            "hits": 0,
            "hit_rate": 0.0,
            "skipped": skipped_by_symbol.get(symbol, 0),
        }
        for p in all_preds:
            if p["symbol"] != symbol:
                continue
            info["predictions"] += 1
            v = validation_by_pred_id.get(p["id"])
            if v and v["hit"]:
                info["hits"] += 1
        info["hit_rate"] = (
            round(info["hits"] / info["predictions"], 4) if info["predictions"] else 0.0
        )
        per_symbol[symbol] = info

    patterns: dict[str, dict[str, Any]] = {}
    for p in all_preds:
        pattern = p.get("pattern")
        if not pattern:
            continue
        v = validation_by_pred_id.get(p["id"])
        ps = patterns.setdefault(pattern, {"n": 0, "hits": 0})
        ps["n"] += 1
        if v and v["hit"]:
            ps["hits"] += 1
    for ps in patterns.values():
        ps["hit_rate"] = round(ps["hits"] / ps["n"], 4) if ps["n"] else 0.0

    return {
        "days": len(run_dates),
        "start": start_d.isoformat(),
        "end": end_d.isoformat(),
        "run_dates": [d.isoformat() for d in run_dates],
        "predictions": len(all_preds),
        "prediction_list": all_preds,
        "hits": hits,
        "hit_rate": round(hits / len(all_preds), 4) if all_preds else 0.0,
        "skipped": skipped_total,
        "per_direction": per_direction,
        "calibration": calibration,
        "per_symbol": per_symbol,
        "patterns": patterns,
        "knowledge": knowledge,
        "results": results,
    }