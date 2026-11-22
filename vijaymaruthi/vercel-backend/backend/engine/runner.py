"""
Async wrapper around the existing quantamental analysis engine.

This module bridges the FastAPI backend with the Python analysis code
in technical_analysis_report.py.
"""

import json
import os
import sys
import logging
from typing import Optional, Dict, Any, List
from concurrent.futures import ThreadPoolExecutor, as_completed, TimeoutError as FuturesTimeoutError

log = logging.getLogger(__name__)

# The analysis engine (technical_analysis_report.py) lives 4 levels up:
#   engine/runner.py → backend/ → quantamental-platform/ → share/
_SHARE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
if _SHARE_DIR not in sys.path:
    sys.path.insert(0, _SHARE_DIR)


def _default_workers() -> int:
    """Auto-tune scan worker threads.

    The analysis workload is network-I/O-bound (yfinance downloads dominate),
    so threads scale well — BUT Yahoo rate-limits aggressive concurrency
    (8 workers × ~9 requests/ticker caused 429s). Default is a rate-limit-safe
    5 workers; raise via SCAN_WORKERS once the fundamentals cache is warm
    (cache hits drop requests/ticker from ~9 to ~1).
    Priority:
      1. SCAN_WORKERS env var (explicit override)
      2. min(5, max(4, cpu_count - 2))  — rate-limit-safe default
      3. 4 (safe floor)
    """
    env = os.environ.get("SCAN_WORKERS", "").strip()
    if env.isdigit() and int(env) > 0:
        return max(1, min(16, int(env)))
    try:
        return max(4, min(5, os.cpu_count() - 2))
    except Exception:
        return 4


