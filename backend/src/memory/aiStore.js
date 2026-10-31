import { getDb } from "./db.js";

function dayKeyInTz(tz = "Europe/Berlin", d = new Date()) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

export function ensureAiSchema(db = getDb()) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_usage_daily (
      day_key TEXT PRIMARY KEY,
      spent_usd REAL NOT NULL DEFAULT 0,
      spent_eur REAL NOT NULL DEFAULT 0,
      router_calls INTEGER NOT NULL DEFAULT 0,
      main_calls INTEGER NOT NULL DEFAULT 0,
      grok_calls INTEGER NOT NULL DEFAULT 0,
      blocked_escalations INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ai_usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_key TEXT NOT NULL,
      tier TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      cost_eur REAL NOT NULL DEFAULT 0,
      blocked INTEGER NOT NULL DEFAULT 0,
      note TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS briefing_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_key TEXT NOT NULL,
      q1 TEXT NOT NULL DEFAULT '',
      q2 TEXT NOT NULL DEFAULT '',
      q3 TEXT NOT NULL DEFAULT '',
      briefing_text TEXT NOT NULL DEFAULT '',
      suggestions_json TEXT NOT NULL DEFAULT '[]',
      news_ids_json TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ai_suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_key TEXT NOT NULL,
      area TEXT NOT NULL,
      issue TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '',
      effort TEXT NOT NULL DEFAULT 'm',
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS world_news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      url TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT '',
      lat REAL,
      lon REAL,
      published_at TEXT,
      fetched_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_world_news_fetched ON world_news(fetched_at DESC);
  `);
}

export function getUsageDay(dayKey, db = getDb()) {
  ensureAiSchema(db);
  const row = db.prepare(`SELECT * FROM ai_usage_daily WHERE day_key = ?`).get(dayKey);
  if (row) return row;
  db.prepare(`INSERT OR IGNORE INTO ai_usage_daily (day_key) VALUES (?)`).run(dayKey);
  return db.prepare(`SELECT * FROM ai_usage_daily WHERE day_key = ?`).get(dayKey);
}

export function recordAiSpend(
  {
    dayKey,
    tier,
    model,
    promptTokens = 0,
    completionTokens = 0,
    costUsd = 0,
    costEur = 0,
    blocked = false,
    note = "",
  },
  db = getDb(),
) {
  ensureAiSchema(db);
  getUsageDay(dayKey, db);
  db.prepare(
    `INSERT INTO ai_usage_events
      (day_key, tier, model, prompt_tokens, completion_tokens, cost_usd, cost_eur, blocked, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    dayKey,
    tier,
    model,
    promptTokens,
    completionTokens,
    costUsd,
    costEur,
    blocked ? 1 : 0,
    note,
  );
  if (!blocked && costEur > 0) {
    const routerInc = tier === "router" ? 1 : 0;
    const mainInc = tier === "main" ? 1 : 0;
    const grokInc = tier === "grok" ? 1 : 0;
    // Migrate older DBs missing grok_calls
    try {
      db.exec(`ALTER TABLE ai_usage_daily ADD COLUMN grok_calls INTEGER NOT NULL DEFAULT 0`);
    } catch {
      /* column exists */
    }
    db.prepare(
      `UPDATE ai_usage_daily SET
        spent_usd = spent_usd + ?,
        spent_eur = spent_eur + ?,
        router_calls = router_calls + ?,
        main_calls = main_calls + ?,
        grok_calls = grok_calls + ?,
        updated_at = datetime('now')
       WHERE day_key = ?`,
    ).run(costUsd, costEur, routerInc, mainInc, grokInc, dayKey);
  }
  if (blocked && (tier === "main" || tier === "grok")) {
    db.prepare(
      `UPDATE ai_usage_daily SET blocked_escalations = blocked_escalations + 1, updated_at = datetime('now')
       WHERE day_key = ?`,
    ).run(dayKey);
  }
  return getUsageDay(dayKey, db);
}

export function saveBriefingSession({ dayKey, q1, q2, q3, briefingText, suggestions, newsIds }, db = getDb()) {
  ensureAiSchema(db);
  const r = db
    .prepare(
      `INSERT INTO briefing_sessions (day_key, q1, q2, q3, briefing_text, suggestions_json, news_ids_json)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      dayKey,
      q1 || "",
      q2 || "",
      q3 || "",
      briefingText || "",
      JSON.stringify(suggestions || []),
      JSON.stringify(newsIds || []),
    );
  return Number(r.lastInsertRowid);
}

export function latestBriefingForDay(dayKey, db = getDb()) {
  ensureAiSchema(db);
  return db
    .prepare(`SELECT * FROM briefing_sessions WHERE day_key = ? ORDER BY id DESC LIMIT 1`)
    .get(dayKey);
}

export function insertSuggestions(dayKey, suggestions, db = getDb()) {
  ensureAiSchema(db);
  const ins = db.prepare(
    `INSERT INTO ai_suggestions (day_key, area, issue, evidence, effort, status)
     VALUES (?, ?, ?, ?, ?, 'new')`,
  );
  for (const s of suggestions || []) {
    ins.run(dayKey, s.area || "general", s.issue || "", s.evidence || "", s.effort || "m");
  }
}

export function listSuggestions(dayKey, limit = 20, db = getDb()) {
  ensureAiSchema(db);
  return db
    .prepare(
      `SELECT * FROM ai_suggestions WHERE day_key = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(dayKey, limit);
}

export function upsertNewsItems(items, db = getDb()) {
  ensureAiSchema(db);
  const upsert = db.prepare(
    `INSERT INTO world_news (external_id, title, summary, url, source, lat, lon, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(external_id) DO UPDATE SET
       title = excluded.title,
       summary = excluded.summary,
       url = excluded.url,
       source = excluded.source,
       lat = excluded.lat,
       lon = excluded.lon,
       published_at = excluded.published_at,
       fetched_at = datetime('now')`,
  );
  for (const it of items || []) {
    upsert.run(
      it.external_id,
      it.title,
      it.summary || "",
      it.url || "",
      it.source || "",
      it.lat ?? null,
      it.lon ?? null,
      it.published_at || null,
    );
  }
}

export function listLatestNews(limit = 12, db = getDb()) {
  ensureAiSchema(db);
  return db
    .prepare(`SELECT * FROM world_news ORDER BY fetched_at DESC, id DESC LIMIT ?`)
    .all(limit);
}

export { dayKeyInTz };
