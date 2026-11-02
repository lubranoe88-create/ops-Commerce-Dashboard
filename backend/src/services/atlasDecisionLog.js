/**
 * M4: durable decision log.
 * Each wake, hands, news, and self-heal choice is appended with why Atlas
 * made it. Status and the updates payload expose a short snippet.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, "../../data/agentq-memory/atlas-decisions.json");
const MAX_ENTRIES = 200;

let pathOverride = "";

export function defaultDecisionPath() {
  return DEFAULT_PATH;
}

export function setDecisionFileForTests(filePath) {
  pathOverride = filePath ? path.resolve(filePath) : "";
}

function decisionPath() {
  return pathOverride || DEFAULT_PATH;
}

function clip(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max).trim();
}

function emptyLog() {
  return { version: 1, entries: [] };
}

function sanitizeChoice(choice) {
  if (!choice || typeof choice !== "object") return null;
  const action = clip(choice.action || choice.id, 60);
  if (!action) return null;
  const mode = String(choice.mode || "auto").toLowerCase() === "ask" ? "ask" : "auto";
  return {
    action,
    mode,
    reason: clip(choice.reason || "unspecified", 80) || "unspecified",
    because: clip(choice.because || "", 240),
  };
}

const DECISION_SOURCES = new Set(["wake", "hands", "news", "heal", "route", "schedule", "workflow", "run"]);

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const source = clip(raw.source, 20);
  if (!DECISION_SOURCES.has(source)) return null;
  const choices = [];
  for (const choice of Array.isArray(raw.choices) ? raw.choices : []) {
    const clean = sanitizeChoice(choice);
    if (clean) choices.push(clean);
    if (choices.length >= 12) break;
  }
  if (!choices.length) return null;
  return {
    id: clip(raw.id, 40) || `d-${Date.now().toString(36)}`,
    at: raw.at || new Date().toISOString(),
    source,
    choices,
    because: clip(raw.because || choices.map((choice) => choice.because).filter(Boolean).join(" "), 500),
  };
}

export function readDecisionLog() {
  try {
    const raw = JSON.parse(fs.readFileSync(decisionPath(), "utf8"));
    const entries = Array.isArray(raw?.entries) ? raw.entries.map(sanitizeEntry).filter(Boolean) : [];
    return { version: 1, entries };
  } catch {
    return emptyLog();
  }
}

function persist(data) {
  const dest = decisionPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const clean = {
    version: 1,
    entries: (data.entries || []).map(sanitizeEntry).filter(Boolean).slice(0, MAX_ENTRIES),
  };
  const tmp = path.join(path.dirname(dest), `.atlas-decisions.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(clean, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, dest);
  return clean;
}

export function recordDecision({ source, choices, because } = {}) {
  const entry = sanitizeEntry({
    id: `d-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    source,
    choices,
    because,
  });
  if (!entry) return null;
  try {
    const data = readDecisionLog();
    data.entries.unshift(entry);
    persist(data);
    return entry;
  } catch {
    return null;
  }
}

export function listDecisions({ limit = 8 } = {}) {
  return readDecisionLog().entries.slice(0, Math.max(1, limit));
}

export function formatDecisionLine(entry) {
  if (!entry?.choices?.length) return "";
  const bits = entry.choices.map(
    (choice) => `${choice.action} ${String(choice.mode || "").toUpperCase()} (${choice.reason})`,
  );
  const why = clip(
    entry.choices.map((choice) => choice.because).filter(Boolean).join(" ") || entry.because,
    220,
  );
  const tail = why ? ` — ${why}` : "";
  return `Decisioni · ${entry.source}: ${bits.join("; ")}${tail}`;
}

export function decisionSnippet({ limit = 2 } = {}) {
  const lines = listDecisions({ limit }).map(formatDecisionLine).filter(Boolean);
  return lines.join(" | ");
}

export function decisionStatus({ limit = 5 } = {}) {
  const recent = listDecisions({ limit });
  return {
    snippet: decisionSnippet({ limit: Math.min(limit, 2) }),
    recent,
    count: readDecisionLog().entries.length,
  };
}
