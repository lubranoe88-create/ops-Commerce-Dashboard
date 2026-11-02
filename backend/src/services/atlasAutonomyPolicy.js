/**
 * Atlas autonomy policy (L3 + X1).
 *
 * AUTO without confirmation: zoom, module view, read, status, updates,
 * plus action ids this deployment has promoted after repeated explicit confirms.
 * ASK until then: destructive writes, browser-use, credentials, exports,
 * spend past the soft budget band, and anything unknown.
 *
 * X1 progressive autonomy: START_CONSERVATIVE stays true. The AUTO allowlist
 * widens per action id, not per category. An id that is currently ASK is
 * written into the persisted overlay only after THRESHOLD explicit confirms
 * of that same id. Credentials and destructive ids use that same count —
 * confirming one id never promotes a sibling, a category, or an id that
 * has not been counted.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getBudgetStatus } from "./aiBudget.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const POLICY_VERSION = 2;

/** X1: autonomous allowlist starts narrow. Promoted ids widen it per deployment. */
export const START_CONSERVATIVE = true;

/** Explicit confirms of one ASK id required before that id becomes AUTO. */
export const THRESHOLD = 3;
export const APPROVAL_THRESHOLD = THRESHOLD;

/** Runtime trust file. Gitignored with the rest of backend/data. */
export const TRUST_RELATIVE_PATH = "backend/data/agentq-memory/atlas-trust.json";

const DEFAULT_TRUST_PATH = path.resolve(__dirname, "../../data/agentq-memory/atlas-trust.json");

let trustPathOverride = "";
let trustCache = null;
let trustCacheKey = "";

const AUTO_MATRIX = Object.freeze({
  zoom: Object.freeze([
    "zoom-in",
    "zoom-out",
    "zoom-citta",
    "zoom-paese",
    "zoom-continente",
    "orbit",
    "nord",
    "fly",
    "focus-top",
  ]),
  "module-view": Object.freeze([
    "map",
    "pipeline",
    "memory",
    "chat",
    "strumenti",
    "inspect",
    "analizza",
    "mic",
    "confronta",
    "filtro-score",
    "filtro-reset",
    "coverage-next",
    "tema-cyan",
    "tema-amber",
    "tema-mint",
  ]),
  read: Object.freeze([
    "read",
    "search",
    "document",
    "sandbox-read",
    "memory-list",
    "memory-read",
    "problems",
    "web-hint",
    "web_hint",
    "wikipedia",
  ]),
  status: Object.freeze([
    "status",
    "agentq-status",
    "function-board",
    "budget-status",
    "health",
    "controlli",
    "funzionamento",
  ]),
  updates: Object.freeze(["refresh", "updates", "news", "entry-updates", "updates-read"]),
});

const ASK_MATRIX = Object.freeze({
  "destructive-write": Object.freeze([
    "correct",
    "reorder-tops",
    "accept-suggestion",
    "delete",
    "wipe",
    "drop",
    "destroy",
    "purge",
    "truncate",
    "overwrite",
    "remove",
    "clear",
  ]),
  "browser-use": Object.freeze(["browser_use", "browser-use", "browseruse"]),
  credentials: Object.freeze([
    "credential",
    "credentials",
    "login",
    "password",
    "passwd",
    "totp",
    "otp",
    "2fa",
    "secret",
    "secrets",
    "api-key",
    "apikey",
    "api_key",
    "token",
    "passcode",
  ]),
  export: Object.freeze(["export", "dump", "backup", "download"]),
  "spend-past-soft-band": Object.freeze([
    "spend",
    "spend-past-soft",
    "spend-past-soft-band",
    "past-soft-band",
    "escalate",
    "escalate_main",
    "escalate_grok",
    "escalate-main",
    "escalate-grok",
  ]),
});

const AUTO_EXACT = indexMatrix(AUTO_MATRIX);
const SPEND_EXACT = new Set(ASK_MATRIX["spend-past-soft-band"]);

function indexMatrix(matrix) {
  const map = new Map();
  for (const [reason, ids] of Object.entries(matrix)) {
    for (const id of ids) map.set(id, reason);
  }
  return map;
}

/** Id from a string or `{ id | type | action | actionId }`. */
export function actionIdOf(action) {
  let raw = "";
  if (typeof action === "string" || typeof action === "number") raw = String(action);
  else if (action && typeof action === "object") {
    raw = String(action.id ?? action.type ?? action.action ?? action.actionId ?? "");
  }
  return raw.trim();
}

function normId(action) {
  return actionIdOf(action).toLowerCase().replace(/\s+/g, "-");
}

