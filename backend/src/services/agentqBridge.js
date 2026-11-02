/**
 * Bridge Agent Q → plancia OPS.
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_ROOT = path.resolve(__dirname, "../../data");
const SANDBOX_ROOT = path.resolve(DATA_ROOT, "agentq-sandbox");
const UPDATES_PATH = path.resolve(DATA_ROOT, "agentq-updates/updates.json");

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

function ensureDirs() {
  fs.mkdirSync(SANDBOX_ROOT, { recursive: true });
  fs.mkdirSync(path.dirname(UPDATES_PATH), { recursive: true });
  if (!fs.existsSync(UPDATES_PATH)) {
    fs.writeFileSync(UPDATES_PATH, "[]", "utf8");
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
 * sources: filesystem | api | web_hint | all
 */
export async function runAgentqSearch(query, { sources = ["filesystem", "api", "web_hint"] } = {}) {
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
    ["filesystem", "api", "web_hint"].forEach((s) => wanted.add(s));
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
    onDemand: true,
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
    system:
      "Sei Agent Q sulla plancia OPS. Rispondi SOLO JSON: {\"actions\":[\"id\",...],\"speak\":\"breve conferma in italiano\"}. Usa solo id del catalogo.",
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
  const allowed = new Set(AGENTQ_HAND_ACTIONS.map((a) => a.id));
  const actions = (parsed.actions || []).filter((id) => allowed.has(id));
  return {
    ok: true,
    actions,
    speak: parsed.speak || "",
    model: result.model,
    engine: "agentq-hands",
  };
}

export async function agentqStatus() {
  ensureDirs();
  let board = null;
  try {
    board = await buildFunctionBoard();
  } catch (e) {
    board = { error: e.message };
  }
  return {
    ok: true,
    name: "Agent Q",
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
    hands: AGENTQ_HAND_ACTIONS.length,
    functionBoard: board?.summary || board,
    voice: {
      browserTts: true,
      whisperStt: true,
      nativeAgentqTts: false,
      note: "Repo agent-q non include TTS; plancia usa speechSynthesis + Whisper fallback",
    },
  };
}

ensureDirs();
