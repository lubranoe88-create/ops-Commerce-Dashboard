/**
 * Bridge Atlas (ex Agente Q) → plancia OPS.
 * Internal paths keep agentq* names; user-facing identity is Atlas.
 * - Riutilizza chiavi OpenRouter già in config (mai hardcodate).
 * - Ricerca on-demand: filesystem SOLO in sandbox, sqlite allowlist, API, web hints.
 * - Feed aggiornamenti all'ingresso.
 * - Catalogo "mani": azioni plancia (moduli, zoom, refresh…).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { completeChat } from "./openrouter.js";
import { buildFunctionBoard } from "./functionBoard.js";
import { getDb } from "../memory/db.js";
import { getDashboardSnapshot } from "../memory/store.js";
import { ATLAS_NAME, withAtlasPersona } from "./atlasPersonality.js";
import { describePolicy, gateHandActions } from "./atlasAutonomyPolicy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(__dirname, "../../data");
const SANDBOX_ROOT = path.resolve(DATA_ROOT, "agentq-sandbox");
const UPDATES_PATH = path.resolve(DATA_ROOT, "agentq-updates/updates.json");
const MEMORY_EXPAND_PATH = path.resolve(DATA_ROOT, "agentq-memory/expandable.json");

/** Solo SELECT su queste tabelle — nessuna scrittura via ricerca. */
const DB_SEARCH_ALLOWLIST = Object.freeze({
  concepts: {
    sql: `SELECT id, slug, label, mention_count FROM concepts
          WHERE lower(slug) LIKE ? OR lower(label) LIKE ?
          ORDER BY mention_count DESC LIMIT ?`,
    map: (r) => ({
      title: r.label || r.slug,
      snippet: `concept · mentions ${r.mention_count ?? 0}`,
      uri: `db://concepts/${r.id}`,
    }),
  },
  coverage_areas: {
    sql: `SELECT area_key, label, kind, coverage_degree FROM coverage_areas
          WHERE lower(area_key) LIKE ? OR lower(label) LIKE ?
          ORDER BY coverage_degree DESC LIMIT ?`,
    map: (r) => ({
      title: r.label || r.area_key,
      snippet: `${r.kind} · coverage ${r.coverage_degree ?? 0}%`,
      uri: `db://coverage/${r.area_key}`,
    }),
  },
  pipeline_errors: {
    sql: `SELECT id, source_key, severity, cause_code, cause_text, status FROM pipeline_errors
          WHERE lower(source_key) LIKE ? OR lower(cause_text) LIKE ? OR lower(cause_code) LIKE ?
          ORDER BY id DESC LIMIT ?`,
    map: (r) => ({
      title: `${r.source_key} · ${r.cause_code || r.severity}`,
      snippet: `${r.status}: ${r.cause_text || ""}`.slice(0, 220),
      uri: `db://pipeline_errors/${r.id}`,
    }),
    // 3 LIKE params + limit
    bind: (like, limit) => [like, like, like, limit],
  },
  daily_tops: {
    sql: `SELECT rank, business_key, display_name, score FROM daily_tops
          WHERE lower(business_key) LIKE ? OR lower(display_name) LIKE ?
          ORDER BY score DESC LIMIT ?`,
    map: (r) => ({
      title: r.display_name || r.business_key,
      snippet: `rank ${r.rank} · score ${r.score}`,
      uri: `db://daily_tops/${r.business_key}`,
    }),
  },
});

/** Azioni che il client può eseguire come "mani" sulla plancia. */
export const AGENTQ_HAND_ACTIONS = [
  { id: "map", label: "Apri MAPPA", group: "moduli" },
  { id: "pipeline", label: "Apri PIPELINE", group: "moduli" },
  { id: "memory", label: "Apri MEMORY", group: "moduli" },
  { id: "chat", label: "Apri CHAT", group: "moduli" },
  { id: "zoom-in", label: "Zoom in globo", group: "zoom" },
  { id: "zoom-out", label: "Zoom out globo", group: "zoom" },
  { id: "zoom-citta", label: "Zoom città", group: "zoom" },
  { id: "zoom-paese", label: "Zoom paese", group: "zoom" },
  { id: "zoom-continente", label: "Zoom continente", group: "zoom" },
  { id: "refresh", label: "Aggiorna dati", group: "sistema" },
  { id: "strumenti", label: "Apri strumenti", group: "sistema" },
];

