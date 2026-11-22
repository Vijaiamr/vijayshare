"""
analysis_db.py — SQLite persistence for quantamental analysis runs.

Stores every analysis run with full technical, fundamental, and quantamental
breakdown for time-series tracking, portfolio aggregation, and trend analysis.

Schema:
  analysis_runs  — one row per ticker per run_timestamp
  metadata       — schema version, last vacuum, etc.
"""

import sqlite3
import json
import os
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any

log = logging.getLogger(__name__)

SCHEMA_VERSION = 1

CREATE_SQL = """
CREATE TABLE IF NOT EXISTS analysis_runs (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    ticker          TEXT NOT NULL,
    run_timestamp   TEXT NOT NULL,       -- ISO-8601
    period          TEXT DEFAULT '1y',
    price           REAL,

    -- Technical subsystem
    tech_signal     TEXT,                -- BUY / SELL / HOLD
    tech_confidence REAL,                -- 0-100
    tech_score      REAL,                -- 0-100 numeric

    -- Fundamental subsystem
    fund_score      REAL,                -- 0-100 numeric
    fund_rating     TEXT,                -- Strong Buy / Buy / Hold / Sell / Strong Sell
    screening_rating TEXT,
    risk_rating     TEXT,
    moat_rating     TEXT,
    analyst_rating  TEXT,

    -- Quantamental fusion
    qm_rating       TEXT,
    qm_score        REAL,                -- 0-100 blended
    tech_weight     REAL,
    fund_weight     REAL,
    cap_category    TEXT,                -- large / mid / small
    weight_adjustments TEXT,             -- JSON list

    -- Divergence tracking
    tech_fund_divergence REAL,           -- |tech_score - fund_score|

    -- Sentiment (future)
    sentiment_score REAL,                -- -1.0 to 1.0

    -- Extended evidence (JSON for flexibility)
    tech_evidence   TEXT,
    fund_evidence   TEXT,

    -- v3 health methodology (scan quality gates)
    health_pass      INTEGER,             -- 1 if all health checks pass
    health_checks    TEXT,                -- JSON dict of individual checks
    quality_gates    TEXT,                -- JSON list of gate reasons
    technical_signal TEXT,                -- pre-blend technical signal
    sector           TEXT,                -- sector classification
    risk_flags       TEXT,                -- JSON list of fundamental risk flags
    yoy_rev          TEXT,                -- quarterly revenue YoY growth
    yoy_ni           TEXT,                -- quarterly net income YoY growth
    report_nan       INTEGER,             -- NaN token count in report text
    report_len       INTEGER,             -- report text length

    -- Versioning
    schema_version  INTEGER DEFAULT 1,
    pipeline_version TEXT,

    UNIQUE(ticker, run_timestamp)
);

CREATE INDEX IF NOT EXISTS idx_ticker     ON analysis_runs(ticker);
CREATE INDEX IF NOT EXISTS idx_timestamp  ON analysis_runs(run_timestamp);
CREATE INDEX IF NOT EXISTS idx_qm_rating  ON analysis_runs(qm_rating);

CREATE TABLE IF NOT EXISTS metadata (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT OR IGNORE INTO metadata (key, value) VALUES ('schema_version', '1');
"""


