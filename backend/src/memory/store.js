import { getDb, openMemoryDb } from "./db.js";
import { recordBusinessAppearance, getConsistencyRanking } from "./consistency.js";
import { reorganizeAfterConversation } from "./reorganize.js";

const SOURCES = [
  { key: "filing", label: "01 Filing legali", strength: "strong" },
  { key: "marketplace_b2b", label: "02 Marketplace B2B", strength: "medium" },
  { key: "forums_telegram", label: "03 Forum / Telegram", strength: "weak" },
  { key: "satellite", label: "04 Satellitari", strength: "medium" },
  { key: "indie", label: "05 Piattaforme indie", strength: "medium" },
  { key: "indie_hackers", label: "06 Community founder", strength: "weak" },
  { key: "invoicing", label: "07 Report fatturazione", strength: "medium" },
  { key: "accelerator", label: "08 Accelerator", strength: "medium" },
  { key: "acquisitions", label: "09 Database acquisizioni", strength: "medium" },
  { key: "licenses", label: "10 Licenze", strength: "medium" },
  { key: "customs", label: "11 Dogane", strength: "medium" },
  { key: "whois", label: "12 WHOIS", strength: "weak" },
  { key: "hiring", label: "13 Hiring", strength: "medium" },
  { key: "offshore", label: "14 Offshore / holding", strength: "medium" },
  { key: "reviews", label: "15 Recensioni", strength: "weak" },
  { key: "web_traffic", label: "16 Traffico web", strength: "medium" },
  { key: "bm_patents", label: "17 Brevetti BM", strength: "medium" },
];