function replaceAgentDisplayName(text) {
  return String(text ?? "").replace(/\bAgente Q\b|\bAgent Q\b|\bAgentQ\b/g, ATLAS_NAME);
}

/** Rewrite stored seed copy that is shown in chat, search, and document popups. */
function migrateStoredDisplayNames() {
  const sandboxReadme = path.join(SANDBOX_ROOT, "README.txt");
  if (fs.existsSync(sandboxReadme)) {
    try {
      const cur = fs.readFileSync(sandboxReadme, "utf8");
      const next = replaceAgentDisplayName(cur);
      if (next !== cur) fs.writeFileSync(sandboxReadme, next, "utf8");
    } catch {
      /* keep the existing seed */
    }
  }
  rewriteJsonDisplayFields(UPDATES_PATH, (list, fix) => {
    if (!Array.isArray(list)) return;
    for (const row of list) {
      if (!row || typeof row !== "object") continue;
      if (typeof row.title === "string") row.title = fix(row.title);
      if (typeof row.detail === "string") row.detail = fix(row.detail);
    }
  });
  rewriteJsonDisplayFields(MEMORY_EXPAND_PATH, (data, fix) => {
    const entries = Array.isArray(data?.entries) ? data.entries : [];
    for (const entry of entries) {
      if (!entry || typeof entry !== "object") continue;
      if (typeof entry.title === "string") entry.title = fix(entry.title);
      if (typeof entry.text === "string") entry.text = fix(entry.text);
    }
  });
}

function rewriteJsonDisplayFields(filePath, visit) {
  if (!fs.existsSync(filePath)) return;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return;
  }
  let changed = false;
  const fix = (value) => {
    if (typeof value !== "string") return value;
    const next = replaceAgentDisplayName(value);
    if (next !== value) changed = true;
    return next;
  };
  visit(data, fix);
  if (changed) fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function ensureDirs() {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  fs.mkdirSync(path.dirname(UPDATES_PATH), { recursive: true });
  const sandboxReadme = path.join(SANDBOX_ROOT, "README.txt");
  if (!fs.existsSync(sandboxReadme)) {
    fs.writeFileSync(
      sandboxReadme,
      "Sandbox Atlas — ricerca locale a permessi limitati.\nSolo questa directory è consultabile dalla ricerca filesystem.\n",
      "utf8",
    );
  }
  migrateStoredDisplayNames();
  if (!fs.existsSync(UPDATES_PATH)) {
    fs.writeFileSync(
      UPDATES_PATH,
      JSON.stringify(
        [
          {
            at: new Date().toISOString(),
            title: "Atlas in plancia",
            detail:
              "Bridge attivo: ricerca on-demand in sandbox, aggiornamenti ingresso, pop-up documenti, mani moduli/zoom.",
          },
        ],
        null,
        2,
      ),
      "utf8",
    );
  }
}

function resolveInsideSandbox(relOrAbs) {
  const raw = String(relOrAbs || "").trim() || ".";
  const abs = path.resolve(SANDBOX_ROOT, raw);
  const root = SANDBOX_ROOT.endsWith(path.sep) ? SANDBOX_ROOT : SANDBOX_ROOT + path.sep;
  if (abs !== SANDBOX_ROOT && !abs.startsWith(root)) {
    const err = new Error("Path fuori sandbox");
    err.status = 403;
    err.code = "SANDBOX_DENIED";
    throw err;
  }
  return abs;
}

function scoreText(text, tokens) {
  const low = String(text || "").toLowerCase();
  return tokens.reduce((n, t) => n + (low.split(t).length - 1), 0);
}

