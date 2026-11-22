"""
portfolio_heatmap.py — Multi-symbol batch analysis with colour-coded heatmap.

Processes a list of tickers (from CLI args or CSV watchlist) through the full
quantamental pipeline and produces a consolidated visual table.
"""

import os
import csv
import json
import logging
from datetime import datetime
from typing import List, Optional, Dict, Any, Tuple
from dataclasses import dataclass, field

log = logging.getLogger(__name__)

# ── ANSI colour codes for terminal output ──
COLORS = {
    'strong_buy':  '\033[38;5;28m',   # dark green
    'buy':         '\033[38;5;40m',   # green
    'hold':        '\033[38;5;220m',  # amber
    'sell':        '\033[38;5;208m',  # orange-red
    'strong_sell': '\033[38;5;196m',  # red
    'buy_bg':      '\033[48;5;22m\033[38;5;15m',   # dark green bg
    'hold_bg':     '\033[48;5;58m\033[38;5;15m',    # dark amber bg
    'sell_bg':     '\033[48;5;52m\033[38;5;15m',    # dark red bg
    'header':      '\033[1;97m',      # bold white
    'dim':         '\033[2;37m',      # dim white
    'reset':       '\033[0m',
}

RATING_EMOJI = {
    'Strong Buy':  'STRONG BUY',
    'Buy':         'BUY',
    'Hold':        'HOLD',
    'Sell':        'SELL',
    'Strong Sell': 'STRONG SELL',
}

RATING_COLOR_KEY = {
    'Strong Buy': 'strong_buy',
    'Buy':        'buy',
    'Hold':       'hold',
    'Sell':       'sell',
    'Strong Sell':'strong_sell',
}


@dataclass
class HeatmapRow:
    """One row in the portfolio heatmap."""
    ticker: str
    qm_rating: str
    qm_score: float
    tech_signal: str
    tech_conf: float
    tech_score: float
    fund_rating: str
    fund_score: float
    cap_category: str
    price: float = 0.0
    change_1d: Optional[float] = None
    trend: str = 'stable'
    rank: int = 0


