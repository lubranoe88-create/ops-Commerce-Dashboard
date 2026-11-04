/**
 * Atlas unified brain — one neuron store for the plancia.
 * Skills, prompts, functions, facts, session notes, concepts AND Agent Q heritage
 * (how Atlas operates) share one graph. Legacy expandable.json + SQLite concepts
 * are imported on ensure (idempotent). Agent Q is always seeded.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atlasMemoryPaths, listExpandableMemory } from "./agentqBridge.js";
import { getDashboardSnapshot } from "../memory/store.js";
import { recallTokens } from "./atlasRecall.js";
import {
  ATLAS_AGENTQ_QUALITIES,
  ATLAS_ESCALATE_REMINDERS,
  ATLAS_TRUTH_RULES,
  ATLAS_VOICE_OPS_RULES,
} from "./atlasPromptCanon.js";
import { ATLAS_AGENTQ_TAG, ATLAS_TOOL_CONFIG } from "./atlasTruthPack.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const NEURON_KINDS = Object.freeze([
  "skill",
  "prompt",
  "function",
  "fact",
  "session",
  "concept",
  "tool",
  "heritage",
]);

/** Agent Q = operating system of Atlas (must never be dropped from migration). */
export const AGENTQ_HERITAGE_SOURCE = "canon:atlas-agentq-heritage";


const MAX_NEURONS = 800;
let brainPathOverride = "";
let migratedOnce = false;

export function setBrainPathForTests(filePath) {
  brainPathOverride = filePath ? path.resolve(filePath) : "";
  migratedOnce = false;
}

export function atlasBrainPath() {
  if (brainPathOverride) return brainPathOverride;
  const dir = atlasMemoryPaths().dir;
  return path.resolve(dir, "brain-neurons.json");
}

function emptyBrain() {
  return { version: 1, name: "Atlas", label: "CERVELLO", neurons: [] };
}

function readBrainFile() {
  const file = atlasBrainPath();
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
  } catch {
    /* ignore */
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!data || typeof data !== "object") return emptyBrain();
    if (!Array.isArray(data.neurons)) data.neurons = [];
    data.version = 1;
    data.name = "Atlas";
    data.label = "CERVELLO";
    return data;
  } catch {
    return emptyBrain();
  }
}