function tokensOf(q) {
  return String(q || "")
    .toLowerCase()
    .split(/\W+/)
    .filter((t) => t.length > 1);
}

/**
 * Ricerca locale sandbox (filesystem) — permessi limitati.
 */
export function searchSandboxFilesystem(query, { limit = 8 } = {}) {
  ensureDirs();
  const tokens = tokensOf(query);
  const hits = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
        continue;
      }
      if (!/\.(txt|md|json|csv|log|pdf)$/i.test(ent.name)) continue;
      let stat;
      try {
        stat = fs.statSync(full);
      } catch {
        continue;
      }
      if (stat.size > 400_000) continue;
      let text = "";
      try {
        if (/\.pdf$/i.test(ent.name)) {
          text = ent.name; // PDF: match sul nome; contenuto via endpoint document
        } else {
          text = fs.readFileSync(full, "utf8");
        }
      } catch {
        continue;
      }
      const score = scoreText(text, tokens) + scoreText(ent.name, tokens) * 2;
      if (score <= 0 && tokens.length) continue;
      hits.push({
        source: "filesystem",
        title: ent.name,
        snippet: String(text).replace(/\s+/g, " ").slice(0, 220),
        uri: `sandbox://${path.relative(SANDBOX_ROOT, full)}`,
        score,
      });
    }
  };
  walk(SANDBOX_ROOT);
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/**
 * Ricerca SQLite allowlist (sola lettura) — concepts, coverage, errori, tops.
 */