function isCredentials(id) {
  if (ASK_MATRIX.credentials.includes(id)) return true;
  if (
    /^(credential|credentials|password|passwd|secret|secrets|token|login|totp|otp|passcode|api-key|apikey|api_key)([-_]|$)/.test(
      id,
    )
  ) {
    return true;
  }
  return (
    id.includes("password") ||
    id.includes("credential") ||
    id.includes("api-key") ||
    id.includes("api_key") ||
    id.includes("apikey") ||
    id.includes("totp") ||
    id.includes("2fa")
  );
}

function isBrowserUse(id) {
  const flat = id.replace(/[_-]/g, "");
  return flat === "browseruse" || flat.startsWith("browseruse");
}

function isExport(id) {
  if (ASK_MATRIX.export.includes(id)) return true;
  if (/^(export|dump|backup|download)([-_]|$)/.test(id)) return true;
  return id.includes("export");
}

function isDestructive(id) {
  if (ASK_MATRIX["destructive-write"].includes(id)) return true;
  if (/^(delete|wipe|drop|destroy|purge|truncate|overwrite|remove|clear)([-_]|$)/.test(id)) {
    return true;
  }
  if (id === "correct" || id.startsWith("correct-") || id.startsWith("correct_")) return true;
  if (id.startsWith("reorder")) return true;
  if (id.includes("accept-suggestion") || id.includes("accept_suggestion")) return true;
  if (/(^|[-_])(delete|wipe|destroy|purge|truncate|overwrite|drop)([-_]|$)/.test(id)) return true;
  return id.includes("destructive");
}

function isSpendClass(id) {
  if (SPEND_EXACT.has(id)) return true;
  if (/^spend([-_]|$)/.test(id)) return true;
  return /^escalate([-_]|$)/.test(id);
}

function explicitPastSoft(action) {
  if (!action || typeof action !== "object") return false;
  if (action.pastSoftBand === true || action.spendPastSoft === true || action.softBlocked === true) {
    return true;
  }
  const band = String(action.budgetBand || action.band || "").toLowerCase();
  return band === "soft" || band === "past-soft" || band === "hard";
}