class PortfolioHeatmap:
    """Process ticker list and produce consolidated quantamental heatmap."""

    def __init__(self, tickers: List[str], period: str = "1y",
                 manual_data_file: Optional[str] = None,
                 db_path: Optional[str] = None,
                 workers: int = 4):
        self.tickers = [t.upper() for t in tickers]
        self.period = period
        self.manual_data_file = manual_data_file
        self.workers = min(workers, len(tickers) or 1)
        self.rows: List[HeatmapRow] = []

    # ── Run batch analysis ──

    def run(self) -> List[HeatmapRow]:
        """Analyse all tickers in the watchlist."""
        from technical_analysis_report import TechnicalAnalysisPipeline

        manual_overrides = {}
        if self.manual_data_file and os.path.exists(self.manual_data_file):
            with open(self.manual_data_file) as f:
                manual_overrides = json.load(f)
            log.info(f"Loaded manual overrides from {self.manual_data_file}")

        rows = []
        for i, ticker in enumerate(self.tickers, 1):
            log.info(f"[{i}/{len(self.tickers)}] Analysing {ticker}...")
            try:
                pipeline = TechnicalAnalysisPipeline(
                    ticker, period=self.period, manual_overrides=manual_overrides)
                result = pipeline.run()
                qm = result.quantamental or {}
                fund = result.fundamentals or {}
                qr = fund.get('quick_ratings', {}) if isinstance(fund, dict) else {}

                rows.append(HeatmapRow(
                    ticker=ticker,
                    qm_rating=qm.get('blended_rating', 'N/A'),
                    qm_score=qm.get('blended_score', 0) or 0,
                    tech_signal=result.signal or 'HOLD',
                    tech_conf=result.confidence or 0,
                    tech_score=qm.get('technical_score', 0) or 0,
                    fund_rating=qr.get('screening_rating', 'N/A'),
                    fund_score=qm.get('fundamental_score', 0) or 0,
                    cap_category=qm.get('market_cap_category', 'mid') or 'mid',
                    price=float(result.df['Close'].iloc[-1]) if result.df is not None else 0,
                    trend='stable',
                ))
            except Exception as e:
                log.warning(f"Error analysing {ticker}: {e}")
                rows.append(HeatmapRow(
                    ticker=ticker, qm_rating='ERROR', qm_score=0,
                    tech_signal='?', tech_conf=0, tech_score=0,
                    fund_rating='?', fund_score=0, cap_category='?',
                ))

        # Sort by QM score descending (best first)
        rows.sort(key=lambda r: r.qm_score, reverse=True)
        for rank, row in enumerate(rows, 1):
            row.rank = rank

        self.rows = rows
        return rows

    # ── Terminal Output ──

    @staticmethod
    def _color(val: str, color_key: str) -> str:
        c = COLORS.get(color_key, COLORS['dim'])
        return f"{c}{val}{COLORS['reset']}"

    @staticmethod
    def _bar(score: float, width: int = 10) -> str:
        """Simple text bar showing score magnitude."""
        filled = max(1, int(score / 100 * width))
        bar = '█' * filled + '░' * (width - filled)
        if score >= 65:
            return f"{COLORS['buy']}{bar}{COLORS['reset']}"
        elif score >= 40:
            return f"{COLORS['hold']}{bar}{COLORS['reset']}"
        else:
            return f"{COLORS['sell']}{bar}{COLORS['reset']}"

    def print_table(self):
        """Print a colour-coded terminal table."""
        if not self.rows:
            print("No data to display.")
            return

        c = COLORS
        sep = f"  {c['dim']}{'-'*90}{c['reset']}"

        # Header
        print(f"\n{c['header']}  QUANTAMENTAL PORTFOLIO HEATMAP{c['reset']}")
        print(f"  Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')}  |  "
              f"Tickers: {len(self.rows)}{c['reset']}")
        print(sep)
        print(f"  {'Rank':<5s} {'Ticker':<18s} {'Rating':<14s} {'Score':<7s} "
              f"{'Tech':<16s} {'Fund':<16s} {'Cap':<8s}")
        print(sep)

        for row in self.rows:
            rank_str = f"#{row.rank}"
            ticker_str = row.ticker[:18]

            # Colour-coded rating
            ck = RATING_COLOR_KEY.get(row.qm_rating, 'hold')
            rating_str = f"{RATING_EMOJI.get(row.qm_rating, '?')}"
            colored_rating = f"{COLORS[ck]}{rating_str:12s}{c['reset']}"

            score_bar = self._bar(row.qm_score)

            # Technical
            tech_color = 'buy' if row.tech_signal in ('BUY', 'CAUTIOUS BUY') else \
                         'sell' if row.tech_signal in ('SELL', 'CAUTIOUS SELL') else 'hold'
            tech_str = f"{c[tech_color]}{row.tech_signal:6s}{c['reset']} ({row.tech_conf:.0f}%)"

            # Fundamental
            fund_ck = RATING_COLOR_KEY.get(row.fund_rating, 'hold')
            fund_str = f"{COLORS[fund_ck]}{row.fund_rating:6s}{c['reset']} ({row.fund_score:.0f})"

            # Cap
            cap_str = f"{row.cap_category.capitalize():6s}"

            print(f"  {rank_str:<5s} {ticker_str:<18s} {colored_rating} {score_bar} "
                  f"{tech_str:<18s} {fund_str:<18s} {cap_str}")

        print(sep)
        print(f"  {c['dim']}Legend: STRONG BUY / BUY / HOLD / SELL / STRONG SELL{c['reset']}")
        print()

    # ── HTML Output ──

    def to_html(self, filepath: Optional[str] = None) -> str:
        """Generate an HTML version of the heatmap."""
        rows_html = ""
        for row in self.rows:
            ck = RATING_COLOR_KEY.get(row.qm_rating, 'hold')
            bg = {'strong_buy': '#1a6b1a', 'buy': '#2d8a2d',
                  'hold': '#8a7a2d', 'sell': '#8a4a2d',
                  'strong_sell': '#8a2d2d'}.get(ck, '#333')
            fg = '#fff'

            tech_color = '#2d8a2d' if row.tech_signal in ('BUY', 'CAUTIOUS BUY') else \
                         '#8a2d2d' if row.tech_signal in ('SELL', 'CAUTIOUS SELL') else '#8a7a2d'

            fund_ck = RATING_COLOR_KEY.get(row.fund_rating, 'hold')
            fund_color = {'strong_buy': '#1a6b1a', 'buy': '#2d8a2d',
                          'hold': '#8a7a2d', 'sell': '#8a4a2d',
                          'strong_sell': '#8a2d2d'}.get(fund_ck, '#333')

            bar_pct = min(100, max(5, row.qm_score))
            bar_color = '#2d8a2d' if row.qm_score >= 65 else '#8a7a2d' if row.qm_score >= 40 else '#8a2d2d'

            rows_html += f"""
            <tr>
                <td style="text-align:center;">#{row.rank}</td>
                <td><strong>{row.ticker}</strong></td>
                <td style="background:{bg};color:{fg};font-weight:bold;text-align:center;">{row.qm_rating}</td>
                <td>
                    <div style="background:#ddd;border-radius:4px;overflow:hidden;">
                        <div style="width:{bar_pct:.0f}%;background:{bar_color};color:{'#fff' if bar_pct > 30 else '#333'};
                             padding:2px 6px;font-size:12px;text-align:right;">{row.qm_score:.0f}</div>
                    </div>
                </td>
                <td style="color:{tech_color};text-align:center;">{row.tech_signal} ({row.tech_conf:.0f}%)</td>
                <td style="color:{fund_color};text-align:center;">{row.fund_rating} ({row.fund_score:.0f})</td>
                <td style="text-align:center;">{row.cap_category.capitalize()}</td>
                <td style="text-align:right;">₹{row.price:,.2f}</td>
            </tr>"""

        html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Quantamental Portfolio Heatmap</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #1a1a2e; color: #eee; margin: 20px; }}
  h1 {{ color: #fff; font-size: 24px; }}
  .meta {{ color: #888; font-size: 13px; margin-bottom: 20px; }}
  table {{ border-collapse: collapse; width: 100%; background: #16213e; border-radius: 8px; overflow: hidden; }}
  th {{ background: #0f3460; color: #fff; padding: 10px 12px; text-align: left; font-size: 13px; }}
  td {{ padding: 8px 12px; border-bottom: 1px solid #1a1a3e; font-size: 13px; }}
  tr:hover {{ background: #1a1a40; }}
  .legend {{ margin-top: 16px; font-size: 12px; color: #888; }}
  .footer {{ margin-top: 20px; font-size: 11px; color: #555; text-align: center; }}
</style>
</head>
<body>
<h1>Quantamental Portfolio Heatmap</h1>
<div class="meta">Generated: {datetime.now().strftime('%Y-%m-%d %H:%M')} &middot; Tickers: {len(self.rows)}</div>
<table>
<thead><tr>
    <th>Rank</th><th>Ticker</th><th>Quantamental</th><th>Score</th>
    <th>Technical</th><th>Fundamental</th><th>Cap</th><th>Price</th>
</tr></thead>
<tbody>{rows_html}</tbody>
</table>
<div class="legend">Legend: <span style="color:#2d8a2d;">Strong Buy / Buy</span> &middot;
<span style="color:#8a7a2d;">Hold</span> &middot;
<span style="color:#8a4a2d;">Sell</span> &middot;
<span style="color:#8a2d2d;">Strong Sell</span></div>
<div class="footer">Quantamental Analytics v4.0 &mdash; Not investment advice.</div>
</body>
</html>"""

        if filepath:
            os.makedirs(os.path.dirname(filepath) or '.', exist_ok=True)
            with open(filepath, 'w') as f:
                f.write(html)
            log.info(f"Heatmap saved: {filepath}")

        return html

    # ── CSV Export ──

    def to_csv(self, filepath: str):
        """Export heatmap as CSV."""
        os.makedirs(os.path.dirname(filepath) or '.', exist_ok=True)
        with open(filepath, 'w', newline='') as f:
            w = csv.writer(f)
            w.writerow(['Rank', 'Ticker', 'Quantamental_Rating', 'Quantamental_Score',
                        'Tech_Signal', 'Tech_Confidence', 'Fundamental_Rating',
                        'Fundamental_Score', 'Cap_Category', 'Price'])
            for row in self.rows:
                w.writerow([row.rank, row.ticker, row.qm_rating, row.qm_score,
                           row.tech_signal, row.tech_conf, row.fund_rating,
                           row.fund_score, row.cap_category, row.price])
        log.info(f"CSV exported: {filepath}")

    # ── Watchlist Loader ──

    @staticmethod
    def load_watchlist(path: str) -> List[str]:
        """Load tickers from a CSV/text file (one per line or first column)."""
        tickers = []
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                # Handle CSV: take first column
                ticker = line.split(',')[0].strip()
                if ticker:
                    tickers.append(ticker.upper())
        if not tickers:
            log.warning(f"No tickers found in {path}")
        return tickers


# ── Quick test ──
if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    hm = PortfolioHeatmap(['AAPL', 'MSFT', 'GOOGL', 'TCS.NS', 'HDFCBANK.NS'])
    hm.run()
    hm.print_table()