export function searchDatabase(query, { limit = 8 } = {}) {
  const q = String(query || "").trim();
  if (!q) return [];
  const like = `%${q.toLowerCase().replace(/[%_]/g, "")}%`;
  const perTable = Math.max(2, Math.ceil(limit / 2));
  const hits = [];
  let db;
  try {
    db = getDb();
  } catch (e) {
    throw new Error(`db unavailable: ${e.message}`);
  }
  for (const [table, spec] of Object.entries(DB_SEARCH_ALLOWLIST)) {
    try {
      const binds = spec.bind ? spec.bind(like, perTable) : [like, like, perTable];
      const rows = db.prepare(spec.sql).all(...binds);
      for (const row of rows) {
        const mapped = spec.map(row);
        hits.push({
          source: "database",
          table,
          title: mapped.title,
          snippet: mapped.snippet,
          uri: mapped.uri,
          score: scoreText(`${mapped.title} ${mapped.snippet}`, tokensOf(q)) + 1,
        });
      }
    } catch (e) {
      // Tabella assente o schema diverso: salta, non blocca le altre fonti.
      hits.push({
        source: "database",
        table,
        title: `(skip ${table})`,
        snippet: e.message,
        uri: "",
        score: 0,
        meta: { skipped: true },
      });
    }
  }
  return hits
    .filter((h) => !h.meta?.skipped && h.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Hint web (non naviga): il client/browser-use apre dopo conferma utente.
 */
export function searchWebHints(query) {
  const q = encodeURIComponent(query || "");
  return [
    {
      source: "web_hint",
      title: "DuckDuckGo",
      snippet: "Apri ricerca web in plancia",
      uri: `https://duckduckgo.com/?q=${q}`,
      score: 0.5,
    },
    {
      source: "web_hint",
      title: "Wikipedia",
      snippet: "Apri Wikipedia",
      uri: `https://en.wikipedia.org/wiki/Special:Search?search=${q}`,
      score: 0.45,
    },
  ];
}

export async function searchApiWikipedia(query, { limit = 5 } = {}) {
  const url = `https://en.wikipedia.org/w/api.php?action=opensearch&limit=${limit}&format=json&search=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "OPS-Plancia-AgentQ/1.0" },
  });
  if (!res.ok) throw new Error(`Wikipedia HTTP ${res.status}`);
  const data = await res.json();
  const titles = data?.[1] || [];
  const descs = data?.[2] || [];
  const urls = data?.[3] || [];
  return titles.map((title, i) => ({
    source: "api",
    title: String(title),
    snippet: String(descs[i] || title),
    uri: String(urls[i] || ""),
    score: 1,
    meta: { provider: "wikipedia" },
  }));
}

/**
 * Ricerca multi-fonte — SOLO se esplicitamente richiesta (il route caller lo impone).
 * sources: filesystem | database | memory | api | web_hint | all
 */
export async function runAgentqSearch(
  query,
  { sources = ["filesystem", "database", "memory", "api", "web_hint"] } = {},
) {
  const q = String(query || "").trim();
  if (!q) {
    const err = new Error("query richiesta");
    err.status = 400;
    throw err;
  }
  const wanted = new Set(
    (Array.isArray(sources) ? sources : String(sources).split(",")).map((s) =>
      String(s).trim().toLowerCase(),
    ),
  );
  if (wanted.has("all")) {
    wanted.clear();
    ["filesystem", "database", "memory", "api", "web_hint"].forEach((s) => wanted.add(s));
  }

  const hits = [];
  const errors = [];
  if (wanted.has("filesystem")) {
    try {
      hits.push(...searchSandboxFilesystem(q));
    } catch (e) {
      errors.push(`filesystem: ${e.message}`);
    }
  }
  if (wanted.has("database") || wanted.has("db") || wanted.has("sqlite")) {
    try {
      hits.push(...searchDatabase(q));
    } catch (e) {
      errors.push(`database: ${e.message}`);
    }
  }
  if (wanted.has("memory") || wanted.has("memoria")) {
    try {
      hits.push(...searchExpandableMemory(q));
    } catch (e) {
      errors.push(`memory: ${e.message}`);
    }
  }
  if (wanted.has("api")) {
    try {
      hits.push(...(await searchApiWikipedia(q)));
    } catch (e) {
      errors.push(`api: ${e.message}`);
    }
  }
  if (wanted.has("web_hint")) {
    hits.push(...searchWebHints(q));
  }
  hits.sort((a, b) => (b.score || 0) - (a.score || 0));
  return {
    ok: true,
    query: q,
    hits,
    errors,
    sandboxRoot: "backend/data/agentq-sandbox",
    dbAllowlist: Object.keys(DB_SEARCH_ALLOWLIST),
    onDemand: true,
  };
}

function ensureMemoryExpand() {
  fs.mkdirSync(path.dirname(MEMORY_EXPAND_PATH), { recursive: true });
  if (!fs.existsSync(MEMORY_EXPAND_PATH)) {
    fs.writeFileSync(
      MEMORY_EXPAND_PATH,
      JSON.stringify(
        {
          version: 1,
          entries: [
            {
              id: "seed-1",
              at: new Date().toISOString(),
              title: "Atlas memoria",
              text: "Memoria espandibile avviata: nuove note si accumulano nel tempo.",
              tags: ["agentq", "seed"],
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
  }
  migrateStoredDisplayNames();
}

/** Memoria espandibile Atlas (append-only JSON sotto data/). Internal file name stays agentq-memory. */
export function listExpandableMemory({ limit = 40, query = "" } = {}) {
  ensureMemoryExpand();
  let data = { entries: [] };
  try {
    data = JSON.parse(fs.readFileSync(MEMORY_EXPAND_PATH, "utf8"));
  } catch {
    data = { entries: [] };
  }
  let entries = Array.isArray(data.entries) ? data.entries : [];
  const q = String(query || "").trim().toLowerCase();
  if (q) {
    entries = entries.filter((e) =>
      `${e.title || ""} ${e.text || ""} ${(e.tags || []).join(" ")}`.toLowerCase().includes(q),
    );
  }
  return {
    ok: true,
    expandable: true,
    count: entries.length,
    entries: entries.slice(0, limit),
    path: "backend/data/agentq-memory/expandable.json",
  };
}

export function appendExpandableMemory({ title, text, tags } = {}) {
  ensureMemoryExpand();
  let data = { version: 1, entries: [] };
  try {
    data = JSON.parse(fs.readFileSync(MEMORY_EXPAND_PATH, "utf8"));
  } catch {
    /* fresh */
  }
  if (!Array.isArray(data.entries)) data.entries = [];
  const entry = {
    id: `m-${Date.now().toString(36)}`,
    at: new Date().toISOString(),
    title: String(title || "Nota Atlas").slice(0, 160),
    text: String(text || "").slice(0, 4000),
    tags: Array.isArray(tags)
      ? tags.map((t) => String(t).slice(0, 40)).slice(0, 12)
      : String(tags || "")
          .split(/[,\s]+/)
          .filter(Boolean)
          .slice(0, 12),
  };
  data.entries.unshift(entry);
  data.entries = data.entries.slice(0, 500);
  data.version = 1;
  fs.writeFileSync(MEMORY_EXPAND_PATH, JSON.stringify(data, null, 2), "utf8");
  return { ok: true, entry, count: data.entries.length };
}

export function searchExpandableMemory(query, { limit = 8 } = {}) {
  const listed = listExpandableMemory({ limit: 200, query });
  return (listed.entries || []).slice(0, limit).map((e) => ({
    source: "memory",
    title: e.title,
    snippet: String(e.text || "").replace(/\s+/g, " ").slice(0, 220),
    uri: `memory://expandable/${e.id}`,
    score: scoreText(`${e.title} ${e.text}`, tokensOf(query)) + 1,
    meta: { at: e.at, tags: e.tags },
  }));
}