function dayKey(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function ensureExtraSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_corrections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_key TEXT NOT NULL,
      business_key TEXT NOT NULL,
      rank_at_time INTEGER,
      verdict TEXT NOT NULL CHECK (verdict IN ('correct','incorrect')),
      reason_line TEXT NOT NULL DEFAULT '',
      rule_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS pipeline_source_stats (
      day_key TEXT NOT NULL,
      source_key TEXT NOT NULL,
      daily_search_volume INTEGER NOT NULL DEFAULT 0,
      verification_status TEXT NOT NULL DEFAULT 'unverified',
      attached_agents TEXT NOT NULL DEFAULT '[]',
      PRIMARY KEY (day_key, source_key)
    );
    CREATE TABLE IF NOT EXISTS pipeline_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      day_key TEXT NOT NULL,
      source_key TEXT NOT NULL,
      severity TEXT NOT NULL,
      cause_code TEXT NOT NULL,
      cause_text TEXT NOT NULL,
      impact TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS coverage_areas (
      area_key TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'geo',
      coverage_degree REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chat_threads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id INTEGER NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      speech_input INTEGER NOT NULL DEFAULT 0,
      attachment_name TEXT NOT NULL DEFAULT '',
      attachment_mime TEXT NOT NULL DEFAULT '',
      attachment_text TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mechanical_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      business_key TEXT,
      rule_type TEXT NOT NULL,
      payload_json TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

export function initDashboardStore() {
  const db = openMemoryDb();
  ensureExtraSchema(db);
  seedIfEmpty(db);
  return db;
}

function seedIfEmpty(db) {
  const day = dayKey();
  const n = db.prepare("SELECT COUNT(*) AS c FROM daily_tops WHERE day_key = ?").get(day).c;
  if (n > 0) return;

  const businesses = [
    { key: "northwind-logistics", name: "Northwind Logistics", score: 0.92, lat: 51.5, lon: -0.12, sector: "logistics" },
    { key: "sahel-solar-coops", name: "Sahel Solar Co-ops", score: 0.88, lat: 12.6, lon: -8.0, sector: "energy" },
    { key: "baltic-fresh-pack", name: "Baltic Fresh Pack", score: 0.84, lat: 59.4, lon: 24.7, sector: "food" },
    { key: "andes-fiber-net", name: "Andes Fiber Net", score: 0.81, lat: -12.0, lon: -77.0, sector: "telecom" },
    { key: "mekong-spare-parts", name: "Mekong Spare Parts", score: 0.79, lat: 10.8, lon: 106.7, sector: "industrial" },
    { key: "lagos-micro-ftl", name: "Lagos Micro FTL", score: 0.77, lat: 6.5, lon: 3.4, sector: "logistics" },
    { key: "osaka-tooling", name: "Osaka Tooling Guild", score: 0.74, lat: 34.7, lon: 135.5, sector: "manufacturing" },
    { key: "patagonia-wool", name: "Patagonia Wool Direct", score: 0.71, lat: -41.1, lon: -71.3, sector: "apparel" },
  ];

  const insertTop = db.prepare(
    `INSERT OR IGNORE INTO daily_tops (day_key, rank, business_key, display_name, score, payload_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  businesses.forEach((b, i) => {
    insertTop.run(
      day,
      i + 1,
      b.key,
      b.name,
      b.score,
      JSON.stringify({ lat: b.lat, lon: b.lon, sector: b.sector, sources: ["filing", "customs"] }),
    );
    recordBusinessAppearance({
      businessKey: b.key,
      displayName: b.name,
      dayKey: day,
    });
  });

  const agentsBySource = {
    filing: ["browser-use", "finrobot", "pyod"],
    marketplace_b2b: ["browser-use", "pyod"],
    forums_telegram: ["browser-use", "pyod"],
    satellite: ["browser-use", "pyod"],
    indie: ["browser-use", "pyod"],
    indie_hackers: ["browser-use"],
    invoicing: ["browser-use", "pyod"],
    accelerator: ["browser-use"],
    acquisitions: ["browser-use", "finrobot"],
    licenses: ["browser-use", "pyod"],
    customs: ["browser-use", "pyod"],
    whois: ["browser-use", "pyod"],
    hiring: ["browser-use", "pyod"],
    offshore: ["browser-use", "finrobot", "openbusiness"],
    reviews: ["browser-use", "fingpt", "pyod"],
    web_traffic: ["browser-use", "pyod"],
    bm_patents: ["browser-use", "openbusiness"],
  };

  const upsertSrc = db.prepare(
    `INSERT OR IGNORE INTO pipeline_source_stats
      (day_key, source_key, daily_search_volume, verification_status, attached_agents)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const s of SOURCES) {
    const vol = 40 + Math.floor(Math.random() * 120);
    const status =
      s.strength === "strong"
        ? "verified"
        : s.strength === "weak"
          ? Math.random() > 0.5
            ? "partial"
            : "unverified"
          : "verified";
    upsertSrc.run(day, s.key, vol, status, JSON.stringify(agentsBySource[s.key] || ["browser-use"]));
  }

  const errCount = db
    .prepare(`SELECT COUNT(*) AS c FROM pipeline_errors WHERE day_key = ?`)
    .get(day).c;
  if (errCount === 0) {
    // Seed as resolved samples so the ops registry has content without
    // forcing the health badge into degraded/bad on every new day.
    db.prepare(
      `INSERT INTO pipeline_errors (day_key, source_key, severity, cause_code, cause_text, impact, status)
       VALUES (?, 'forums_telegram', 'suspicious', 'tos_block', 'Access throttled on import group scrape', 'quarantine', 'resolved'),
              (?, 'whois', 'failed', 'timeout', 'RDAP upstream timeout', 'retry_scheduled', 'resolved')`,
    ).run(day, day);
  }

  // Coverage + concepts are global (not day-scoped) — only seed once.
  const areas = [
    ["eu", "Europa", "geo", 72],
    ["na", "Nord America", "geo", 65],
    ["ssa", "Africa sub-sahariana", "geo", 28],
    ["sea", "Sud-est Asia", "geo", 44],
    ["latam", "America Latina", "geo", 38],
    ["logistics", "Settore logistica", "sector", 55],
  ];
  const cov = db.prepare(
    `INSERT OR IGNORE INTO coverage_areas (area_key, label, kind, coverage_degree) VALUES (?, ?, ?, ?)`,
  );
  for (const a of areas) cov.run(...a);

  const conceptCount = db.prepare(`SELECT COUNT(*) AS c FROM concepts`).get().c;
  if (conceptCount === 0) {
    const concepts = [
      "revenue-proxy",
      "supply-bottleneck",
      "insolvency-signal",
      "hiring-surge",
      "offshore-holding",
      "verified-filing",
    ];
    const insC = db.prepare(
      `INSERT INTO concepts (slug, label, mention_count, reliability_ema) VALUES (?, ?, ?, ?)`,
    );
    const ids = [];
    for (const c of concepts) {
      const r = insC.run(c, c.replace(/-/g, " "), 3 + Math.floor(Math.random() * 10), 0.55 + Math.random() * 0.4);
      ids.push(Number(r.lastInsertRowid));
    }
    const link = db.prepare(
      `INSERT OR IGNORE INTO concept_links (from_concept_id, to_concept_id, weight, evidence_count)
       VALUES (?, ?, ?, ?)`,
    );
    for (let i = 0; i < ids.length - 1; i++) {
      link.run(ids[i], ids[i + 1], 1 + i, 1 + i);
    }
  }
}

export function getSourcesCatalog() {
  return SOURCES;
}

export function getDashboardSnapshot() {
  const db = getDb();
  // Day rollover while the process stays up: reseed today's demo data if empty.
  seedIfEmpty(db);
  const day = dayKey();
  const tops = db
    .prepare(
      `SELECT rank, business_key, display_name, score, payload_json FROM daily_tops
       WHERE day_key = ? ORDER BY rank ASC`,
    )
    .all(day)
    .map((t) => ({
      ...t,
      payload: JSON.parse(t.payload_json || "{}"),
    }));

  const activeRules = db
    .prepare(`SELECT business_key FROM mechanical_rules WHERE active = 1 AND business_key IS NOT NULL`)
    .all()
    .map((r) => r.business_key);
  const filteredTops = tops.filter((t) => !activeRules.includes(t.business_key));

  const sources = SOURCES.map((s) => {
    const row = db
      .prepare(
        `SELECT daily_search_volume, verification_status, attached_agents FROM pipeline_source_stats
         WHERE day_key = ? AND source_key = ?`,
      )
      .get(day, s.key);
    return {
      ...s,
      daily_search_volume: row?.daily_search_volume ?? 0,
      verification_status: row?.verification_status ?? "unverified",
      attached_agents: JSON.parse(row?.attached_agents || "[]"),
    };
  });

  const errors = db
    .prepare(
      `SELECT id, source_key, severity, cause_code, cause_text, impact, status, created_at
       FROM pipeline_errors WHERE day_key = ? ORDER BY id DESC`,
    )
    .all(day);

  const verifiedCount = sources.filter((s) => s.verification_status === "verified").length;
  const openErrors = errors.filter((e) => e.status === "open").length;
  const avgVol =
    sources.reduce((a, s) => a + s.daily_search_volume, 0) / Math.max(sources.length, 1);
  const health = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (verifiedCount / sources.length) * 55 +
          Math.min(avgVol / 150, 1) * 30 +
          Math.max(0, 15 - openErrors * 5),
      ),
    ),
  );

  const coverage = db.prepare(`SELECT * FROM coverage_areas ORDER BY area_key`).all();
  const concepts = db
    .prepare(`SELECT id, slug, label, mention_count, reliability_ema, last_seen_at FROM concepts`)
    .all();
  const links = db
    .prepare(
      `SELECT from_concept_id, to_concept_id, weight, evidence_count, kind FROM concept_links`,
    )
    .all();
  const consistency = getConsistencyRanking({ windowKind: "month", limit: 15 });

  const VERIFICATION_THRESHOLD = Number(process.env.VERIFICATION_THRESHOLD || 0.72);
  const coverageMapped = coverage.map((c) => ({
    id: c.area_key,
    domain: c.label,
    kind: c.kind,
    pct: Math.min(1, Math.max(0, (c.coverage_degree || 0) / 100)),
    note: `${c.kind} coverage`,
  }));
  const coverageAvg =
    coverageMapped.reduce((s, c) => s + c.pct, 0) / Math.max(coverageMapped.length, 1);

  const healthStatus = health >= 75 ? "ok" : health >= 50 ? "degraded" : "bad";

  const pipelineNodes = sources.map((s, i) => ({
    id: s.key,
    label: s.label.replace(/^\d+\s+/, "").slice(0, 22),
    layer: Math.floor(i / 4),
    kind: s.strength,
    health:
      s.verification_status === "verified"
        ? "ok"
        : s.verification_status === "partial"
          ? "warn"
          : "bad",
  }));
  // Judge / memory layers
  pipelineNodes.push(
    { id: "pyod", label: "PyOD filter", layer: 5, kind: "filter", health: "ok" },
    { id: "router", label: "Agent router", layer: 6, kind: "router", health: openErrors ? "warn" : "ok" },
    { id: "judge", label: "OpenRouter judge", layer: 7, kind: "ai", health: "ok" },
    { id: "memory", label: "SQLite memory", layer: 8, kind: "memory", health: "ok" },
  );
  const pipelineEdges = [];
  for (let i = 0; i < sources.length; i++) {
    const from = sources[i].key;
    const toLayer = Math.floor(i / 4) < 4 ? "pyod" : "pyod";
    pipelineEdges.push({ from, to: toLayer });
  }
  pipelineEdges.push(
    { from: "pyod", to: "router" },
    { from: "router", to: "judge" },
    { from: "judge", to: "memory" },
  );

  const conceptNodes = concepts.map((c, i) => ({
    id: String(c.id),
    label: c.label || c.slug,
    importance: Math.min(1, (c.reliability_ema || 0.5)),
    recency: 0.3 + (i % 5) * 0.12,
    dimension: i % 5,
  }));
  const conceptLinks = links.map((l) => ({
    from: String(l.from_concept_id),
    to: String(l.to_concept_id),
    weight: l.weight,
  }));

  const topsUi = filteredTops.map((t) => ({
    id: t.business_key,
    title: t.display_name,
    score: t.score,
    rank: t.rank,
    region: t.payload?.sector || "",
    source: (t.payload?.sources || []).join(", "),
    lat: t.payload?.lat,
    lon: t.payload?.lon,
    verified: t.score >= VERIFICATION_THRESHOLD,
    business_key: t.business_key,
  }));

  return {
    day_key: day,
    tops: topsUi,
    sources,
    errors: errors.map((e) => ({
      id: String(e.id),
      code: e.cause_code,
      message: e.cause_text,
      severity: e.severity,
      source: e.source_key,
      status: e.status,
      impact: e.impact,
    })),
    pipeline_health: health,
    health: {
      status: healthStatus,
      score: health,
      openErrors,
      verificationThreshold: VERIFICATION_THRESHOLD,
      coverageAvg,
    },
    verification: {
      threshold: VERIFICATION_THRESHOLD,
      mode: "tiered",
      rule: "strong alone OR ≥2 weak/medium corroborating",
    },
    coverage: coverageMapped,
    pipeline: { nodes: pipelineNodes, edges: pipelineEdges },
    memory: { concepts: conceptNodes, links: conceptLinks },
    concepts,
    links,
    consistency,
    mechanical_rules_active: activeRules.length,
  };
}

