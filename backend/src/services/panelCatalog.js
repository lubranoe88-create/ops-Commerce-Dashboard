/** Static panel catalog — AI system understanding (no LLM spend to load). */
export const PANEL_CATALOG = [
  {
    id: "map",
    label: "MAPPA",
    purpose: "Cesium grayscale globe with tops pins, arcs, Re:Earth buildings, news pins",
    actions: ["map", "zoom-in", "zoom-out", "zoom-citta", "orbit", "nord", "fly", "refresh"],
  },
  {
    id: "pipeline",
    label: "PIPELINE",
    purpose: "3D graph of data sources → judge → memory; inspect open errors",
    actions: ["pipeline"],
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
    actions: ["chat", "analizza", "mic"],
  },
  {
    id: "side",
    label: "Side rail",
    purpose: "Tops list / module tools: fly, compare, correct, notes",
    actions: ["fly", "confronta", "filtro-score", "filtro-reset", "coverage-next"],
  },
];

export const SYSTEM_CARD = `OPS Commerce Intel dashboard.
Panels: MAPPA (globe), PIPELINE, MEMORY, CHAT, side rail.
AI analyzes mechanical SQLite data only — never scrapes/collects.
Tools: emit actions[] for zoom/fly/module switches; browser_use only as fallback.
Budget: hard €/day OpenRouter cap — unused budget stays unused.`;

export const ACTION_ALLOWLIST = new Set([
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
  "analizza",
  "mic",
  "refresh",
  "confronta",
  "filtro-score",
  "filtro-reset",
  "coverage-next",
  "strumenti",
]);

export function sanitizeActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions
    .map((a) => (typeof a === "string" ? a : a?.type || a?.action))
    .filter((a) => ACTION_ALLOWLIST.has(a));
}