class AnalysisDatabase:
    """Persist and query analysis runs from SQLite."""

    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            db_path = os.path.join(
                os.path.dirname(os.path.abspath(__file__)),
                'reports', 'analysis_history.db'
            )
        self.db_path = db_path
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
        self._conn: Optional[sqlite3.Connection] = None

    # ── Connection Management ──

    @property
    def conn(self) -> sqlite3.Connection:
        if self._conn is None:
            self._conn = sqlite3.connect(self.db_path)
            self._conn.row_factory = sqlite3.Row
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.execute("PRAGMA busy_timeout=30000")  # 30s — safe concurrent writers during scans
            self._init_schema()
        return self._conn

    def _init_schema(self):
        """Create tables if they don't exist."""
        try:
            self.conn.executescript(CREATE_SQL)
            self.conn.commit()
            self._migrate()
        except Exception as e:
            log.warning(f"DB schema init error (benign if tables exist): {e}")

    def _migrate(self):
        """Add v3 health columns to existing tables (idempotent)."""
        try:
            cols = {r["name"] for r in self.conn.execute("PRAGMA table_info(analysis_runs)").fetchall()}
            additions = {
                "health_pass": "INTEGER",
                "health_checks": "TEXT",
                "quality_gates": "TEXT",
                "technical_signal": "TEXT",
                "sector": "TEXT",
                "risk_flags": "TEXT",
                "yoy_rev": "TEXT",
                "yoy_ni": "TEXT",
                "report_nan": "INTEGER",
                "report_len": "INTEGER",
            }
            for name, typ in additions.items():
                if name not in cols:
                    self.conn.execute(f"ALTER TABLE analysis_runs ADD COLUMN {name} {typ}")
            self.conn.commit()
        except Exception as e:
            log.warning(f"DB migration error (benign): {e}")

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None

    def __del__(self):
        self.close()

    # ── Save ──

    def save_run(self, ticker: str, result, qm: dict, period: str = "1y",
                  sentiment_score: Optional[float] = None) -> int:
        """Persist an analysis run. Returns row id."""
        fund = getattr(result, 'fundamentals', {})
        qr = fund.get('quick_ratings', {}) if isinstance(fund, dict) else {}

        # v3 health methodology (computed from the result; report metrics filled later)
        health = {}
        try:
            from analysis_health import compute_health
            health = compute_health(result)
        except Exception as e:
            log.warning(f"Health compute error for {ticker}: {e}")
        checks = health.get('checks', {})
        risk_flags = health.get('risk_flags')

        row = {
            'ticker': ticker.upper(),
            'run_timestamp': datetime.now().isoformat(timespec='seconds'),
            'period': period,
            'price': float(result.df['Close'].iloc[-1]) if result.df is not None else None,
            'tech_signal': result.signal,
            'tech_confidence': result.confidence,
            'tech_score': qm.get('technical_score'),
            'fund_score': qm.get('fundamental_score'),
            'fund_rating': qm.get('fundamental_rating'),
            'screening_rating': qr.get('screening_rating'),
            'risk_rating': qr.get('risk_rating'),
            'moat_rating': qr.get('moat_rating'),
            'analyst_rating': qr.get('analyst_rating'),
            'qm_rating': qm.get('blended_rating'),
            'qm_score': qm.get('blended_score'),
            'tech_weight': qm.get('weights', {}).get('technical'),
            'fund_weight': qm.get('weights', {}).get('fundamental'),
            'cap_category': qm.get('market_cap_category'),
            'weight_adjustments': json.dumps(qm.get('weight_adjustments', [])),
            'tech_fund_divergence': abs(
                (qm.get('technical_score') or 0) - (qm.get('fundamental_score') or 0)),
            'sentiment_score': sentiment_score,
            'tech_evidence': json.dumps(qm.get('evidence', {}).get('technical', [])),
            'fund_evidence': json.dumps(qm.get('evidence', {}).get('fundamental', [])),
            'health_pass': 1 if health.get('health_pass') else 0,
            'health_checks': json.dumps(checks),
            'quality_gates': json.dumps(health.get('quality_gates', [])),
            'technical_signal': health.get('technical_signal'),
            'sector': health.get('sector'),
            'risk_flags': json.dumps(risk_flags) if isinstance(risk_flags, list) else risk_flags,
            'yoy_rev': health.get('yoy_rev'),
            'yoy_ni': health.get('yoy_ni'),
            'report_nan': health.get('report_nan'),
            'report_len': health.get('report_len'),
            'schema_version': SCHEMA_VERSION,
            'pipeline_version': '4.0',
        }

        # Clean None → SQL NULL
        row = {k: v for k, v in row.items()}

        cols = ', '.join(row.keys())
        placeholders = ', '.join(['?' for _ in row])
        update_cols = ', '.join([f"{k}=EXCLUDED.{k}" for k in row.keys()
                                  if k not in ('ticker', 'run_timestamp')])

        sql = f"""
        INSERT INTO analysis_runs ({cols})
        VALUES ({placeholders})
        ON CONFLICT(ticker, run_timestamp) DO UPDATE SET {update_cols}
        """

        try:
            cur = self.conn.execute(sql, list(row.values()))
            self.conn.commit()
            return cur.lastrowid or 0
        except Exception as e:
            log.warning(f"DB save error for {ticker}: {e}")
            return 0

    # ── Query ──

    def update_report_metrics(self, ticker: str, report_nan: int, report_len: int) -> None:
        """Fill report quality metrics on the latest run.

        The report text is built after the pipeline saves the row, so the runner
        calls this once the report exists to complete the v3 health record.
        """
        try:
            self.conn.execute(
                "UPDATE analysis_runs SET report_nan=?, report_len=? WHERE id=("
                "SELECT id FROM analysis_runs WHERE ticker=? ORDER BY run_timestamp DESC LIMIT 1)",
                (int(report_nan), int(report_len), ticker.upper()))
            self.conn.commit()
        except Exception as e:
            log.warning(f"Report metrics update error for {ticker}: {e}")

    def get_latest(self, ticker: str) -> Optional[dict]:
        """Get most recent run for a ticker."""
        cur = self.conn.execute(
            "SELECT * FROM analysis_runs WHERE ticker=? ORDER BY run_timestamp DESC LIMIT 1",
            (ticker.upper(),))
        row = cur.fetchone()
        return dict(row) if row else None

    def get_history(self, ticker: str, limit: int = 20) -> List[dict]:
        """Get chronological history for a ticker."""
        cur = self.conn.execute(
            "SELECT * FROM analysis_runs WHERE ticker=? ORDER BY run_timestamp DESC LIMIT ?",
            (ticker.upper(), limit))
        return [dict(r) for r in cur.fetchall()]

    def get_all_latest(self) -> List[dict]:
        """Get the most recent run for every distinct ticker."""
        cur = self.conn.execute("""
            SELECT a.* FROM analysis_runs a
            INNER JOIN (
                SELECT ticker, MAX(run_timestamp) AS max_ts
                FROM analysis_runs GROUP BY ticker
            ) b ON a.ticker = b.ticker AND a.run_timestamp = b.max_ts
            ORDER BY a.ticker
        """)
        return [dict(r) for r in cur.fetchall()]

    def get_trend(self, ticker: str, window: int = 5) -> Dict[str, Any]:
        """Analyse how quantamental rating changed over recent runs."""
        history = self.get_history(ticker, limit=window)
        if not history:
            return {'ticker': ticker, 'runs': 0}

        ratings = [h['qm_rating'] for h in history if h.get('qm_rating')]
        scores = [h['qm_score'] for h in history if h.get('qm_score') is not None]

        trend = 'stable'
        if len(scores) >= 2:
            if scores[0] - scores[-1] > 5:
                trend = 'improving'
            elif scores[-1] - scores[0] > 5:
                trend = 'deteriorating'

        return {
            'ticker': ticker,
            'runs': len(history),
            'current_rating': ratings[0] if ratings else None,
            'current_score': scores[0] if scores else None,
            'first_score': scores[-1] if scores else None,
            'score_change': round(scores[0] - scores[-1], 1) if len(scores) >= 2 else 0,
            'trend': trend,
            'history': [
                {'date': h['run_timestamp'][:10], 'rating': h['qm_rating'], 'score': h['qm_score']}
                for h in history
            ],
        }

    def get_portfolio_summary(self) -> List[dict]:
        """Latest snapshot of all tracked tickers with trend info."""
        latest = self.get_all_latest()
        if not latest:
            return []
        summary = []
        for row in latest:
            trend = self.get_trend(row['ticker'], window=5)
            summary.append({
                'ticker': row['ticker'],
                'date': row['run_timestamp'][:10],
                'price': row['price'],
                'qm_rating': row['qm_rating'],
                'qm_score': row['qm_score'],
                'tech_signal': row['tech_signal'],
                'tech_score': row['tech_score'],
                'fund_score': row['fund_score'],
                'cap_category': row['cap_category'],
                'trend': trend['trend'],
                'score_change': trend['score_change'],
                'history_runs': trend['runs'],
                'health_pass': (bool(row.get('health_pass')) if row.get('health_pass') is not None else None),
            })
        return summary

    # ── Maintenance ──

    def vacuum(self):
        self.conn.execute("VACUUM")
        self.conn.commit()

    def count_runs(self) -> int:
        cur = self.conn.execute("SELECT COUNT(*) FROM analysis_runs")
        return cur.fetchone()[0]

    def count_tickers(self) -> int:
        cur = self.conn.execute("SELECT COUNT(DISTINCT ticker) FROM analysis_runs")
        return cur.fetchone()[0]


# ── Quick test ──
if __name__ == '__main__':
    logging.basicConfig(level=logging.INFO)
    db = AnalysisDatabase()
    print(f"DB path: {db.db_path}")
    print(f"Runs: {db.count_runs()}, Tickers: {db.count_tickers()}")
    db.close()