function extraSpendEur(action) {
  if (!action || typeof action !== "object") return 0;
  const n = Number(action.costEur ?? action.eur ?? action.spendEur);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Read the live soft band. Unreadable ledger counts as past while START_CONSERVATIVE. */
function readBand() {
  try {
    const st = getBudgetStatus();
    return {
      past: Boolean(st?.softBlocked || st?.hardBlocked),
      capEur: Number(st?.capEur) || 0,
      spentEur: Number(st?.spentEur) || 0,
      softRatio: Number(st?.softRatio) || 0.75,
    };
  } catch {
    return {
      past: START_CONSERVATIVE,
      capEur: 0,
      spentEur: 0,
      softRatio: 0.75,
      unreadable: true,
    };
  }
}

function spendPastSoftBand(action, id) {
  if (explicitPastSoft(action)) return true;
  // Spend-class ids are the soft-band ASK bucket. A cost on any other action
  // asks only once it crosses or is already past the live soft band.
  // Promotion does not rewrite this baseline: a normally-AUTO id such as
  // zoom-in is not an ASK id, so repeated budget confirms do not promote it.
  if (isSpendClass(id)) return true;
  const extra = extraSpendEur(action);
  if (extra <= 0) return false;
  const band = readBand();
  if (band.past) return true;
  if (band.capEur > 0 && (band.spentEur + extra) / band.capEur >= band.softRatio) return true;
  return false;
}

function autoReason(id) {
  const exact = AUTO_EXACT.get(id);
  if (exact) return exact;
  if (id.startsWith("zoom-") || id.startsWith("zoom_")) return "zoom";
  if (id.startsWith("tema-") || id.startsWith("tema_")) return "module-view";
  if (id === "refresh" || id.startsWith("refresh-") || id.startsWith("refresh_")) return "updates";
  if (
    /^(status|health|function-board|budget-status)$/.test(id) ||
    /^(status|health)[-_]read$/.test(id)
  ) {
    return "status";
  }
  if (/^(read|search|document|problems)([-_][a-z0-9]+)?$/.test(id)) return "read";
  return "";
}

/**
 * Classification ignoring the persisted overlay.
 * @param {string|object} actionIdOrType
 * @returns {{ mode: 'auto'|'ask', reason: string }}
 */
function classifyBase(actionIdOrType) {
  const id = normId(actionIdOrType);
  if (!id) return { mode: "ask", reason: "unknown" };
  if (isCredentials(id)) return { mode: "ask", reason: "credentials" };
  if (isBrowserUse(id)) return { mode: "ask", reason: "browser-use" };
  if (isExport(id)) return { mode: "ask", reason: "export" };
  if (isDestructive(id)) return { mode: "ask", reason: "destructive-write" };
  if (spendPastSoftBand(actionIdOrType, id)) {
    return { mode: "ask", reason: "spend-past-soft-band" };
  }
  const auto = autoReason(id);
  if (auto) return { mode: "auto", reason: auto };
  return { mode: "ask", reason: "unknown" };
}

export function defaultTrustFilePath() {
  return DEFAULT_TRUST_PATH;
}

function resolveTrustPath() {
  return trustPathOverride || DEFAULT_TRUST_PATH;
}

/** Point the overlay at a file and drop the in-memory cache. Tests only. */
export function setTrustFileForTests(filePath) {
  trustPathOverride = filePath ? path.resolve(filePath) : "";
  trustCache = null;
  trustCacheKey = "";
}

function emptyTrust() {
  return { approvals: {}, promoted: [], updatedAt: null };
}

function sortedApprovals(map) {
  const out = {};
  for (const key of Object.keys(map).sort()) out[key] = map[key];
  return out;
}

/** Ids whose own approval count reached THRESHOLD and whose baseline is still ASK. */
function activePromotedIds(state) {
  const ids = [];
  const seen = new Set();
  for (const raw of state?.promoted || []) {
    const id = normId(raw);
    if (!id || seen.has(id)) continue;
    if ((state.approvals?.[id] || 0) < THRESHOLD) continue;
    // Baseline AUTO ids are not overlay entries. Credentials and destructive
    // ids stay eligible: they are ASK, so the same count can promote them.
    if (classifyBase(id).mode !== "ask") continue;
    seen.add(id);
    ids.push(id);
  }
  ids.sort();
  return ids;
}

function sanitize(raw) {
  const approvals = {};
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw.approvals : null;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    for (const [key, value] of Object.entries(source)) {
      const id = normId(key);
      const n = Number(value);
      if (!id || !Number.isFinite(n) || n < 1) continue;
      const count = Math.min(1_000_000, Math.floor(n));
      approvals[id] = Math.max(approvals[id] || 0, count);
    }
  }
  const updatedAt =
    raw && typeof raw === "object" && typeof raw.updatedAt === "string" && raw.updatedAt.trim()
      ? raw.updatedAt.trim()
      : null;
  const state = { approvals, promoted: Array.isArray(raw?.promoted) ? raw.promoted : [], updatedAt };
  return {
    approvals: sortedApprovals(approvals),
    promoted: activePromotedIds(state),
    updatedAt,
  };
}

function readTrust() {
  const key = resolveTrustPath();
  if (trustCache && trustCacheKey === key) return trustCache;
  let parsed = null;
  try {
    parsed = JSON.parse(fs.readFileSync(key, "utf8"));
  } catch {
    parsed = null;
  }
  trustCache = sanitize(parsed);
  trustCacheKey = key;
  return trustCache;
}

function persistTrust(state) {
  const clean = sanitize(state);
  const dest = resolveTrustPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = path.join(path.dirname(dest), `.atlas-trust.${process.pid}.tmp`);
  const body = `${JSON.stringify(
    {
      approvals: clean.approvals,
      promoted: clean.promoted,
      updatedAt: clean.updatedAt,
    },
    null,
    2,
  )}\n`;
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, dest);
  trustCache = clean;
  trustCacheKey = dest;
  return trustCache;
}

function isPromotedId(id) {
  const state = readTrust();
  return state.promoted.includes(id) && (state.approvals[id] || 0) >= THRESHOLD;
}

/**
 * @param {string|object} actionIdOrType
 * @returns {{ mode: 'auto'|'ask', reason: string }}
 */
export function classifyAction(actionIdOrType) {
  const id = normId(actionIdOrType);
  if (!id) return { mode: "ask", reason: "unknown" };
  // Promoted overlay wins, including credentials and destructive ids that
  // reached THRESHOLD by explicit confirms. Baseline AUTO is unchanged.
  if (isPromotedId(id)) return { mode: "auto", reason: "promoted" };
  return classifyBase(actionIdOrType);
}

/** Keep only actions classified AUTO. Preserves the original elements. */
export function filterAutonomousActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions.filter((action) => classifyAction(action).mode === "auto");
}

export function requiresAsk(action) {
  return classifyAction(action).mode !== "auto";
}