/**
 * Monitoraggio errori/problemi plancia: function-board + pipeline_errors open.
 */
export async function getAgentqProblems({ limit = 24 } = {}) {
  const problems = [];
  let boardSummary = null;
  try {
    const board = await buildFunctionBoard();
    boardSummary = board?.summary || null;
    for (const fn of board?.functions || []) {
      if (fn.status && fn.status !== "ok") {
        problems.push({
          kind: "function",
          severity: fn.status === "error" ? "high" : "medium",
          id: fn.id,
          title: fn.label || fn.id,
          detail: fn.detail || fn.errorType || fn.status,
          status: fn.status,
        });
      }
    }
  } catch (e) {
    problems.push({
      kind: "function-board",
      severity: "high",
      id: "function-board",
      title: "Function board unavailable",
      detail: e.message,
      status: "error",
    });
  }
  try {
    const snap = getDashboardSnapshot();
    for (const err of snap?.errors || []) {
      if (err.status !== "open") continue;
      problems.push({
        kind: "pipeline",
        severity: err.severity === "failed" ? "high" : "medium",
        id: `pipe-${err.id}`,
        title: `${err.source_key || "pipeline"} · ${err.cause_code || err.severity}`,
        detail: err.cause_text || err.impact || "",
        status: err.status,
      });
    }
  } catch (e) {
    problems.push({
      kind: "pipeline",
      severity: "medium",
      id: "pipeline-snapshot",
      title: "Pipeline errors unavailable",
      detail: e.message,
      status: "error",
    });
  }
  problems.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
  return {
    ok: true,
    count: problems.length,
    problems: problems.slice(0, limit),
    functionBoard: boardSummary,
    generatedAt: new Date().toISOString(),
  };
}

export function getEntryUpdates({ limit = 12 } = {}) {
  ensureDirs();
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(UPDATES_PATH, "utf8"));
  } catch {
    list = [];
  }
  if (!Array.isArray(list)) list = [];
  return {
    ok: true,
    updates: list.slice(0, limit),
    generatedAt: new Date().toISOString(),
  };
}

export function appendEntryUpdate({ title, detail }) {
  ensureDirs();
  let list = [];
  try {
    list = JSON.parse(fs.readFileSync(UPDATES_PATH, "utf8"));
  } catch {
    list = [];
  }
  if (!Array.isArray(list)) list = [];
  list.unshift({
    at: new Date().toISOString(),
    title: String(title || "Aggiornamento").slice(0, 120),
    detail: String(detail || "").slice(0, 500),
  });
  fs.writeFileSync(UPDATES_PATH, JSON.stringify(list.slice(0, 50), null, 2));
  return { ok: true };
}

