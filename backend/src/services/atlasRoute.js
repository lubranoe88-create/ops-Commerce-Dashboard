/**
 * Atlas turn router. One specialist per operational turn.
 * The speaker stays Atlas. This file is copied to public/js and
 * backend/public/js. Keep it free of Node-only imports.
 */
import { planHandsFromUtterance } from "./atlasHandsPlan.js";

export const ATLAS_SPECIALISTS = Object.freeze([
  { id: "state", label: "Stato" },
  { id: "news", label: "News" },
  { id: "hands", label: "Mani" },
  { id: "research", label: "Ricerca" },
]);

export const ATLAS_WORKFLOWS = Object.freeze([
  {
    id: "morning-open",
    title: "Apertura mattutina",
    aliases: ["morning-open", "morning open", "apertura mattutina", "buongiorno plancia"],
    steps: [
      { id: "wake", kind: "wake" },
      { id: "module", kind: "module", module: "" },
      { id: "problems", kind: "problems" },
    ],
  },
  {
    id: "status-round",
    title: "Giro di stato",
    aliases: ["status-round", "giro di stato", "giro stato"],
    steps: [
      { id: "status", kind: "status" },
      { id: "news", kind: "news" },
      { id: "problems", kind: "problems" },
    ],
  },
]);

const STATE_BLOCKED =
  /^(cerca|ricerca|search|memorizza|ricorda|salva\s+in\s+memoria|problemi|errori|monitoraggio|risolvi|sistema|apri|vai|mostra|zoom)\b/;
const STATE_HINT =
  /\b(stato|istantanea|snapshot|salute|health|come\s+sta|quadro(?:\s+funzioni)?|function\s*board|pins?|tops?|classifica|problemi\s+aperti|quanti\s+problemi|numero\s+di\s+problemi|quanti\s+errori|errori\s+aperti|aggiornamenti|modulo\s+aperto|quale\s+modulo|che\s+modulo|modulo\s+e\s+aperto|modulo\s+è\s+aperto)\b/;
const STATE_QUESTION =
  /[?]|(?:^|\s)(qual[ei]|quanti|quante|come|dimmi|stato|salute|riepilogo|snapshot|istantanea|tops?|pins?|quadro|aggiornamenti|classifica)\b/;

function normalize(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeAlias(text) {
  return normalize(text).replace(/[.!?]+$/g, "").trim();
}

function isStateQuestion(text) {
  const t = normalize(text);
  if (!t || t.length > 500) return false;
  if (STATE_BLOCKED.test(t)) return false;
  if (!STATE_HINT.test(t)) return false;
  if (!STATE_QUESTION.test(t)) return false;
  return true;
}

function isProblems(text) {
  return /^(problemi|errori|monitoraggio|cosa\s+da\s+sistemare|risolvi|sistema)\b/.test(normalize(text));
}

function isMemoryWrite(text) {
  return /^(memorizza|ricorda|salva\s+in\s+memoria)\b/.test(normalize(text));
}

function isMemoryRecall(text) {
  const t = normalize(text);
  if (!t) return false;
  return /^(memoria|cosa\s+ricordi|leggi\s+memoria|note\s+in\s+memoria)\b/.test(t) || /\bcerca\s+in\s+memoria\b/.test(t);
}

function isExplicitSearch(text) {
  const t = normalize(text);
  if (!t || isMemoryRecall(t)) return false;
  return /^(cerca|ricerca|search|agent\s*q\s+cerca)\b/.test(t) || /\b(cerca|ricerca)\s+.+/.test(t);
}

function refusesImplicit(text) {
  if (isExplicitSearch(text) || isMemoryWrite(text) || isMemoryRecall(text)) return false;
  return /\b(sandbox|filesystem|nei\s+file|sul\s+disco|nel\s+database|memoria\s+espandibile|cerca\s+nei\s+file|ricerca\s+libera)\b/.test(normalize(text));
}

function isNewsTurn(text) {
  const t = normalize(text);
  if (!t || t.length > 180) return false;
  if (planHandsFromUtterance(text).matched) return false;
  return /^(news|notizie|ultime notizie|rassegna(?:\s+stampa)?|che news|quali news|spiegami le news|spiega le news)\b/.test(t);
}

function isHandsTurn(text) {
  if (planHandsFromUtterance(text).matched) return true;
  return /^(mani|agent q|atlas mani)\b/.test(normalize(text));
}

export function workflowById(id) {
  const key = String(id || "").trim().toLowerCase();
  return ATLAS_WORKFLOWS.find((workflow) => workflow.id === key) || null;
}

export function matchWorkflowUtterance(text) {
  const body = normalizeAlias(text).replace(/^(?:atlas|agent q|esegui|avvia|lancia|playbook|workflow|skill)\s+/, "");
  if (!body) return null;
  return (
    ATLAS_WORKFLOWS.find((workflow) => workflow.aliases.some((alias) => normalize(alias) === body)) || null
  );
}

function candidate(id, score, extra = {}) {
  return { id, score, intent: extra.intent || id, ...extra };
}

/**
 * Pick at most one specialist. General chat stays with Atlas (specialist null).
 * `fanout` is always false: the other specialists are not called.
 */
export function routeAtlasTurn(text) {
  const raw = String(text || "").trim();
  const base = {
    name: "Atlas",
    speaker: "Atlas",
    strategy: "atlas-one-specialist-v1",
    fanout: false,
    specialist: null,
    intent: "",
    workflowId: "",
    resolve: false,
    score: 0,
    selected: [],
    considered: [],
  };
  if (!raw) return base;

  const workflow = matchWorkflowUtterance(raw);
  const considered = [];
  if (workflow) considered.push(candidate("hands", 100, { intent: "workflow", workflowId: workflow.id }));
  if (isMemoryRecall(raw)) considered.push(candidate("research", 95, { intent: "memory-recall" }));
  else if (isMemoryWrite(raw)) considered.push(candidate("research", 95, { intent: "memory-write" }));
  else if (isExplicitSearch(raw)) considered.push(candidate("research", 90, { intent: "search" }));
  else if (refusesImplicit(raw)) considered.push(candidate("research", 85, { intent: "refused" }));
  if (isStateQuestion(raw)) considered.push(candidate("state", 80, { intent: "state" }));
  if (isNewsTurn(raw)) considered.push(candidate("news", 75, { intent: "news" }));
  if (isProblems(raw)) {
    considered.push(candidate("state", 70, { intent: "problems", resolve: /^(risolvi|sistema)\b/.test(normalize(raw)) }));
  }
  if (isHandsTurn(raw)) considered.push(candidate("hands", 60, { intent: "hands" }));

  considered.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const winner = considered[0];
  if (!winner) return { ...base, considered };
  return {
    ...base,
    specialist: winner.id,
    intent: winner.intent,
    workflowId: winner.workflowId || "",
    resolve: Boolean(winner.resolve),
    score: winner.score,
    selected: [winner.id],
    considered: considered.map((row) => ({ id: row.id, score: row.score, intent: row.intent })),
  };
}
