/**
 * C3: sandbox search and expandable memory run only when the user asks.
 * A bare question is not a search. An implicit "look in the sandbox"
 * is refused instead of executed.
 */

export const SEARCH_REFUSAL =
  "Atlas. Non cerco nella sandbox né in memoria finché non me lo chiedi. Dimmi «cerca …» oppure «memoria …».";

export function isExplicitSearchRequest(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return false;
  return /^(cerca|ricerca|search|agent\s*q\s+cerca)\b/.test(t) || /\b(cerca|ricerca)\s+.+/i.test(t);
}

export function isMemoryWrite(text) {
  return /^(memorizza|ricorda|salva\s+in\s+memoria)\b/i.test(String(text || "").trim());
}

export function isMemoryRecall(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return false;
  return /^(memoria|cosa\s+ricordi|leggi\s+memoria|note\s+in\s+memoria)\b/.test(t) || /\bcerca\s+in\s+memoria\b/.test(t);
}

export function isExplicitMemoryRequest(text) {
  return isMemoryWrite(text) || isMemoryRecall(text);
}

/** Cross-thread and expandable memory are read only after an explicit ask. */
export function userAskedForMemory(text) {
  return isExplicitSearchRequest(text) || isExplicitMemoryRequest(text);
}

const IMPLICIT_SEARCH =
  /\b(sandbox|filesystem|nei\s+file|sul\s+disco|nel\s+database|memoria\s+espandibile|cerca\s+nei\s+file|ricerca\s+libera)\b/i;

export function refusesImplicitSearch(text) {
  if (isExplicitSearchRequest(text) || isExplicitMemoryRequest(text)) return false;
  return IMPLICIT_SEARCH.test(String(text || ""));
}

export function searchRefusal() {
  return SEARCH_REFUSAL;
}

const READ_IDS = new Set([
  "search",
  "sandbox-read",
  "memory-list",
  "memory-read",
  "web-hint",
  "web_hint",
  "wikipedia",
]);

function actionId(item) {
  if (typeof item === "string" || typeof item === "number") return String(item).trim().toLowerCase();
  if (item && typeof item === "object") {
    return String(item.id || item.type || item.action || "").trim().toLowerCase();
  }
  return "";
}

/**
 * Drop sandbox/memory reads the model proposed when the utterance
 * never asked for them. The caller narrates the refusal.
 */
export function stripUnrequestedReads(actions, utterance) {
  const list = Array.isArray(actions) ? actions : [];
  if (isExplicitSearchRequest(utterance) || isExplicitMemoryRequest(utterance)) {
    return { actions: list, refused: false };
  }
  let refused = false;
  const kept = [];
  for (const item of list) {
    if (READ_IDS.has(actionId(item))) {
      refused = true;
      continue;
    }
    kept.push(item);
  }
  return { actions: kept, refused };
}