export function applyUserCorrection({ businessKey, rank, verdict, reasonLine }) {
  const db = getDb();
  const day = dayKey();
  db.prepare(
    `INSERT INTO user_corrections (day_key, business_key, rank_at_time, verdict, reason_line, rule_active)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(day, businessKey, rank ?? null, verdict, reasonLine || "", verdict === "incorrect" ? 1 : 0);

  if (verdict === "incorrect") {
    db.prepare(
      `INSERT INTO mechanical_rules (business_key, rule_type, payload_json, active)
       VALUES (?, 'exclude_business', ?, 1)`,
    ).run(businessKey, JSON.stringify({ reason: reasonLine || "user_incorrect" }));
  }
  return { ok: true };
}

export function evaluateVerification({ signals }) {
  // Raised threshold: strong alone still verifies; otherwise need ≥2
  // independent weak/medium signals (single medium is only partial).
  const catalog = Object.fromEntries(SOURCES.map((s) => [s.key, s]));
  const normalized = (signals || []).map((s) => ({
    ...s,
    strength: s.strength || catalog[s.source_key]?.strength || "weak",
  }));
  const threshold = Number(process.env.VERIFICATION_THRESHOLD || 0.72);
  if (normalized.some((s) => s.strength === "strong")) {
    return { status: "verified", reason: "strong_standalone", threshold };
  }
  const weakOrMedium = normalized.filter((s) => s.strength !== "strong");
  if (weakOrMedium.length >= 2) {
    return { status: "verified", reason: "corroborated", threshold };
  }
  if (weakOrMedium.length === 1 && weakOrMedium[0].strength === "medium") {
    return { status: "partial", reason: "single_medium_raised_bar", threshold };
  }
  return { status: "unverified", reason: "needs_corroboration", threshold };
}

export function listChatThreads() {
  return getDb()
    .prepare(`SELECT id, title, created_at, updated_at FROM chat_threads ORDER BY updated_at DESC`)
    .all();
}

export function createChatThread(title = "Nuova chat") {
  const db = getDb();
  const r = db.prepare(`INSERT INTO chat_threads (title) VALUES (?)`).run(title);
  return { id: Number(r.lastInsertRowid), title };
}

export function getChatMessages(threadId) {
  const db = getDb();
  try {
    return db
      .prepare(
        `SELECT id, role, content, speech_input, attachment_name, attachment_mime, attachment_text, created_at
         FROM chat_messages WHERE thread_id = ? ORDER BY id ASC`,
      )
      .all(threadId);
  } catch {
    return db
      .prepare(
        `SELECT id, role, content, speech_input, created_at FROM chat_messages
         WHERE thread_id = ? ORDER BY id ASC`,
      )
      .all(threadId);
  }
}

export function appendChatMessage(
  threadId,
  {
    role,
    content,
    speechInput = false,
    attachmentName = "",
    attachmentMime = "",
    attachmentText = "",
  },
) {
  const db = getDb();
  try {
    db.exec(`ALTER TABLE chat_messages ADD COLUMN attachment_name TEXT NOT NULL DEFAULT ''`);
  } catch {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE chat_messages ADD COLUMN attachment_mime TEXT NOT NULL DEFAULT ''`);
  } catch {
    /* exists */
  }
  try {
    db.exec(`ALTER TABLE chat_messages ADD COLUMN attachment_text TEXT NOT NULL DEFAULT ''`);
  } catch {
    /* exists */
  }
  db.prepare(
    `INSERT INTO chat_messages
      (thread_id, role, content, speech_input, attachment_name, attachment_mime, attachment_text)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    threadId,
    role,
    content,
    speechInput ? 1 : 0,
    attachmentName || "",
    attachmentMime || "",
    attachmentText || "",
  );
  db.prepare(`UPDATE chat_threads SET updated_at = datetime('now') WHERE id = ?`).run(threadId);
}

function ensureChatAttachmentColumns(db = getDb()) {
  for (const col of [
    "attachment_name TEXT NOT NULL DEFAULT ''",
    "attachment_mime TEXT NOT NULL DEFAULT ''",
    "attachment_text TEXT NOT NULL DEFAULT ''",
  ]) {
    try {
      db.exec(`ALTER TABLE chat_messages ADD COLUMN ${col}`);
    } catch {
      /* exists */
    }
  }
}

/** Cross-thread memory: recent messages matching a query across all threads. */
export function searchCrossThreadMemory(query, { limit = 20, excludeThreadId = null } = {}) {
  const db = getDb();
  ensureChatAttachmentColumns(db);
  const q = String(query || "").trim();
  if (!q) {
    return db
      .prepare(
        `SELECT m.id, m.thread_id, t.title AS thread_title, m.role, m.content, m.speech_input,
                m.attachment_name, m.created_at
         FROM chat_messages m
         JOIN chat_threads t ON t.id = m.thread_id
         ORDER BY m.id DESC LIMIT ?`,
      )
      .all(limit);
  }
  const like = `%${q.replace(/[%_]/g, "")}%`;
  if (excludeThreadId) {
    return db
      .prepare(
        `SELECT m.id, m.thread_id, t.title AS thread_title, m.role, m.content, m.speech_input,
                m.attachment_name, m.created_at
         FROM chat_messages m
         JOIN chat_threads t ON t.id = m.thread_id
         WHERE m.thread_id != ?
           AND (m.content LIKE ? OR m.attachment_text LIKE ? OR m.attachment_name LIKE ?)
         ORDER BY m.id DESC LIMIT ?`,
      )
      .all(excludeThreadId, like, like, like, limit);
  }
  return db
    .prepare(
      `SELECT m.id, m.thread_id, t.title AS thread_title, m.role, m.content, m.speech_input,
              m.attachment_name, m.created_at
       FROM chat_messages m
       JOIN chat_threads t ON t.id = m.thread_id
       WHERE m.content LIKE ? OR m.attachment_text LIKE ? OR m.attachment_name LIKE ?
       ORDER BY m.id DESC LIMIT ?`,
    )
    .all(like, like, like, limit);
}

export { reorganizeAfterConversation, SOURCES, dayKey };
