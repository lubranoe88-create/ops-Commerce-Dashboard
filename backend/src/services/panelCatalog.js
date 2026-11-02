/** Static panel catalog — AI system understanding (no LLM spend to load). */
import { ATLAS_PERSONA } from "./atlasPersonality.js";

export const PANEL_CATALOG = [
  {
    id: "map",
    label: "MAPPA",
    purpose: "Cesium grayscale globe with tops pins, arcs, Re:Earth buildings, news pins",
    actions: ["map", "zoom-in", "zoom-out", "zoom-citta", "orbit", "nord", "fly", "refresh", "focus-top"],
  },
  {
    id: "pipeline",
    label: "PIPELINE",
    purpose: "3D graph of data sources → judge → memory; inspect open errors",
    actions: ["pipeline", "inspect"],
  },
  {
    id: "memory",
    label: "MEMORY",
    purpose: "Concept/link knowledge graph from SQLite concepts",
    actions: ["memory"],
  },
  {
    id: "chat",
    label: "CHAT",
    purpose: "Conversational AI, briefing, Analizza composer, MIC",
    actions: ["chat", "analizza", "mic", "chat-send"],
  },
  {
    id: "side",
    label: "Side rail",
    purpose: "Tops list / module tools: fly, compare, correct, notes, reorder",
    actions: ["fly", "confronta", "filtro-score", "filtro-reset", "coverage-next", "note", "reorder-tops", "correct"],
  },
];

export const SYSTEM_CARD = `${ATLAS_PERSONA}
OPS Commerce Intel dashboard (plancia).
Panels: MAPPA (globe), PIPELINE, MEMORY, CHAT, side rail.
AI analyzes mechanical SQLite data only — never scrapes/collects.
Tools: emit actions[] for zoom/fly/module switches and paid write tools; browser_use only as fallback.
Budget: hard €/day OpenRouter cap — unused budget stays unused.
Function board: when you detect a broken capability, emit write action
{"type":"report-function","functionId":"<id>","status":"error","errorType":"CODE","detail":"..."}.
Use status ok to clear. Known ids include browser-use, openrouter-key, auth-2fa, proactive-mechanical, proactive-ai, auto-router, cross-thread-memory, chat-attachments, budget-openrouter, paid-ai-turn, mic-voice.
Sandbox search and expandable memory are absent unless the user explicitly asked (cerca, ricerca, memoria). Do not invent those results.`;

/** Client-side UI actions (safe; no confirm). */
export const UI_ACTIONS = [
  "map",
  "pipeline",
  "memory",
  "chat",
  "zoom-in",
  "zoom-out",
  "zoom-citta",
  "zoom-paese",
  "zoom-continente",
  "orbit",
  "nord",
  "fly",
  "focus-top",
  "inspect",
  "analizza",
  "mic",
  "refresh",
  "confronta",
  "filtro-score",
  "filtro-reset",
  "coverage-next",
  "strumenti",
  "tema-cyan",
  "tema-amber",
  "tema-mint",
];

/**
 * Write / mutating tools (paid). Dangerous ones require once-confirm.
 * confirm:true → client must prompt before executing.
 */
export const WRITE_ACTIONS = {
  "chat-send": { confirm: false, paid: true, desc: "Send text into Analizza/chat" },
  note: { confirm: false, paid: true, desc: "Save company note" },
  "reorder-tops": { confirm: true, paid: true, desc: "Persist tops order" },
  correct: { confirm: true, paid: true, desc: "Apply correct/incorrect verdict" },
  "set-goals": { confirm: false, paid: true, desc: "Update Q1–Q3 goals prefs" },
  "set-pref": { confirm: false, paid: true, desc: "Update user preference" },
  "accept-suggestion": { confirm: true, paid: true, desc: "Accept improvement suggestion" },
  "report-function": {
    confirm: false,
    paid: true,
    desc: "Segnala stato funzione sul quadro 2D (ok|error|unverified)",
  },
  browser_use: {
    confirm: false,
    paid: true,
    desc: "Fallback browser-use (Playwright) sulla plancia",
  },
};

export const ACTION_ALLOWLIST = new Set([
  ...UI_ACTIONS,
  ...Object.keys(WRITE_ACTIONS),
]);

export const ACTION_CATALOG = [
  ...UI_ACTIONS.map((a) => ({
    id: a,
    kind: "ui",
    confirm: false,
    paid: false,
  })),
  ...Object.entries(WRITE_ACTIONS).map(([id, meta]) => ({
    id,
    kind: "write",
    confirm: Boolean(meta.confirm),
    paid: Boolean(meta.paid),
    desc: meta.desc,
  })),
];

export function sanitizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions
    .map((a) => {
      if (typeof a === "string") return { type: a };
      if (a && typeof a === "object") {
        const type = a.type || a.action || a.id;
        if (!type) return null;
        return { ...a, type };
      }
      return null;
    })
    .filter((a) => a && ACTION_ALLOWLIST.has(a.type));
}

export function actionNeedsConfirm(action) {
  const type = typeof action === "string" ? action : action?.type;
  return Boolean(WRITE_ACTIONS[type]?.confirm);
}