/**
 * Hands gate: `actions` is safe to run immediately.
 * `ask` is flagged `{ id, mode: 'ask', reason }` and must not be executed here.
 * `tagged` is the same proposal in order, each with a mode.
 * Promoted ids are AUTO (`reason: "promoted"`).
 */
export function gateHandActions(proposed) {
  const list = Array.isArray(proposed)
    ? proposed
    : proposed == null || proposed === ""
      ? []
      : [proposed];
  const autoIds = new Set(
    filterAutonomousActions(list)
      .map((raw) => normId(raw))
      .filter(Boolean),
  );
  const actions = [];
  const ask = [];
  const tagged = [];
  const seen = new Set();
  for (const raw of list) {
    const id = normId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const tag = classifyAction(raw);
    if (tag.mode === "auto" && autoIds.has(id) && !requiresAsk(raw)) {
      actions.push(id);
      tagged.push({ id, mode: "auto", reason: tag.reason });
    } else {
      const step = { id, mode: "ask", reason: tag.reason || "unknown" };
      ask.push(step);
      tagged.push(step);
    }
  }
  return { actions, ask, tagged };
}

function approvalResult(extra) {
  const state = readTrust();
  return {
    ok: true,
    threshold: THRESHOLD,
    startConservative: START_CONSERVATIVE,
    promoted: [...state.promoted],
    approvalCounts: { ...state.approvals },
    ...extra,
  };
}

/**
 * Count one explicit confirm of an ASK action id.
 * At THRESHOLD, that id alone is added to the persisted AUTO overlay.
 * Ids that are already AUTO (including budget-only asks on a normally AUTO id)
 * are not counted and are not promoted. Credentials and destructive ids are
 * counted the same way as any other ASK id — never as a category.
 *
 * @param {string|object} actionId
 */
export function recordAskApproval(actionId) {
  const id = normId(actionId);
  if (!id) {
    return approvalResult({
      ok: false,
      recorded: false,
      error: "actionId required",
      actionId: "",
      count: 0,
      justPromoted: false,
      reason: "unknown",
    });
  }
  const base = classifyBase(id);
  const before = readTrust();
  if (base.mode !== "ask") {
    return approvalResult({
      recorded: false,
      actionId: id,
      count: before.approvals[id] || 0,
      justPromoted: false,
      reason: base.reason,
    });
  }
  const wasPromoted = before.promoted.includes(id);
  const count = (before.approvals[id] || 0) + 1;
  const approvals = { ...before.approvals, [id]: count };
  const promoted = [...before.promoted];
  // Same threshold for every ASK id, including credentials and destructive-write.
  // The id is not written into the overlay before the count is met.
  if (count >= THRESHOLD && !promoted.includes(id)) promoted.push(id);
  const saved = persistTrust({
    approvals,
    promoted,
    updatedAt: new Date().toISOString(),
  });
  const nowPromoted = saved.promoted.includes(id);
  return approvalResult({
    recorded: true,
    actionId: id,
    count: saved.approvals[id] || count,
    justPromoted: nowPromoted && !wasPromoted,
    reason: nowPromoted ? "promoted" : base.reason,
  });
}

/** Status / debug summary. `auto` and `ask` are policy classes, not a live plan. */
export function describePolicy() {
  const state = readTrust();
  const counts = {};
  let total = 0;
  let pending = 0;
  for (const [id, count] of Object.entries(state.approvals)) {
    counts[id] = count;
    total += count;
    if (count < THRESHOLD) pending += 1;
  }
  return {
    version: POLICY_VERSION,
    startConservative: START_CONSERVATIVE,
    threshold: THRESHOLD,
    promoted: [...state.promoted],
    approvalCounts: counts,
    approvalSummary: {
      tracked: Object.keys(counts).length,
      pending,
      promoted: state.promoted.length,
      total,
    },
    updatedAt: state.updatedAt,
    store: TRUST_RELATIVE_PATH,
    auto: Object.keys(AUTO_MATRIX),
    ask: [...Object.keys(ASK_MATRIX), "unknown"],
    matrix: {
      auto: Object.fromEntries(Object.entries(AUTO_MATRIX).map(([k, v]) => [k, [...v]])),
      ask: Object.fromEntries(Object.entries(ASK_MATRIX).map(([k, v]) => [k, [...v]])),
    },
    note: "X1: start conservative. An ASK action id becomes AUTO for this deployment after 3 explicit approvals of that same id. Credentials and destructive ids use that count; confirming one id does not promote its category or a sibling.",
  };
}