/** Legge un file sandbox per pop-up documento (testo). */
export function readSandboxDocument(relPath) {
  const abs = resolveInsideSandbox(relPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    const err = new Error("Documento non trovato in sandbox");
    err.status = 404;
    throw err;
  }
  const stat = fs.statSync(abs);
  if (stat.size > 1_500_000) {
    const err = new Error("Documento troppo grande");
    err.status = 413;
    throw err;
  }
  const ext = path.extname(abs).toLowerCase();
  if (ext === ".pdf") {
    const buf = fs.readFileSync(abs);
    return {
      ok: true,
      kind: "pdf",
      name: path.basename(abs),
      mime: "application/pdf",
      base64: buf.toString("base64"),
      uri: `sandbox://${path.relative(SANDBOX_ROOT, abs)}`,
    };
  }
  const text = fs.readFileSync(abs, "utf8");
  return {
    ok: true,
    kind: "text",
    name: path.basename(abs),
    mime: "text/plain",
    text,
    uri: `sandbox://${path.relative(SANDBOX_ROOT, abs)}`,
  };
}

/**
 * Piano mani: dato un obiettivo in linguaggio naturale, propone azioni plancia
 * usando il modello già configurato (OpenRouter env).
 */
export async function planHandActions(objective) {
  const catalog = AGENTQ_HAND_ACTIONS.map((a) => `${a.id}: ${a.label}`).join("\n");
  const result = await completeChat({
    model: config.openRouterModel,
    system: withAtlasPersona(
      `Sei ${ATLAS_NAME} sulla plancia OPS. Rispondi SOLO JSON: {"actions":["id",...],"speak":"breve conferma in italiano"}. Usa solo id del catalogo (autonomi: zoom, moduli, refresh). Non promettere azioni distruttive, browser-use, credenziali, export o spesa oltre la fascia soft: quelle richiedono conferma e non partono da sole.`,
    ),
    prompt: `Obiettivo: ${objective}\nCatalogo:\n${catalog}`,
    maxTokens: 200,
    temperature: 0.1,
  });
  let parsed = { actions: [], speak: result.content };
  try {
    const m = result.content.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
  } catch {
    /* keep raw */
  }
  // L3: only AUTO ids are returned in `actions` (safe to run).
  // ASK is flagged on `ask` / `tagged` and is not executed here.
  const gated = gateHandActions(parsed.actions);
  return {
    ok: true,
    actions: gated.actions,
    ask: gated.ask,
    tagged: gated.tagged,
    speak: parsed.speak || "",
    model: result.model,
    engine: "agentq-hands",
  };
}

export async function agentqStatus() {
  ensureDirs();
  ensureMemoryExpand();
  let board = null;
  try {
    board = await buildFunctionBoard();
  } catch (e) {
    board = { error: e.message };
  }
  const mem = listExpandableMemory({ limit: 1 });
  return {
    ok: true,
    name: ATLAS_NAME,
    integrated: true,
    keys: {
      openrouterConfigured: !String(config.openRouterApiKey || "").includes("CHANGE_ME"),
      model: config.openRouterModel,
    },
    sandbox: {
      root: "backend/data/agentq-sandbox",
      writableByAgent: false,
      searchOnDemandOnly: true,
    },
    memory: {
      expandable: true,
      count: mem.count,
      path: mem.path,
    },
    hands: AGENTQ_HAND_ACTIONS.length,
    autonomy: describePolicy(),
    functionBoard: board?.summary || board,
    voice: {
      browserTts: true,
      serverTts: true,
      whisperStt: true,
      nativeAgentqTts: false,
      note:
        "iPad: unlock TTS su pointerdown MIC; server TTS→AudioContext; MediaRecorder+Whisper; no SpeechRecognition",
    },
  };
}

ensureDirs();