function writeBrainFile(data) {
  const file = atlasBrainPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const payload = {
    version: 1,
    name: "Atlas",
    label: "CERVELLO",
    neurons: Array.isArray(data.neurons) ? data.neurons.slice(0, MAX_NEURONS) : [],
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}

function normalizeKind(kind, tags = []) {
  const k = String(kind || "").trim().toLowerCase();
  if (NEURON_KINDS.includes(k)) return k;
  const tagSet = new Set((tags || []).map((t) => String(t).toLowerCase()));
  if (
    tagSet.has("atlas-agentq-heritage") ||
    tagSet.has("agentq") ||
    tagSet.has("heritage") ||
    tagSet.has("agente-q")
  ) {
    return "heritage";
  }
  if (tagSet.has("sticky") || tagSet.has("prompt") || tagSet.has("web-skill")) {
    if (tagSet.has("tools") || tagSet.has("tool")) return "tool";
    if (tagSet.has("web-skill") || tagSet.has("skill")) return "skill";
    if (tagSet.has("atlas-plancia-control") || tagSet.has("controls")) return "function";
    return "prompt";
  }
  if (tagSet.has("atlas-session") || tagSet.has("session")) return "session";
  if (tagSet.has("function") || tagSet.has("hands")) return "function";
  return "fact";
}

function seedAgentQHeritageNeurons(data) {
  upsertNeuron(data, {
    kind: "heritage",
    title: "Agent Q — come Atlas opera (heritage)",
    body: ATLAS_AGENTQ_QUALITIES,
    tags: [ATLAS_AGENTQ_TAG, "heritage", "agentq", "sticky", "durable", "prompt", "reasoning", "atlas"],
    weight: 1.2,
    source: AGENTQ_HERITAGE_SOURCE,
  });
  upsertNeuron(data, {
    kind: "heritage",
    title: "Agent Q — remind escalate / tool discipline",
    body: ATLAS_ESCALATE_REMINDERS,
    tags: [ATLAS_AGENTQ_TAG, "heritage", "agentq", "sticky", "escalate", "atlas"],
    weight: 1.1,
    source: "canon:atlas-agentq-escalate",
  });
  upsertNeuron(data, {
    kind: "prompt",
    title: "Atlas truth pack — fatti verificati",
    body: ATLAS_TRUTH_RULES,
    tags: ["atlas-truth-pack", "sticky", "durable", "prompt", "honesty", "atlas"],
    weight: 1,
    source: "canon:atlas-truth-pack",
  });
  upsertNeuron(data, {
    kind: "prompt",
    title: "Atlas voice ops — Flash Whisper barge wake",
    body: ATLAS_VOICE_OPS_RULES,
    tags: ["atlas-voice-ops", "sticky", "durable", "prompt", "voice", "atlas"],
    weight: 1,
    source: "canon:atlas-voice-ops",
  });
  upsertNeuron(data, {
    kind: "tool",
    title: "Atlas tool config — verify via plancia APIs",
    body: [
      "When unsure, offer to verify with: state, updates, news, memory search, hands, MCP, cockpit.",
      `Speech: TTS ${ATLAS_TOOL_CONFIG.speech.ttsPrimary}, STT Whisper, duplex ${ATLAS_TOOL_CONFIG.speech.duplex}, wake ${ATLAS_TOOL_CONFIG.speech.wakeWord}.`,
      `Policy: ${ATLAS_TOOL_CONFIG.policy.autonomy}, trust ${ATLAS_TOOL_CONFIG.policy.trustTags}, spend ${ATLAS_TOOL_CONFIG.policy.spendGate}.`,
      `Tool map: ${JSON.stringify(ATLAS_TOOL_CONFIG.verify)}`,
    ].join(" "),
    tags: ["atlas-tool-config", "sticky", "durable", "tools", "verify", "atlas"],
    weight: 1,
    source: "canon:atlas-tool-config",
  });
}

function makeId(prefix = "n") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function presentNeuron(neuron) {
  return {
    id: neuron.id,
    kind: neuron.kind,
    title: String(neuron.title || "Neurone").slice(0, 160),
    body: String(neuron.body || neuron.text || "").slice(0, 4000),
    text: String(neuron.body || neuron.text || "").slice(0, 4000),
    tags: Array.isArray(neuron.tags) ? neuron.tags.slice(0, 16) : [],
    links: Array.isArray(neuron.links) ? neuron.links.slice(0, 40) : [],
    at: neuron.at || null,
    weight: Number(neuron.weight) || 0,
    source: neuron.source || null,
  };
}

/** Fingerprint for near-duplicate collapse (same body / same title). */
export function neuronContentKey(neuron) {
  const body = String(neuron?.body || neuron?.text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  if (body.length >= 48) return `b:${body}`;
  const title = String(neuron?.title || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  return `t:${title || neuron?.id || ""}`;
}

function pickBetterNeuron(a, b) {
  const score = (n) => {
    let s = Number(n.weight) || 0;
    if (n.kind === "heritage") s += 100;
    if (String(n.source || "").startsWith("canon:")) s += 50;
    if (/^storico\b/i.test(String(n.title || ""))) s -= 5;
    if (/^agente atlas\b/i.test(String(n.title || ""))) s += 2;
    return s;
  };
  const sa = score(a);
  const sb = score(b);
  if (sb !== sa) return sb > sa ? b : a;
  return String(b.at || "") > String(a.at || "") ? b : a;
}

/**
 * Collapse true duplicates (same body fingerprint or identical title).
 * Keeps heritage / higher-weight / non-STORICO copies.
 */
export function dedupeNeurons(neurons = []) {
  const best = new Map();
  for (const n of Array.isArray(neurons) ? neurons : []) {
    if (!n?.id && !n?.title) continue;
    const key = neuronContentKey(n);
    if (!key || key === "t:") continue;
    const prev = best.get(key);
    best.set(key, prev ? pickBetterNeuron(prev, n) : n);
  }
  return [...best.values()];
}

function upsertNeuron(data, neuron) {
  const source = neuron.source ? String(neuron.source) : "";
  let idx = -1;
  if (source) idx = data.neurons.findIndex((n) => n.source === source);
  if (idx < 0 && neuron.id) idx = data.neurons.findIndex((n) => n.id === neuron.id);
  const entry = {
    id: idx >= 0 ? data.neurons[idx].id : neuron.id || makeId("n"),
    kind: normalizeKind(neuron.kind, neuron.tags),
    title: String(neuron.title || "Neurone").slice(0, 160),
    body: String(neuron.body || neuron.text || "").slice(0, 4000),
    tags: (Array.isArray(neuron.tags) ? neuron.tags : [])
      .map((t) => String(t).slice(0, 40))
      .filter(Boolean)
      .slice(0, 16),
    links: (Array.isArray(neuron.links) ? neuron.links : []).map(String).slice(0, 40),
    at: neuron.at || new Date().toISOString(),
    weight: Number(neuron.weight) || 0,
    source: source || null,
  };
  if (idx < 0) {
    const key = neuronContentKey(entry);
    idx = data.neurons.findIndex((n) => neuronContentKey(n) === key);
  }
  if (idx >= 0) data.neurons[idx] = pickBetterNeuron(data.neurons[idx], entry);
  else data.neurons.unshift(entry);
  return idx >= 0 ? data.neurons[idx] : entry;
}

function entryToNeuron(entry) {
  return {
    id: entry.id,
    kind: normalizeKind("", entry.tags),
    title: entry.title,
    body: entry.text,
    tags: entry.tags,
    links: entry.links,
    at: entry.at,
    weight: Array.isArray(entry.tags) && entry.tags.includes("sticky") ? 1 : 0.4,
    source: `expandable:${entry.id}`,
  };
}

function conceptToNeuron(concept) {
  const id = String(concept.id);
  return {
    id: `concept-${id}`,
    kind: "concept",
    title: concept.label || concept.slug || id,
    body: `Concetto plancia (sqlite). dimensione=${concept.dimension ?? "—"} importanza=${concept.importance ?? "—"}`,
    tags: ["concept", "plancia", "atlas"],
    links: [],
    at: new Date().toISOString(),
    weight: Number(concept.importance) || 0.3,
    source: `sqlite-concept:${id}`,
  };
}

/** Import legacy stores into the unified brain (safe to call often). */
export function ensureAtlasBrain({ force = false } = {}) {
  if (migratedOnce && !force) {
    return readBrainFile();
  }
  const data = readBrainFile();
  // 1) Agent Q heritage FIRST — operating rules of Atlas (never skip).
  seedAgentQHeritageNeurons(data);
  // 2) Expandable notes (sticky/prompt/session/skills…)
  let listed = { entries: [] };
  try {
    listed = listExpandableMemory({ limit: 500 });
  } catch {
    listed = { entries: [] };
  }
  for (const entry of listed.entries || []) {
    const neuron = entryToNeuron(entry);
    // Expandable Q-heritage note maps to heritage kind even if tags vary.
    if ((entry.tags || []).includes(ATLAS_AGENTQ_TAG) || (entry.tags || []).includes("agentq")) {
      neuron.kind = "heritage";
      neuron.weight = Math.max(Number(neuron.weight) || 0, 1.15);
    }
    upsertNeuron(data, neuron);
  }
  // 3) SQLite concepts
  try {
    const snap = getDashboardSnapshot();
    for (const concept of snap?.memory?.concepts || []) {
      upsertNeuron(data, conceptToNeuron(concept));
    }
  } catch {
    /* sqlite optional in tests */
  }
  // Guarantee at least one heritage neuron after merge.
  if (!data.neurons.some((n) => n.kind === "heritage" || (n.tags || []).includes(ATLAS_AGENTQ_TAG))) {
    seedAgentQHeritageNeurons(data);
  }
  data.neurons = dedupeNeurons(data.neurons);
  data.neurons.sort((a, b) => {
    const dw = (Number(b.weight) || 0) - (Number(a.weight) || 0);
    if (dw) return dw;
    return String(b.at || "").localeCompare(String(a.at || ""));
  });
  const saved = writeBrainFile(data);
  migratedOnce = true;
  return saved;
}

/** Force a dedupe pass and persist (recovery / implant cleanup). */
export function dedupeAtlasBrain() {
  const data = readBrainFile();
  const before = data.neurons.length;
  data.neurons = dedupeNeurons(data.neurons);
  data.neurons.sort((a, b) => {
    const dw = (Number(b.weight) || 0) - (Number(a.weight) || 0);
    if (dw) return dw;
    return String(b.at || "").localeCompare(String(a.at || ""));
  });
  const saved = writeBrainFile(data);
  migratedOnce = true;
  return {
    ok: true,
    before,
    after: saved.neurons.length,
    removed: Math.max(0, before - saved.neurons.length),
    path: atlasBrainPath(),
  };
}

export function listNeurons({ limit = 80, query = "", kind = "" } = {}) {
  const data = ensureAtlasBrain();
  let neurons = data.neurons.slice();
  const q = String(query || "").trim().toLowerCase();
  const k = String(kind || "").trim().toLowerCase();
  if (k) neurons = neurons.filter((n) => n.kind === k);
  if (q) {
    neurons = neurons.filter((n) =>
      `${n.title || ""} ${n.body || ""} ${(n.tags || []).join(" ")} ${n.kind || ""}`
        .toLowerCase()
        .includes(q),
    );
  }
  return {
    ok: true,
    name: "Atlas",
    label: "CERVELLO",
    unified: true,
    path: path.relative(path.resolve(__dirname, "../../.."), atlasBrainPath()) || "backend/data/agentq-memory/brain-neurons.json",
    count: neurons.length,
    neurons: neurons.slice(0, Math.max(1, limit)).map(presentNeuron),
  };
}

export function rememberNeuron({ kind, title, body, text, tags, links, weight, source } = {}) {
  const data = ensureAtlasBrain({ force: true });
  const entry = upsertNeuron(data, {
    kind,
    title,
    body: body || text,
    tags,
    links,
    weight,
    source,
    at: new Date().toISOString(),
  });
  writeBrainFile(data);
  migratedOnce = true;
  return { ok: true, name: "Atlas", neuron: presentNeuron(entry), count: data.neurons.length };
}

export function buildNeuronGraph(neurons = [], { maxNodes = 500 } = {}) {
  // Include every neuron individually — no coarse 80-cap that hid most of the brain.
  const source = (Array.isArray(neurons) ? neurons : [])
    .filter((n) => n?.id)
    .slice(0, Math.max(1, Number(maxNodes) || 500));
  const nodes = source.map((n) => ({
    id: String(n.id),
    kind: n.kind || "fact",
    title: String(n.title || "Neurone").slice(0, 120),
    text: String(n.body || n.text || "").slice(0, 240),
    at: n.at || null,
    tags: Array.isArray(n.tags) ? n.tags.slice(0, 12) : [],
    weight: Number(n.weight) || 0,
  }));
  const edges = [];
  const seen = new Set();
  const add = (from, to, reason) => {
    if (!from || !to || from === to) return;
    const key = `${from < to ? from : to}|${from < to ? to : from}|${reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, reason });
  };
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      // Do NOT fully clique same-kind pairs — that collapsed the 3D view into blobs.
      // Keep precise associations: shared tags, title recall tokens, explicit links.
      let linked = false;
      for (const tag of a.tags) {
        if (b.tags.includes(tag)) {
          add(a.id, b.id, `tag:${tag}`);
          linked = true;
          break;
        }
      }
      if (!linked) {
        const tokensA = new Set(recallTokens(a.title).filter((token) => token.length >= 4));
        const tokensB = new Set(recallTokens(b.title));
        for (const token of tokensA) {
          if (tokensB.has(token)) {
            add(a.id, b.id, `recall:${token}`);
            break;
          }
        }
      }
      const explicit = Array.isArray(source[i]?.links) ? source[i].links : [];
      if (explicit.includes(b.id)) add(a.id, b.id, "link");
    }
  }
  return { ok: true, name: "Atlas", count: nodes.length, nodes, edges };
}

export function brainLiveSnapshot({ limit = 60, query = "", kind = "" } = {}) {
  // Re-sync so legacy writes appear as neurons without a restart.
  migratedOnce = false;
  const listed = listNeurons({ limit, query, kind });
  const graph = buildNeuronGraph(listed.neurons);
  const newest = listed.neurons[0] || null;
  const revision = [
    listed.count,
    newest?.id || "",
    newest?.at || "",
    newest?.kind || "",
  ].join(":");
  // Compatibility aliases: old UI fields map onto the same neurons.
  const asEntries = listed.neurons.map((n) => ({
    id: n.id,
    at: n.at,
    title: n.title,
    text: String(n.body || "").slice(0, 320),
    tags: n.tags,
    kind: n.kind,
  }));
  return {
    ok: true,
    name: "Atlas",
    label: "CERVELLO",
    unified: true,
    revision,
    at: new Date().toISOString(),
    path: listed.path,
    count: listed.count,
    neurons: listed.neurons,
    graph,
    // Deprecated dual panes — same data, one brain.
    expandable: {
      path: listed.path,
      count: listed.count,
      entries: asEntries,
    },
    sqlite: {
      path: listed.path,
      conceptCount: listed.neurons.filter((n) => n.kind === "concept").length,
      linkCount: graph.edges.length,
      concepts: listed.neurons
        .filter((n) => n.kind === "concept")
        .slice(0, 24)
        .map((n) => ({
          id: n.id,
          label: n.title,
          importance: n.weight,
          dimension: null,
        })),
    },
  };
}
