-- Long-term memory for the holographic dashboard (local SQLite).
-- No OpenRouter / UI / agent-router wiring in this module.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  day_key TEXT NOT NULL,                 -- YYYY-MM-DD (local dashboard day)
  prompt TEXT NOT NULL,
  response TEXT NOT NULL DEFAULT '',
  reliability_score REAL NOT NULL CHECK (reliability_score >= 0 AND reliability_score <= 1),
  meta_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_conversations_day ON conversations(day_key);
CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at);

CREATE TABLE IF NOT EXISTS conversation_sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  source_key TEXT NOT NULL,              -- one of the 17 research leads
  note TEXT NOT NULL DEFAULT '',
  UNIQUE (conversation_id, source_key)
);

CREATE INDEX IF NOT EXISTS idx_conv_sources_key ON conversation_sources(source_key);

-- Snapshot of that day's ranked businesses / activities
CREATE TABLE IF NOT EXISTS daily_tops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  day_key TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank >= 1),
  business_key TEXT NOT NULL,           -- stable slug/id for the business
  display_name TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  UNIQUE (day_key, rank),
  UNIQUE (day_key, business_key)
);

CREATE INDEX IF NOT EXISTS idx_daily_tops_day ON daily_tops(day_key);
CREATE INDEX IF NOT EXISTS idx_daily_tops_business ON daily_tops(business_key);

-- Secondary consistency ranking (month / year windows)
CREATE TABLE IF NOT EXISTS business_consistency (
  business_key TEXT NOT NULL,
  display_name TEXT NOT NULL,
  window_kind TEXT NOT NULL CHECK (window_kind IN ('month', 'year')),
  window_key TEXT NOT NULL,             -- YYYY-MM or YYYY
  appearance_count INTEGER NOT NULL DEFAULT 0,
  current_streak INTEGER NOT NULL DEFAULT 0,  -- consecutive days ending at last_seen_day
  max_streak INTEGER NOT NULL DEFAULT 0,
  first_seen_day TEXT,
  last_seen_day TEXT,
  consistency_score REAL NOT NULL DEFAULT 0, -- derived: frequency + streak bonus
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (business_key, window_kind, window_key)
);

CREATE INDEX IF NOT EXISTS idx_consistency_window
  ON business_consistency(window_kind, window_key, consistency_score DESC);

CREATE INDEX IF NOT EXISTS idx_consistency_streak
  ON business_consistency(window_kind, window_key, current_streak DESC);

-- Concept graph ("neural links")
CREATE TABLE IF NOT EXISTS concepts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  mention_count INTEGER NOT NULL DEFAULT 0,
  reliability_ema REAL NOT NULL DEFAULT 0.5
);

CREATE TABLE IF NOT EXISTS concept_links (
  from_concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  to_concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  weight REAL NOT NULL DEFAULT 1,
  evidence_count INTEGER NOT NULL DEFAULT 1,
  last_reinforced_at TEXT NOT NULL DEFAULT (datetime('now')),
  kind TEXT NOT NULL DEFAULT 'co_occurrence',
  PRIMARY KEY (from_concept_id, to_concept_id, kind),
  CHECK (from_concept_id != to_concept_id)
);

CREATE INDEX IF NOT EXISTS idx_links_weight ON concept_links(weight DESC);

CREATE TABLE IF NOT EXISTS conversation_concepts (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  concept_id INTEGER NOT NULL REFERENCES concepts(id) ON DELETE CASCADE,
  PRIMARY KEY (conversation_id, concept_id)
);

CREATE TABLE IF NOT EXISTS reorg_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER REFERENCES conversations(id) ON DELETE SET NULL,
  ran_at TEXT NOT NULL DEFAULT (datetime('now')),
  concepts_touched INTEGER NOT NULL DEFAULT 0,
  links_created INTEGER NOT NULL DEFAULT 0,
  links_updated INTEGER NOT NULL DEFAULT 0,
  notes TEXT NOT NULL DEFAULT ''
);
