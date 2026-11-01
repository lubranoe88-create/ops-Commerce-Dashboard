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
      action_json TEXT NOT NULL DEFAULT '',
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
    CREATE TABLE IF NOT EXISTS ai_user_prefs (
      pref_key TEXT PRIMARY KEY,
      pref_value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ai_client_memory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_key TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ai_tracked_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_key TEXT NOT NULL,
      suggestion_id INTEGER,
      area TEXT NOT NULL DEFAULT '',
      issue TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS ai_proactive_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_key TEXT NOT NULL,
      kind TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      delivered INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_world_news_fetched ON world_news(fetched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_events_day ON ai_usage_events(day_key, id DESC);
    CREATE INDEX IF NOT EXISTS idx_ai_proactive_day ON ai_proactive_events(day_key, delivered, id);
    CREATE TABLE IF NOT EXISTS ai_function_reports (
      function_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'unverified',
      error_type TEXT NOT NULL DEFAULT '',
      detail TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'ai',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  try {
    db.exec(`ALTER TABLE ai_suggestions ADD COLUMN action_json TEXT NOT NULL DEFAULT ''`);
  } catch {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE ai_usage_daily ADD COLUMN grok_calls INTEGER NOT NULL DEFAULT 0`);
  } catch {
    /* exists */
  }
}

export function getUsageDay(dayKey, db = getDb()) {
  ensureAiSchema(db);
  const row = db.prepare(`SELECT * FROM ai_usage_daily WHERE day_key = ?`).get(dayKey);
  if (row) return row;
  db.prepare(`INSERT OR IGNORE INTO ai_usage_daily (day_key) VALUES (?)`).run(dayKey);
  return db.prepare(`SELECT * FROM ai_usage_daily WHERE day_key = ?`).get(dayKey);
}

export function listUsageEvents(dayKey, limit = 50, db = getDb()) {
  ensureAiSchema(db);
  return db
    .prepare(
      `SELECT id, day_key, tier, model, prompt_tokens, completion_tokens, cost_usd, cost_eur, blocked, note, created_at
       FROM ai_usage_events WHERE day_key = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(dayKey, limit);
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
    `INSERT INTO ai_suggestions (day_key, area, issue, evidence, effort, action_json, status)
     VALUES (?, ?, ?, ?, ?, ?, 'new')`,
  );
  const ids = [];
  for (const s of suggestions || []) {
    const action =
      s.action != null
        ? typeof s.action === "string"
          ? s.action
          : JSON.stringify(s.action)
        : "";
    const r = ins.run(
      dayKey,
      s.area || "general",
      s.issue || "",
      s.evidence || "",
      s.effort || "m",
      action,
    );
    ids.push(Number(r.lastInsertRowid));
  }
  return ids;
}

export function listSuggestions(dayKey, limit = 20, db = getDb()) {
  ensureAiSchema(db);
  return db
    .prepare(
      `SELECT * FROM ai_suggestions WHERE day_key = ? ORDER BY id DESC LIMIT ?`,
    )
    .all(dayKey, limit)
    .map((row) => ({
      ...row,
      action: safeParse(row.action_json, null),
    }));
}

export function getSuggestion(id, db = getDb()) {
  ensureAiSchema(db);
  const row = db.prepare(`SELECT * FROM ai_suggestions WHERE id = ?`).get(id);
  if (!row) return null;
  return { ...row, action: safeParse(row.action_json, null) };
}

export function acceptSuggestion(id, { track = true } = {}, db = getDb()) {
  ensureAiSchema(db);
  const row = getSuggestion(id, db);
  if (!row) return null;
  db.prepare(
    `UPDATE ai_suggestions SET status = 'accepted' WHERE id = ?`,
  ).run(id);
  let taskId = null;
  if (track) {
    const r = db
      .prepare(
        `INSERT INTO ai_tracked_tasks (day_key, suggestion_id, area, issue, status)
         VALUES (?, ?, ?, ?, 'open')`,
      )
      .run(row.day_key, id, row.area, row.issue);
    taskId = Number(r.lastInsertRowid);
  }
  return { suggestion: getSuggestion(id, db), taskId, actions: normalizeAction(row.action) };
}

export function upsertUserPref(key, value, db = getDb()) {
  ensureAiSchema(db);
  db.prepare(
    `INSERT INTO ai_user_prefs (pref_key, pref_value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(pref_key) DO UPDATE SET
       pref_value = excluded.pref_value,
       updated_at = datetime('now')`,
  ).run(String(key).slice(0, 120), typeof value === "string" ? value : JSON.stringify(value));
}

export function getUserPref(key, db = getDb()) {
  ensureAiSchema(db);
  const row = db.prepare(`SELECT * FROM ai_user_prefs WHERE pref_key = ?`).get(String(key));
  if (!row) return null;
  return { key: row.pref_key, value: safeParse(row.pref_value, row.pref_value), updated_at: row.updated_at };
}

export function listUserPrefs(db = getDb()) {
  ensureAiSchema(db);
  return db
    .prepare(`SELECT pref_key, pref_value, updated_at FROM ai_user_prefs ORDER BY pref_key`)
    .all()
    .map((r) => ({
      key: r.pref_key,
      value: safeParse(r.pref_value, r.pref_value),
      updated_at: r.updated_at,
    }));
}

export function syncClientMemory(dayKey, payload, db = getDb()) {
  ensureAiSchema(db);
  const json = JSON.stringify(payload || {});
  const existing = db
    .prepare(`SELECT id FROM ai_client_memory WHERE day_key = ? ORDER BY id DESC LIMIT 1`)
    .get(dayKey);
  if (existing) {
    db.prepare(
      `UPDATE ai_client_memory SET payload_json = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(json, existing.id);
    return existing.id;
  }
  const r = db
    .prepare(
      `INSERT INTO ai_client_memory (day_key, payload_json) VALUES (?, ?)`,
    )
    .run(dayKey, json);
  return Number(r.lastInsertRowid);
}

export function getClientMemory(dayKey, db = getDb()) {
  ensureAiSchema(db);
  const row = db
    .prepare(
      `SELECT * FROM ai_client_memory WHERE day_key = ? ORDER BY id DESC LIMIT 1`,
    )
    .get(dayKey);
  if (!row) return { dayKey, payload: {} };
  return { dayKey, payload: safeParse(row.payload_json, {}), updated_at: row.updated_at };
}

export function pushProactiveEvent(dayKey, kind, payload, db = getDb()) {
  ensureAiSchema(db);
  const r = db
    .prepare(
      `INSERT INTO ai_proactive_events (day_key, kind, payload_json, delivered)
       VALUES (?, ?, ?, 0)`,
    )
    .run(dayKey, kind, JSON.stringify(payload || {}));
  return Number(r.lastInsertRowid);
}

export function listUndeliveredProactive(dayKey, limit = 20, db = getDb()) {
  ensureAiSchema(db);
  return db
    .prepare(
      `SELECT * FROM ai_proactive_events
       WHERE day_key = ? AND delivered = 0
       ORDER BY id ASC LIMIT ?`,
    )
    .all(dayKey, limit)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      payload: safeParse(r.payload_json, {}),
      created_at: r.created_at,
    }));
}

export function markProactiveDelivered(ids, db = getDb()) {
  ensureAiSchema(db);
  if (!ids?.length) return;
  const stmt = db.prepare(`UPDATE ai_proactive_events SET delivered = 1 WHERE id = ?`);
  for (const id of ids) stmt.run(id);
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

function safeParse(raw, fallback) {
  if (raw == null || raw === "") return fallback;
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeAction(action) {
  if (!action) return [];
  if (Array.isArray(action)) return action;
  if (typeof action === "string") return [action];
  if (typeof action === "object" && action.type) return [action];
  return [];
}

export function upsertFunctionReport(
  { functionId, status, errorType = "", detail = "", source = "ai" },
  db = getDb(),
) {
  ensureAiSchema(db);
  db.prepare(
    `INSERT INTO ai_function_reports (function_id, status, error_type, detail, source, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(function_id) DO UPDATE SET
       status = excluded.status,
       error_type = excluded.error_type,
       detail = excluded.detail,
       source = excluded.source,
       updated_at = datetime('now')`,
  ).run(
    functionId,
    status,
    errorType || "",
    detail || "",
    source || "ai",
  );
}

export function listFunctionReports(limit = 80, db = getDb()) {
  ensureAiSchema(db);
  return db
    .prepare(
      `SELECT function_id, status, error_type, detail, source, updated_at
       FROM ai_function_reports
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .all(limit)
    .map((r) => ({
      functionId: r.function_id,
      status: r.status,
      errorType: r.error_type,
      detail: r.detail,
      source: r.source,
      updatedAt: r.updated_at,
    }));
}

export function clearFunctionReport(functionId, db = getDb()) {
  ensureAiSchema(db);
  db.prepare(`DELETE FROM ai_function_reports WHERE function_id = ?`).run(functionId);
}

export { dayKeyInTz };