class AnalysisRunner:
    """Run the quantamental pipeline with async-friendly interface."""

    def __init__(self):
        self._executor = ThreadPoolExecutor(max_workers=_default_workers())
        self._pipeline_module = None

    def _import_pipeline(self):
        """Lazy-import the main analysis module."""
        if self._pipeline_module is None:
            import technical_analysis_report as tar
            self._pipeline_module = tar
        return self._pipeline_module

    def run_ticker(self, ticker: str, period: str = "1y",
                    sentiment: bool = False, save_db: bool = False,
                    manual_data: Optional[str] = None,
                    options: bool = False) -> Dict[str, Any]:
        """Run full analysis on a single ticker. Returns serializable dict."""
        tar = self._import_pipeline()

        # Load manual overrides
        manual_overrides = {}
        if manual_data and os.path.exists(manual_data):
            manual_overrides = tar.FundamentalAnalyzer.load_manual_file(manual_data)

        # Build pipeline
        pipeline = tar.TechnicalAnalysisPipeline(
            ticker=ticker,
            period=period,
            do_options=options,
            do_wyckoff=True,
            do_gann=True,
            do_sentiment=sentiment,
            do_db=save_db,
            manual_overrides=manual_overrides,
        )

        result = pipeline.run()
        analysis = getattr(pipeline, 'analysis', {})

        if result.df is None or result.df.empty:
            return {'error': f'No data for {ticker}'}

        price = float(result.df['Close'].iloc[-1])
        qm = result.quantamental or {}

        # Generate chart
        safe_ticker = ticker.replace('.', '_')
        charts_dir = os.path.join(_SHARE_DIR, 'reports', 'charts')
        os.makedirs(charts_dir, exist_ok=True)
        chart_path = os.path.join(charts_dir, f'{safe_ticker}_analysis.png')
        chart_rel_path = f'/static/charts/{safe_ticker}_analysis.png'

        try:
            cg = tar.ChartGenerator(result.df, result, analysis)
            cg.generate(chart_path)
        except Exception as e:
            log.warning(f"Chart generation failed: {e}")
            chart_rel_path = None

        # Build report text
        report_text = None
        try:
            rb = tar.ReportBuilder(result, analysis)
            report_text = rb.build()
        except Exception as e:
            log.warning(f"Report build failed: {e}")

        # v3 health methodology (shared with standalone validation)
        health = {}
        try:
            from analysis_health import compute_health
            health = compute_health(result, report_text)
        except Exception as e:
            log.warning(f"Health compute error for {ticker}: {e}")

        # Fill report quality metrics on the latest DB row (report built post-save)
        if save_db and health:
            try:
                from analysis_db import AnalysisDatabase
                AnalysisDatabase().update_report_metrics(
                    ticker, health.get('report_nan', 0), health.get('report_len', 0))
            except Exception as e:
                log.warning(f"Report metrics DB update error for {ticker}: {e}")

        # Structure response
        response = {
            'ticker': ticker,
            'signal': result.signal,
            'confidence': result.confidence,
            'price': price,
            'quantamental': qm,
            'market_structure': result.market_structure,
            'trend': result.trend,
            'support_resistance': result.support_resistance,
            'indicators': {
                'rsi': result.rsi,
                'macd': result.macd,
                'adx': result.adx,
                'atr': result.atr,
                'bollinger': result.bollinger,
                'volume': result.volume,
            },
            'candlestick': result.candlestick_pattern,
            'divergence': result.divergence if hasattr(result, 'divergence') else [],
            'wyckoff': result.wyckoff,
            'gann': result.gann,
            'sentiment': result.sentiment if hasattr(result, 'sentiment') else {},
            'fundamentals': result.fundamentals,
            'chart_url': chart_rel_path,
            'report_text': report_text,
            'quality_gates': getattr(result, 'quality_gates', []),
            'technical_signal': getattr(result, 'technical_signal', None),
            'health': health,
        }

        return self._sanitize(response)

    def run_batch(self, tickers: List[str], period: str = "1y",
                   sentiment: bool = False, save_db: bool = False,
                   max_workers: Optional[int] = None) -> List[Dict[str, Any]]:
        """Run analysis on multiple tickers in parallel using thread pool.

        Uses max_workers (default auto-tuned via _default_workers, ~8 on a
        10-core Mac) parallel threads to speed up batch processing.
        Per-ticker timeout prevents a single hanging ticker (e.g. yfinance stall)
        from blocking the batch. Falls back to sequential if thread pool fails.
        """
        if max_workers is None or max_workers <= 0:
            max_workers = _default_workers()
        ticker_timeout = int(os.environ.get("TICKER_TIMEOUT_SECONDS", "120"))
        results: List[Dict[str, Any]] = []
        from concurrent.futures import ThreadPoolExecutor, as_completed

        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            fut_map = {
                pool.submit(self.run_ticker, t, period, sentiment, save_db, None, False): t
                for t in tickers
            }
            for fut in as_completed(fut_map):
                ticker = fut_map[fut]
                try:
                    res = fut.result(timeout=ticker_timeout)
                    results.append(res)
                except FuturesTimeoutError:
                    log.warning(f"Ticker TIMEOUT after {ticker_timeout}s: {ticker}")
                    results.append({'ticker': ticker, 'error': f'Timeout after {ticker_timeout}s'})
                    fut.cancel()
                except Exception as e:
                    log.warning(f"Batch error on {ticker}: {e}")
                    results.append({'ticker': ticker, 'error': str(e)})

        return results

    @staticmethod
    def _sanitize(obj):
        """Convert numpy types to native Python for JSON serialization."""
        import numpy as np
        if isinstance(obj, dict):
            return {k: AnalysisRunner._sanitize(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            return [AnalysisRunner._sanitize(v) for v in obj]
        elif isinstance(obj, np.floating):
            return float(obj)
        elif isinstance(obj, np.integer):
            return int(obj)
        elif isinstance(obj, np.bool_):
            return bool(obj)
        elif isinstance(obj, np.ndarray):
            return obj.tolist()
        return obj

    @staticmethod
    def get_portfolio(db_path: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get portfolio snapshot from database."""
        try:
            from analysis_db import AnalysisDatabase
            adb = AnalysisDatabase(db_path)
            return adb.get_portfolio_summary()
        except Exception as e:
            log.warning(f"Portfolio query error: {e}")
            return []

    @staticmethod
    def get_ticker_history(ticker: str, db_path: Optional[str] = None) -> Dict[str, Any]:
        """Get analysis history for a ticker."""
        try:
            from analysis_db import AnalysisDatabase
            adb = AnalysisDatabase(db_path)
            return adb.get_trend(ticker)
        except Exception as e:
            log.warning(f"History query error: {e}")
            return {'ticker': ticker, 'runs': 0}

    @staticmethod
    def run_backtest(ticker: str, years: int = 3, rebalance_days: int = 63) -> Dict[str, Any]:
        """Run quantamental backtest."""
        try:
            from quantamental_backtester import QuantamentalBacktester
            bt = QuantamentalBacktester(
                ticker, years=years, rebalance_days=rebalance_days)
            signals = bt.run_fast()
            if not signals:
                return {'ticker': ticker, 'error': 'No signals generated',
                        'note': 'yfinance does not support historical end-date data. '
                                'Use a custom data provider for proper backtesting.'}
            bt.compute_forward_returns()

            group_results = bt.aggregate('qm_rating')
            comparisons = bt.compare_methods()

            return {
                'ticker': ticker,
                'total_signals': len(signals),
                'group_results': [
                    {'group': k, 'count': v.count, 'avg_return_90d': v.avg_return_90d,
                     'win_rate_90d': v.win_rate_90d, 'sharpe_90d': v.sharpe_90d}
                    for k, v in group_results.items()
                ],
                'comparisons': [
                    {'methodology': c.methodology, 'overall_win_rate_90d': c.overall_win_rate_90d,
                     'avg_return_90d': c.avg_return_90d, 'sharpe_90d': c.sharpe_90d,
                     'spread_return_90d': c.spread_return_90d, 'total_trades': c.total_trades}
                    for c in comparisons
                ],
            }
        except Exception as e:
            return {'ticker': ticker, 'error': str(e)}
