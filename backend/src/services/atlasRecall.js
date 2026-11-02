/**
 * M1: long-term memory with automatic recall.
 *
 * Durable notes live in expandable memory. On wake and chat Atlas ranks
 * them by keyword overlap and recency and injects the top facts into the
 * model context. The operator does not have to ask.
 *
 * This is not C3. C3 is an on-request sandbox / memory search. Recall never
 * searches the sandbox and never sets searched/onDemand.
 */
import { config } from "../config.js";
import { appendExpandableMemory, listExpandableMemory } from "./agentqBridge.js";

export const RECALL_MARKER = "FATTI RICHIAMATI AUTOMATICAMENTE";
export const DURABLE_TAG = "durable";
const SESSION_TAG = "atlas-session";
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const STOP = new Set([
  "the", "and", "for", "con", "del", "della", "delle", "dei", "degli", "sul",
  "sulla", "una", "uno", "che", "non", "per", "sono", "from", "with", "this",
  "that", "gli", "dello", "nella", "nel", "atlas",
]);

function clip(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max).trim();
}

export function recallTokens(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP.has(word));
}

function isRecallCandidate(entry) {
  const tags = Array.isArray(entry?.tags) ? entry.tags : [];
  if (tags.includes(SESSION_TAG)) return false;
  return Boolean(clip(entry?.title, 200) || clip(entry?.text, 200));
}

/**
 * keyword is the share of query tokens found (title hits count full, body hits 0.6).
 * recency decays on a 7-day time constant. A durable tag adds a small tie-break.
 */
export function scoreRecallEntry(entry, queryTokens, nowMs = Date.now()) {
  const tokens = Array.isArray(queryTokens) ? queryTokens : [];
  const titleTokens = new Set(recallTokens(entry?.title));
  const bodyTokens = new Set(
    recallTokens(`${entry?.title || ""} ${entry?.text || ""} ${(entry?.tags || []).join(" ")}`),
  );
  let hits = 0;
  for (const token of tokens) {
    if (titleTokens.has(token)) hits += 1;
    else if (bodyTokens.has(token)) hits += 0.6;
  }
  const keyword = tokens.length ? Math.min(1, hits / tokens.length) : 0;
  const at = Date.parse(entry?.at || "") || nowMs;
  const ageMs = Math.max(0, nowMs - at);
  const recency = Math.exp(-ageMs / WEEK_MS);
  const durable = (entry?.tags || []).includes(DURABLE_TAG);
  const score = keyword * 0.7 + recency * 0.3 + (durable ? 0.05 : 0);
  return { score, keyword, recency, durable };
}

export function rankRecall(entries, query, { now = Date.now(), limit = 4 } = {}) {
  const queryTokens = recallTokens(query);
  const ranked = [];
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!isRecallCandidate(entry)) continue;
    const scored = scoreRecallEntry(entry, queryTokens, now);
    if (queryTokens.length && scored.keyword <= 0) continue;
    if (!queryTokens.length && !scored.durable) continue;
    ranked.push({ entry, ...scored });
  }
  ranked.sort((a, b) => b.score - a.score || String(b.entry?.at || "").localeCompare(String(a.entry?.at || "")));
  return ranked.slice(0, Math.max(1, limit));
}

export function rememberDurableNote({ title, text, tags } = {}) {
  const extra = Array.isArray(tags)
    ? tags
    : String(tags || "")
        .split(/[,\s]+/)
        .filter(Boolean);
  const merged = [DURABLE_TAG];
  for (const tag of extra) {
    const clean = String(tag || "").trim();
    if (!clean || clean === DURABLE_TAG || merged.includes(clean)) continue;
    merged.push(clean);
  }
  return appendExpandableMemory({
    title,
    text,
    tags: merged,
  });
}

export function formatRecallLine(facts) {
  if (!facts?.length) return "";
  const bits = facts.slice(0, 3).map((fact) => {
    const text = clip(fact?.text, 80);
    const title = clip(fact?.title, 80) || "Nota";
    return text ? `${title}: ${text}` : title;
  });
  return `Ricordo · ${bits.join(" · ")}`;
}

export function formatRecallBlock(recallOrFacts) {
  const facts = Array.isArray(recallOrFacts) ? recallOrFacts : recallOrFacts?.facts || [];
  if (!facts.length) return "";
  const lines = facts.map((fact) => `- ${clip(fact?.title, 120) || "Nota"}: ${clip(fact?.text, 240)}`);
  return `${RECALL_MARKER} (non è una ricerca; l'operatore non l'ha chiesta):\n${lines.join("\n")}`;
}

export function recallQueryFromBundle(bundle) {
  const parts = [
    bundle?.module,
    bundle?.health?.status,
    ...(Array.isArray(bundle?.tops) ? bundle.tops.map((row) => row?.title) : []),
    ...(Array.isArray(bundle?.news) ? bundle.news.map((row) => `${row?.title || ""} ${row?.summary || ""}`) : []),
    ...(Array.isArray(bundle?.updates) ? bundle.updates.map((row) => `${row?.title || ""} ${row?.detail || ""}`) : []),
    ...(Array.isArray(bundle?.problems) ? bundle.problems.map((row) => row?.title) : []),
  ];
  return parts.filter(Boolean).join(" ");
}

export function recallForContext(query, { limit = 4, now = Date.now(), entries } = {}) {
  let list = entries;
  if (!list) {
    try {
      list = listExpandableMemory({ limit: 500 }).entries || [];
    } catch {
      list = [];
    }
  }
  const ranked = rankRecall(list, query, { now, limit });
  const facts = ranked.map((row) => ({
    id: row.entry.id,
    title: clip(row.entry.title, 120) || "Nota",
    text: clip(row.entry.text, 240),
    at: row.entry.at || null,
    tags: Array.isArray(row.entry.tags) ? row.entry.tags.slice(0, 8) : [],
    score: Number(row.score.toFixed(4)),
    keyword: Number(row.keyword.toFixed(4)),
    recency: Number(row.recency.toFixed(4)),
  }));
  return {
    automatic: true,
    searched: false,
    onDemand: false,
    query: clip(query, 300),
    facts,
    line: formatRecallLine(facts),
    block: formatRecallBlock(facts),
  };
}

/** Append the recall block unless this prompt already carries the marker. */
export function injectAutomaticRecall(prompt, query) {
  const text = String(prompt || "");
  if (text.includes(RECALL_MARKER)) {
    return { prompt: text, recall: null, injected: false };
  }
  const recall = recallForContext(query || text, { limit: 4 });
  if (!recall.block) return { prompt: text, recall, injected: false };
  const room = Math.max(0, (config.maxPromptChars || 8000) - text.length - 2);
  if (room < 80) return { prompt: text, recall, injected: false };
  const block = recall.block.slice(0, room);
  return { prompt: `${text}\n\n${block}`, recall, injected: true };
}
