"""
quantamental_backtester.py — Lookahead-free historical validation of quantamental signals.

METHODOLOGY (v2 — point-in-time, no lookahead):
  1. For each ticker, download N years of daily OHLCV ONCE.
  2. Every `rebalance_days` trading days (default 20), inject the SLICE of data
     up to that date (df.iloc[:i+1]) into TechnicalAnalysisPipeline via
     df_override — the engine can only see the past, never the future.
  3. Record the quantamental rating (Strong Buy … Strong Sell) + scores.
  4. Compute forward outcomes AFTER the signal date:
       - fwd_ret_20d : close-to-close return over the next 20 trading days
       - mae_20d     : max adverse excursion = worst LOW touched within the
                       next 20 sessions vs signal close (tail-risk measure)
  5. Aggregate per rating bucket AND an unconditional BASELINE row
     (all signals, any rating) so results can be compared against the
     universe base rate.

  KEY QUESTION ANSWERED:
    "If the app shows green / Strong Buy, how often does the stock fall
     more than -X% (default -10%) within one month?"

KNOWN LIMITATIONS (documented honestly):
  - Pivot-based S/R (window=5) may use up to 5 future bars for pivot
    confirmation → micro-lookahead of ≤5 days inside structure detection.
  - Fundamentals & sentiment pillars are DISABLED during backtests because
    yfinance only provides current-day snapshots (would leak future info).
    Blended ratings therefore lean on the technical pillar with a neutral
    fundamental anchor.
  - Forward returns assume frictionless fills at close prices (no slippage,
    costs, or liquidity constraints).
  - Survivorship bias: today's ticker list excludes names delisted before now.

USAGE:
    # Smoke test (20 tickers)
    python3 quantamental_backtester.py --limit 20 --workers 8

    # Full universe overnight run (resumable)
    python3 quantamental_backtester.py --universe-file nse_universe.txt \
        --workers 8 --out validation_results/quantamental_bt --resume

OUTPUT (in --out dir):
    signals.jsonl  checkpoint — one line per completed ticker (resume-safe)
    signals.csv    flattened every signal + forward outcome
    summary.json   aggregated metrics per rating bucket + baseline
    REPORT.md      human-readable verdict table
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

RATING_ORDER = ("Strong Buy", "Buy", "Hold", "Sell", "Strong Sell")


# ── Data models ───────────────────────────────────────────────────────────

@dataclass
class BTSignal:
    """One point-in-time signal decision + its forward outcome."""
    ticker: str
    date: str                          # ISO date of signal (as-of date)
    price: float                       # Close at signal date
    tech_signal: str                   # BUY / HOLD / SELL variants
    tech_confidence: float             # 0-100
    qm_rating: str                     # Strong Buy … Strong Sell
    qm_score: float                    # 0-100 blended
    fwd_ret_20d: Optional[float] = None   # % close-to-close over horizon
    mae_20d: Optional[float] = None       # % worst low within horizon (negative = drawdown)
    bars_used: int = 0                    # forward bars actually available
    # Confluence confirmation gate (2026-09-05): how many of 4 independent
    # signals confirmed the BUY, and the RAW technical signal from
    # _classify_signal (before quantamental blend + gate). The gate's effect
    # is measured on technical BUYs: confirm>=3 (gated) vs confirm<3
    # (rejected). In backtest mode the blend caps most BUYs to HOLD, so the
    # final signal alone cannot show the gate's filtering power.
    confirm_count: Optional[int] = None
    technical_signal: Optional[str] = None
    # Regime condition (point-in-time): close above its own 200-day MA at the
    # signal date. Tests whether the confluence gate should only apply in
    # longer-term uptrends (2026-09-05: 10y backtest showed the gate only
    # helps in the 2023-26 bull regime and hurts in 2016-2022).
    close_above_ma200: Optional[bool] = None
    # Weighted convolution (2026-09-05): the technical convolution score
    # (0-100) and whether the weighted pattern vote is bullish. CONV BUY =
    # technical_signal == 'BUY' AND conv_tech_score >= TECH_BUY_MIN AND
    # pattern_majority. This replaces the flat confirm_count gate.
    conv_tech_score: Optional[float] = None
    conv_pattern_majority: Optional[bool] = None
    conv_fund_score: Optional[float] = None


@dataclass
class BucketStats:
    """Aggregated stats for one rating bucket (or BASELINE)."""
    group: str
    count: int = 0
    win_rate_pct: float = 0.0          # share of fwd_ret_20d > 0
    avg_ret: float = 0.0
    median_ret: float = 0.0
    p_below_tail_close: float = 0.0    # P(fwd_ret_20d < tail_threshold)
    p_below_tail_mae: float = 0.0      # P(mae_20d < tail_threshold) — touched -X% anytime
    worst_ret: float = 0.0
    worst_mae: float = 0.0
    ret_std: float = 0.0


# ── Core backtester ───────────────────────────────────────────────────────

class TickerBacktester:
    """Run point-in-time quantamental signals for ONE ticker."""

    def __init__(self, ticker: str, years: int = 5, rebalance_days: int = 20,
                 horizon: int = 20, min_data_days: int = 252):
        self.ticker = ticker.upper()
        self.years = years
        self.rebalance_days = rebalance_days
        self.horizon = horizon
        self.min_data_days = min_data_days
        self.df: Optional[pd.DataFrame] = None

    def _fetch(self) -> pd.DataFrame:
        import yfinance as yf
        df = yf.download(self.ticker, period=f"{self.years}y",
                         progress=False, auto_adjust=True)
        if df is None or df.empty:
            raise ValueError(f"no data for {self.ticker}")
        if isinstance(df.columns, pd.MultiIndex):
            df.columns = ['_'.join(c).strip() for c in df.columns.values]
            rename = {}
            for col in df.columns:
                for base in ('Open', 'High', 'Low', 'Close', 'Volume'):
                    if col.lower().startswith(base.lower()):
                        rename[col] = base
                        break
            df = df.rename(columns=rename)
            df = df[[c for c in ('Open', 'High', 'Low', 'Close', 'Volume') if c in df.columns]]
        return df

    def run(self) -> List[BTSignal]:
        from technical_analysis_report import TechnicalAnalysisPipeline

        self.df = self._fetch()
        n = len(self.df)
        if n < self.min_data_days + self.horizon:
            log.info("%s: insufficient history (%d bars) — skipped", self.ticker, n)
            return []

        closes = self.df['Close'].values
        lows = self.df['Low'].values
        dates = self.df.index

        signals: List[BTSignal] = []
        for idx in range(self.min_data_days, n - 1, self.rebalance_days):
            try:
                # ── Point-in-time slice: engine sees ONLY bars ≤ idx ──
                hist = self.df.iloc[:idx + 1]
                pipeline = TechnicalAnalysisPipeline(
                    self.ticker, period=f"{self.years}y",
                    do_options=False, do_wyckoff=True, do_gann=True,
                    do_sentiment=False, do_db=False,
                    do_fundamentals=False,          # no point-in-time fundamentals
                    df_override=hist,
                )
                result = pipeline.run()
                if not result or not getattr(result, 'quantamental', None):
                    continue
                qm = result.quantamental

                sig = BTSignal(
                    ticker=self.ticker,
                    date=dates[idx].strftime('%Y-%m-%d'),
                    price=round(float(closes[idx]), 4),
                    tech_signal=str(result.signal),
                    tech_confidence=float(result.confidence),
                    qm_rating=str(qm.get('blended_rating', 'Hold')),
                    qm_score=float(qm.get('blended_score', 50)),
                    confirm_count=getattr(result, 'confirm_count', None),
                    technical_signal=getattr(result, 'technical_signal', None),
                    close_above_ma200=bool(closes[idx] > float(closes[max(0, idx - 199):idx + 1].mean())),
                    conv_tech_score=(getattr(result, 'conv_technical', {}) or {}).get('score'),
                    conv_pattern_majority=(getattr(result, 'conv_technical', {}) or {}).get('pattern_majority'),
                    conv_fund_score=(getattr(result, 'conv_fundamental', {}) or {}).get('score'),
                )

                # ── Forward outcome (uses ONLY bars > idx) ──
                end = min(idx + self.horizon, n - 1)
                bars = end - idx
                if bars >= max(5, self.horizon // 2):   # need meaningful window
                    sig.fwd_ret_20d = round((closes[end] / closes[idx] - 1) * 100, 3)
                    sig.mae_20d = round((float(np.min(lows[idx + 1:end + 1])) / closes[idx] - 1) * 100, 3)
                    sig.bars_used = bars
                signals.append(sig)
            except Exception as exc:
                log.debug("%s @ %s failed: %s", self.ticker, dates[idx].date(), exc)
                continue
        return signals


# ── Aggregation ───────────────────────────────────────────────────────────

def aggregate(signals: List[BTSignal], tail_threshold: float) -> Dict[str, BucketStats]:
    def stats_for(group: str, subset: List[BTSignal]) -> BucketStats:
        rets = [s.fwd_ret_20d for s in subset if s.fwd_ret_20d is not None]
        maes = [s.mae_20d for s in subset if s.mae_20d is not None]
        b = BucketStats(group=group, count=len(subset))
        if rets:
            arr = np.array(rets)
            b.win_rate_pct = round(float((arr > 0).mean() * 100), 1)
            b.avg_ret = round(float(arr.mean()), 2)
            b.median_ret = round(float(np.median(arr)), 2)
            b.p_below_tail_close = round(float((arr < tail_threshold).mean() * 100), 1)
            b.worst_ret = round(float(arr.min()), 2)
            b.ret_std = round(float(arr.std()), 2)
        if maes:
            m = np.array(maes)
            b.p_below_tail_mae = round(float((m < tail_threshold).mean() * 100), 1)
            b.worst_mae = round(float(m.min()), 2)
        return b

    out: Dict[str, BucketStats] = {}
    for rating in RATING_ORDER:
        subset = [s for s in signals if s.qm_rating == rating]
        if subset:
            out[rating] = stats_for(rating, subset)
    long_subset = [s for s in signals if s.qm_rating in ('Strong Buy', 'Buy')]
    if long_subset:
        out['LONG (Buy+StrongBuy)'] = stats_for('LONG (Buy+StrongBuy)', long_subset)
    out['BASELINE (all signals)'] = stats_for('BASELINE (all signals)', signals)

    # ── Confluence gate comparison + threshold tuning (2026-09-05) ──
    # technical_signal == 'BUY' is the raw technical BUY (what the old system's
    # technical layer would trade); confirm_count >= MIN_CONFIRM is what the
    # gate allows. The gap between the two buckets is the measured accuracy
    # improvement. We evaluate thresholds 2/3/4 in ONE run so the optimal
    # strictness can be chosen from evidence instead of intuition.
    ungated = [s for s in signals if s.technical_signal == 'BUY']
    if ungated:
        out['UNGATED TECH BUY (old)'] = stats_for('UNGATED TECH BUY (old)', ungated)
    for th in (2, 3, 4):
        gated = [s for s in ungated if (s.confirm_count or 0) >= th]
        rejected = [s for s in ungated if (s.confirm_count or 0) < th]
        if gated:
            out[f'GATED TECH BUY (confirm>={th})'] = stats_for(f'GATED TECH BUY (confirm>={th})', gated)
        if rejected:
            out[f'GATE-REJECTED TECH BUY (<{th})'] = stats_for(f'GATE-REJECTED TECH BUY (<{th})', rejected)

    # ── Regime-conditioned gate (2026-09-05) ──
    # 10y backtest showed confirm>=3 only helps in the 2023-26 bull regime.
    # Hypothesis: the gate should apply ONLY when the ticker is above its own
    # 200-day MA (long-term uptrend). Test it here.
    g3_up = [s for s in ungated if (s.confirm_count or 0) >= 3 and s.close_above_ma200]
    g3_dn = [s for s in ungated if (s.confirm_count or 0) >= 3 and not s.close_above_ma200]
    if g3_up:
        out['GATED TECH BUY (confirm>=3, MA200 up)'] = stats_for('GATED TECH BUY (confirm>=3, MA200 up)', g3_up)
    if g3_dn:
        out['GATED TECH BUY (confirm>=3, MA200 down)'] = stats_for('GATED TECH BUY (confirm>=3, MA200 down)', g3_dn)

    # ── Weighted convolution buckets (2026-09-05) ──
    # CONV BUY = raw technical BUY that passes the convolution gate
    # (tech_conv >= TECH_BUY_MIN=60). Tuned from the 10y backtest: 60 beats
    # 65 on WR/avg/tail-risk with 2.3× more signals; the pattern-majority
    # veto was dropped (it rejected 59.2% WR trades).
    conv_buy = [s for s in ungated if (s.conv_tech_score or 0) >= 60]
    conv_rejected = [s for s in ungated if (s.conv_tech_score or 0) < 60]
    if conv_buy:
        out['CONV BUY (tech>=60)'] = stats_for('CONV BUY (tech>=60)', conv_buy)
    if conv_rejected:
        out['CONV REJECTED TECH BUY'] = stats_for('CONV REJECTED TECH BUY', conv_rejected)
    return out


def write_outputs(all_signals: List[BTSignal], out_dir: Path, tail_threshold: float,
                  cfg: Dict[str, Any], elapsed_s: float) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)

    # CSV
    csv_path = out_dir / 'signals.csv'
    pd.DataFrame([asdict(s) for s in all_signals]).to_csv(csv_path, index=False)

    # Summary JSON
    buckets = aggregate(all_signals, tail_threshold)
    summary = {
        'generated_at': datetime.now(timezone.utc).isoformat(),
        'config': cfg,
        'elapsed_seconds': round(elapsed_s, 1),
        'total_signals': len(all_signals),
        'total_tickers': len({s.ticker for s in all_signals}),
        'tail_threshold_pct': tail_threshold,
        'buckets': {k: asdict(v) for k, v in buckets.items()},
    }
    (out_dir / 'summary.json').write_text(json.dumps(summary, indent=2))

    # Markdown report
    lines = [
        '# Quantamental Signal Backtest — Verdict',
        '',
        f"*Generated:* {summary['generated_at']}  ",
        f"*Universe:* {summary['total_tickers']} tickers · *Signals:* {len(all_signals)} · "
        f"*Horizon:* {cfg['horizon']} trading days · *Tail threshold:* {tail_threshold}% · "
        f"*Elapsed:* {elapsed_s/60:.0f} min",
        '',
        '> Point-in-time signals (df_override, no download lookahead). '
        'Fundamentals/sentiment disabled (future-leak guard). See module docstring for limitations.',
        '',
        '| Rating | Signals | Win% | Avg% | Median% | P(close<tail)% | P(touched tail)% | Worst% | Worst MAE% |',
        '|---|---|---|---|---|---|---|---|---|',
    ]
    order = [r for r in RATING_ORDER if r in buckets] + \
            [g for g in ('LONG (Buy+StrongBuy)', 'BASELINE (all signals)',
                         'UNGATED TECH BUY (old)',
                         'CONV BUY (tech>=60)', 'CONV REJECTED TECH BUY',
                         'GATED TECH BUY (confirm>=2)', 'GATE-REJECTED TECH BUY (<2)',
                         'GATED TECH BUY (confirm>=3)', 'GATE-REJECTED TECH BUY (<3)',
                         'GATED TECH BUY (confirm>=4)', 'GATE-REJECTED TECH BUY (<4)',
                         'GATED TECH BUY (confirm>=3, MA200 up)',
                         'GATED TECH BUY (confirm>=3, MA200 down)') if g in buckets]
    for name in order:
        b = buckets[name]
        lines.append(
            f"| {name} | {b.count} | {b.win_rate_pct} | {b.avg_ret} | {b.median_ret} | "
            f"{b.p_below_tail_close} | {b.p_below_tail_mae} | {b.worst_ret} | {b.worst_mae} |")

    # ── Confluence gate verdict + threshold tuning (2026-09-05) ──
    gu = buckets.get('UNGATED TECH BUY (old)')
    if gu:
        lines += ['', '## Confluence Gate Verdict (2026-09-05)', '',
                  f"- UNGATED TECH BUY (old system): **{gu.win_rate_pct}%** win rate, "
                  f"**{gu.avg_ret}%** avg 20d return (n={gu.count})",
                  '',
                  '| Threshold | Signals | Win% | Avg% | vs ungated WR | vs ungated avg |',
                  '|---|---|---|---|---|---|']
        best = None
        for th in (2, 3, 4):
            g = buckets.get(f'GATED TECH BUY (confirm>={th})')
            if not g:
                continue
            wr_delta = round(g.win_rate_pct - gu.win_rate_pct, 1)
            ret_delta = round(g.avg_ret - gu.avg_ret, 2)
            lines.append(
                f"| confirm>={th} | {g.count} | {g.win_rate_pct} | {g.avg_ret} | "
                f"{wr_delta:+.1f} pp | {ret_delta:+.2f} pp |")
            # Best = highest win rate among thresholds with a usable sample
            # (>=10 signals); ties broken by avg return.
            if g.count >= 10 and (best is None or
                                  (g.win_rate_pct, g.avg_ret) > (best[1].win_rate_pct, best[1].avg_ret)):
                best = (th, g)
        if best:
            lines += ['',
                      f"**Recommended: confirm>={best[0]}** — {best[1].win_rate_pct}% WR, "
                      f"{best[1].avg_ret}% avg, n={best[1].count} (highest win rate with "
                      f"a usable sample).",
                      '',
                      f"Rule: pick the strictest threshold that keeps a usable signal "
                      f"count; if a looser threshold matches the win rate with more "
                      f"signals, prefer it."]

    # ── Regime-conditioned gate verdict (2026-09-05) ──
    g3u = buckets.get('GATED TECH BUY (confirm>=3, MA200 up)')
    g3d = buckets.get('GATED TECH BUY (confirm>=3, MA200 down)')
    if g3u and gu:
        wr_delta = round(g3u.win_rate_pct - gu.win_rate_pct, 1)
        ret_delta = round(g3u.avg_ret - gu.avg_ret, 2)
        lines += ['', '## Regime-Conditioned Gate Verdict (2026-09-05)', '',
                  f"- GATED ≥3 + MA200 up: **{g3u.win_rate_pct}%** WR, **{g3u.avg_ret}%** avg "
                  f"(n={g3u.count}) vs UNGATED **{gu.win_rate_pct}%** / **{gu.avg_ret}%** "
                  f"→ **{wr_delta:+.1f} pp** / **{ret_delta:+.2f} pp**"]
        if g3d:
            lines.append(
                  f"- GATED ≥3 + MA200 down: **{g3d.win_rate_pct}%** WR, **{g3d.avg_ret}%** avg "
                  f"(n={g3d.count}) — the trades the regime condition would avoid.")
        lines += ['',
                  f"Rule: if MA200-up beats both ungated and plain ≥3, the gate should "
                  f"only fire in long-term uptrends (regime-conditioned)."]

    # ── Weighted convolution verdict (2026-09-05) ──
    cb = buckets.get('CONV BUY (tech>=60)')
    cr = buckets.get('CONV REJECTED TECH BUY')
    if cb and gu:
        wr_delta = round(cb.win_rate_pct - gu.win_rate_pct, 1)
        ret_delta = round(cb.avg_ret - gu.avg_ret, 2)
        lines += ['', '## Weighted Convolution Verdict (2026-09-05)', '',
                  f"- CONV BUY (tech_conv≥60): **{cb.win_rate_pct}%** WR, "
                  f"**{cb.avg_ret}%** avg (n={cb.count}) vs UNGATED **{gu.win_rate_pct}%** / "
                  f"**{gu.avg_ret}%** → **{wr_delta:+.1f} pp** / **{ret_delta:+.2f} pp**"]
        if cr:
            lines.append(
                  f"- CONV REJECTED (would have traded under old system): **{cr.win_rate_pct}%** WR, "
                  f"**{cr.avg_ret}%** avg (n={cr.count}) — the trades the convolution avoids.")
        lines += ['',
                  f"Rule: if CONV BUY beats UNGATED on win rate AND tail risk, the "
                  f"weighted convolution is the production filter. If the sample is "
                  f"too small, relax TECH_BUY_MIN and re-run."]
    sb = buckets.get('BASELINE (all signals)')
    bb = buckets.get('Strong Buy') or buckets.get('LONG (Buy+StrongBuy)')
    bb_name = 'Strong Buy' if 'Strong Buy' in buckets else 'LONG (Buy+StrongBuy)'
    if sb and bb:
        edge_c = round(sb.p_below_tail_close - bb.p_below_tail_close, 1)
        edge_m = round(sb.p_below_tail_mae - bb.p_below_tail_mae, 1)
        lines += ['', '## Verdict', '',
                  f"- {bb_name} P(close < {tail_threshold}%): **{bb.p_below_tail_close}%** "
                  f"vs base rate {sb.p_below_tail_close}% → protection edge **{edge_c:+.1f} pp**",
                  f"- {bb_name} P(touched < {tail_threshold}%): **{bb.p_below_tail_mae}%** "
                  f"vs base rate {sb.p_below_tail_mae}% → protection edge **{edge_m:+.1f} pp**",
                  '',
                  f"Rule: positive edge ⇒ ratings add real downside protection; "
                  f"≈0/negative ⇒ tune blended_score thresholds before trusting app signals."]
    (out_dir / 'REPORT.md').write_text('\n'.join(lines))
    log.info("Outputs written to %s", out_dir)


# ── Multi-ticker runner (checkpoint/resume, thread-safe) ──────────────────

class UniverseRunner:
    def __init__(self, tickers: List[str], out_dir: Path, workers: int = 8,
                 years: int = 5, rebalance_days: int = 20, horizon: int = 20,
                 resume: bool = False):
        self.tickers = [t.strip().upper() for t in tickers if t.strip()]
        self.out_dir = out_dir
        self.workers = workers
        self.years = years
        self.rebalance_days = rebalance_days
        self.horizon = horizon
        self.resume = resume
        self.elapsed: float = 0.0
        self._ckpt = out_dir / 'signals.jsonl'
        self._lock = threading.Lock()

    def _done_tickers(self) -> set:
        done = set()
        if self.resume and self._ckpt.exists():
            for line in self._ckpt.read_text().splitlines():
                try:
                    done.add(json.loads(line)['ticker'])
                except Exception:
                    continue
        return done

    def _append_ckpt(self, ticker: str, signals: List[BTSignal]) -> None:
        rec = {'ticker': ticker, 'done_at': datetime.now(timezone.utc).isoformat(),
               'signals': [asdict(s) for s in signals]}
        with self._lock:
            with open(self._ckpt, 'a') as fh:
                fh.write(json.dumps(rec) + '\n')

    def _work(self, ticker: str) -> List[BTSignal]:
        bt = TickerBacktester(ticker, years=self.years,
                              rebalance_days=self.rebalance_days, horizon=self.horizon)
        try:
            return bt.run()
        except Exception as exc:
            log.warning("%s skipped: %s", ticker, exc)
            return []

    def run(self) -> List[BTSignal]:
        done = self._done_tickers()
        todo = [t for t in self.tickers if t not in done]
        log.info("Universe: %d tickers (%d already done, %d to go, workers=%d)",
                 len(self.tickers), len(done), len(todo), self.workers)
        self.out_dir.mkdir(parents=True, exist_ok=True)
        # Fresh run (no --resume): start with a clean checkpoint. The flatten
        # below reads the WHOLE signals.jsonl, so a stale checkpoint from a
        # previous run would double-count every signal.
        if not self.resume and self._ckpt.exists():
            self._ckpt.unlink()

        started = time.time()
        processed = ok = 0
        try:
            with ThreadPoolExecutor(max_workers=self.workers) as pool:
                futures = {pool.submit(self._work, t): t for t in todo}
                for fut in as_completed(futures):
                    ticker = futures[fut]
                    processed += 1
                    try:
                        sigs = fut.result()
                    except Exception as exc:
                        log.warning("worker error %s: %s", ticker, exc)
                        sigs = []
                    if sigs:
                        ok += 1
                        self._append_ckpt(ticker, sigs)
                    if processed % 25 == 0 or processed == len(todo):
                        rate = processed / max(time.time() - started, 1)
                        eta_min = (len(todo) - processed) / max(rate, 1e-9) / 60
                        log.info("progress %d/%d tickers (%d with signals) | %.2f tk/s | ETA %.0f min",
                                 processed, len(todo), ok, rate, eta_min)
        finally:
            self.elapsed = time.time() - started

        # Flatten checkpoint → memory
        all_signals: List[BTSignal] = []
        for line in self._ckpt.read_text().splitlines():
            try:
                for s in json.loads(line)['signals']:
                    all_signals.append(BTSignal(**s))
            except Exception:
                continue
        elapsed = time.time() - started
        log.info("DONE: %d signals from %d tickers in %.0f min",
                 len(all_signals), len({s.ticker for s in all_signals}), elapsed / 60)
        return all_signals


# ── CLI ───────────────────────────────────────────────────────────────────

def main(argv: Optional[List[str]] = None) -> int:
    p = argparse.ArgumentParser(description="Lookahead-free quantamental backtest")
    p.add_argument('--universe-file', default='',
                   help="text file with one ticker per line (default: built-in sample)")
    p.add_argument('--limit', type=int, default=0, help="only first N tickers (0=all)")
    p.add_argument('--workers', type=int, default=8)
    p.add_argument('--years', type=int, default=5)
    p.add_argument('--rebalance', type=int, default=20, help="signal every N trading days")
    p.add_argument('--horizon', type=int, default=20, help="forward-return horizon (trading days)")
    p.add_argument('--tail', type=float, default=-10.0, help="'extreme negative' threshold %%")
    p.add_argument('--out', default='validation_results/quantamental_bt')
    p.add_argument('--resume', action='store_true', help='skip tickers already in signals.jsonl')
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')

    tickers: List[str] = []
    if args.universe_file and Path(args.universe_file).exists():
        tickers = [l.strip() for l in Path(args.universe_file).read_text().splitlines()
                   if l.strip() and not l.startswith('#')]
    else:
        # Built-in liquid sample for smoke tests
        tickers = ['RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS',
                   'SBIN.NS', 'BHARTIARTL.NS', 'ITC.NS', 'LT.NS', 'AXISBANK.NS',
                   'MARUTI.NS', 'TECHM.NS', 'WIPRO.NS', 'SUNPHARMA.NS', 'HINDUNILVR.NS',
                   'BAJFINANCE.NS', 'ASIANPAINT.NS', 'KOTAKBANK.NS', 'TITAN.NS', 'ULTRACEMCO.NS']
    if args.limit:
        tickers = tickers[:args.limit]

    out_dir = Path(args.out)
    runner = UniverseRunner(tickers, out_dir, workers=args.workers, years=args.years,
                            rebalance_days=args.rebalance, horizon=args.horizon,
                            resume=args.resume)
    signals = runner.run()
    if not signals:
        log.error("No signals produced — nothing to report")
        return 1

    cfg = {'years': args.years, 'rebalance_days': args.rebalance,
           'horizon': args.horizon, 'workers': args.workers,
           'universe_size': len(tickers)}
    write_outputs(signals, out_dir, args.tail, cfg, runner.elapsed)
    print(f"\nVerdict report: {out_dir / 'REPORT.md'}")
    return 0


if __name__ == '__main__':
    sys.exit(main())
