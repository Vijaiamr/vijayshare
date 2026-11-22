-- ═══════════════════════════════════════════════════════════════════════
--  AIOps schema — SQLite (WAL). Idempotent (CREATE ... IF NOT EXISTS).
--  Immutability is enforced by triggers at the bottom.
-- ═══════════════════════════════════════════════════════════════════════

-- ── meta: key/value store (schema_version, prompt_version, hashes, ...) ──
CREATE TABLE IF NOT EXISTS meta (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── symbols: the universe ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS symbols (
  symbol     TEXT PRIMARY KEY,
  name       TEXT,
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── market_daily: observed daily bars (immutable; corrected data = new data_version) ──
CREATE TABLE IF NOT EXISTS market_daily (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol       TEXT NOT NULL,
  date         TEXT NOT NULL,               -- trading date YYYY-MM-DD
  open         REAL NOT NULL,
  high         REAL NOT NULL,
  low          REAL NOT NULL,
  close        REAL NOT NULL,
  volume       INTEGER,
  data_version TEXT NOT NULL DEFAULT 'v1',
  available_at TEXT NOT NULL,               -- when this bar became observable (close time)
  source       TEXT NOT NULL DEFAULT 'yfinance',
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(symbol, date, data_version)
);
CREATE INDEX IF NOT EXISTS idx_market_daily_symbol_date ON market_daily(symbol, date);

-- ── daily_runs: idempotency + chronology ────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  run_type          TEXT NOT NULL CHECK (run_type IN ('morning','evening','backtest')),
  run_date          TEXT NOT NULL,          -- trading day being processed (YYYY-MM-DD)
  status            TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed')),
  as_of             TEXT,                   -- temporal boundary used
  started_at        TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at       TEXT,
  prompt_version    TEXT,
  prompt_hash       TEXT,
  knowledge_version INTEGER,
  knowledge_hash    TEXT,
  model             TEXT,
  error             TEXT,
  UNIQUE(run_type, run_date)
);

-- ── agent_runs: full audit of every LLM interaction ─────────────────────
CREATE TABLE IF NOT EXISTS agent_runs (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  daily_run_id      INTEGER REFERENCES daily_runs(id),
  symbol            TEXT,
  turn              INTEGER NOT NULL DEFAULT 1,
  role              TEXT NOT NULL CHECK (role IN ('user','assistant','tool')),
  content           TEXT,
  tool_calls        TEXT,                   -- JSON
  model             TEXT,
  prompt_version    TEXT,
  prompt_hash       TEXT,
  knowledge_version INTEGER,
  knowledge_hash    TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_run ON agent_runs(daily_run_id);

-- ── predictions: immutable once locked ──────────────────────────────────
CREATE TABLE IF NOT EXISTS predictions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol            TEXT NOT NULL,
  run_date          TEXT NOT NULL,          -- trading day D
  direction         TEXT NOT NULL CHECK (direction IN ('up','down','flat')),
  confidence        REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  target_price      REAL,
  stop_price        REAL,
  rationale         TEXT,
  as_of             TEXT NOT NULL,          -- D 09:00 IST
  prompt_version    TEXT,
  prompt_hash       TEXT,
  knowledge_version INTEGER,
  knowledge_hash    TEXT,
  model             TEXT,
  locked_at         TEXT,                   -- when made immutable
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(symbol, run_date)
);
CREATE INDEX IF NOT EXISTS idx_predictions_date ON predictions(run_date);

-- ── validation: outcomes ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS validation (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  prediction_id    INTEGER NOT NULL REFERENCES predictions(id),
  symbol           TEXT NOT NULL,
  run_date         TEXT NOT NULL,
  actual_open      REAL,
  actual_close     REAL,
  actual_direction TEXT CHECK (actual_direction IN ('up','down','flat')),
  hit              INTEGER NOT NULL CHECK (hit IN (0,1)),
  error_pct        REAL,
  validated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  data_version     TEXT,
  UNIQUE(prediction_id)
);
CREATE INDEX IF NOT EXISTS idx_validation_date ON validation(run_date);

-- ── lessons: LLM proposes, Python validates/promotes ────────────────────
CREATE TABLE IF NOT EXISTS lessons (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol         TEXT,
  title          TEXT NOT NULL,
  body           TEXT NOT NULL,
  source_run_id  INTEGER,
  observations   INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','accepted','rejected')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── recipes: reusable playbooks ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS recipes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  body        TEXT NOT NULL,
  version     INTEGER NOT NULL DEFAULT 1,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── feedback: lesson → outcome ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS feedback (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lesson_id  INTEGER NOT NULL REFERENCES lessons(id),
  run_date   TEXT NOT NULL,
  outcome    TEXT,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── calibration: per-symbol confidence buckets ──────────────────────────
CREATE TABLE IF NOT EXISTS calibration (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol     TEXT NOT NULL,
  bucket     TEXT NOT NULL,                 -- e.g. '0.5-0.6'
  n          INTEGER NOT NULL DEFAULT 0,
  hits       INTEGER NOT NULL DEFAULT 0,
  hit_rate   REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(symbol, bucket)
);

-- ── knowledge: versioned knowledge entries ──────────────────────────────
CREATE TABLE IF NOT EXISTS knowledge (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL,                 -- 'recipe' | 'lesson' | 'rule' | 'positive' | 'negative'
  content    TEXT NOT NULL,
  version    INTEGER NOT NULL,
  hash       TEXT NOT NULL,
ref        TEXT,                          -- dedupe key (e.g. 'validator:SYM:2026-01-01', 'pattern:SYM:trend_up:positive')
  created_at TEXT DEFAULT (datetime('now'))
);
-- NOTE: idx_knowledge_ref_kind is created in engine.migrate() AFTER the ref
-- column migration so pre-ref databases upgrade cleanly.

-- ── fundamentals: point-in-time fundamentals snapshots (yfinance = current only; labeled as_of) ──
CREATE TABLE IF NOT EXISTS fundamentals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  as_of TEXT NOT NULL,               -- date the snapshot pertains to
  pe REAL, pb REAL, roe REAL, market_cap REAL, dividend_yield REAL,
  sector TEXT, industry TEXT,
  source TEXT NOT NULL DEFAULT 'yfinance',
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(symbol, as_of, source)
);

-- ── pattern_stats: per-symbol pattern outcome aggregates (knowledge accumulation) ──
CREATE TABLE IF NOT EXISTS pattern_stats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  pattern TEXT NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  hits INTEGER NOT NULL DEFAULT 0,
  hit_rate REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(symbol, pattern)
);

-- ═══════════════════════════════════════════════════════════════════════
--  Immutability triggers
-- ═══════════════════════════════════════════════════════════════════════

-- market_daily is immutable: corrected data = INSERT with new data_version.
CREATE TRIGGER IF NOT EXISTS trg_market_daily_immutable
BEFORE UPDATE ON market_daily
FOR EACH ROW
BEGIN
  SELECT RAISE(ABORT, 'market_daily is immutable; insert a new data_version instead');
END;

-- predictions are immutable once locked.
CREATE TRIGGER IF NOT EXISTS trg_predictions_immutable
BEFORE UPDATE ON predictions
FOR EACH ROW
WHEN OLD.locked_at IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'predictions are immutable once locked');
END;