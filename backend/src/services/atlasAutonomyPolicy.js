/**
 * Atlas autonomy policy (L3).
 *
 * AUTO without confirmation: zoom, module view, read, status, updates.
 * ASK (never silent): destructive writes, browser-use, credentials, exports,
 * spend past the soft budget band, and anything unknown.
 *
 * X1 progressive autonomy (stub): START_CONSERVATIVE stays true.
 * The AUTO allowlist widens later — do not auto-promote ASK results,
 * unknown ids, or writes.
 */
import { getBudgetStatus } from "./aiBudget.js";

export const POLICY_VERSION = 1;

/** X1: autonomous allowlist starts narrow and widens later. */
export const START_CONSERVATIVE = true;

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
  // Spend-class ids are the soft-band ASK bucket (never autonomous while
  // START_CONSERVATIVE). A cost on any other action asks only once it
  // crosses or is already past the live soft band.
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
 * @param {string|object} actionIdOrType
 * @returns {{ mode: 'auto'|'ask', reason: string }}
 */
export function classifyAction(actionIdOrType) {
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
  // X1: ids outside the allowlist stay ASK until the allowlist is widened.
  return { mode: "ask", reason: "unknown" };
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

/** Status / debug summary. `auto` and `ask` are policy classes, not a live plan. */
export function describePolicy() {
  return {
    version: POLICY_VERSION,
    startConservative: START_CONSERVATIVE,
    auto: Object.keys(AUTO_MATRIX),
    ask: [...Object.keys(ASK_MATRIX), "unknown"],
    matrix: {
      auto: Object.fromEntries(Object.entries(AUTO_MATRIX).map(([k, v]) => [k, [...v]])),
      ask: Object.fromEntries(Object.entries(ASK_MATRIX).map(([k, v]) => [k, [...v]])),
    },
    note: "X1: START_CONSERVATIVE — the AUTO allowlist widens later. Unknown actions ask. Spend past the soft budget band asks.",
  };
}
