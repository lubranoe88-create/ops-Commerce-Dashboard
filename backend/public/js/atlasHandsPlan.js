/**
 * Deterministic Atlas hand plan.
 *
 * Zoom, module navigation, sandbox documents, and the briefing popup resolve
 * here without a model call. The server gates the ids (L3). The client runs
 * the same plan through runHoloAction when the server plan cannot be reached.
 * This file is copied to public/js and backend/public/js. Keep it free of
 * Node-only imports.
 */

const ZOOM_SPEAK = {
  "zoom-in": "Zoom in sul globo.",
  "zoom-out": "Zoom out sul globo.",
  "zoom-citta": "Zoom città sul globo.",
  "zoom-paese": "Zoom paese sul globo.",
  "zoom-continente": "Zoom continente sul globo.",
  "zoom-world": "Zoom mondo sul globo.",
};

const MODULE_SPEAK = {
  map: "Apro la mappa.",
  pipeline: "Apro la pipeline.",
  memory: "Apro la memory.",
  chat: "Apro la chat.",
  refresh: "Aggiorno la plancia.",
  briefing: "Apro il briefing.",
};

function emptyPlan() {
  return {
    matched: false,
    actions: [],
    document: "",
    briefing: false,
    speak: "",
    engine: "atlas-hands-plan",
  };
}

function normalize(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ");
}

function commandBody(lower) {
  return lower.replace(/^(?:agent\s*q|atlas|mani)\s+/, "");
}

function zoomIdFrom(body) {
  if (!body || body.length > 80) return "";
  if (/zoom\s*paese|zoom\s*country/.test(body)) return "zoom-paese";
  if (/zoom\s*continente/.test(body)) return "zoom-continente";
  if (/zoom\s*(mondo|world|globo|terra)|vista\s*(mondo|world)/.test(body)) return "zoom-world";
  if (/zoom\s*out|\ballontana\b|\briduci\b|piu\s*lontano/.test(body)) return "zoom-out";
  if (/zoom\s*in|\bavvicina\b|\bingrandisci\b|piu\s*vicino/.test(body)) return "zoom-in";
  if (/zoom\s*(citta|city)/.test(body) || /^(zoom|citta|city)$/.test(body)) return "zoom-citta";
  if (/\bzoom\b/.test(body)) return "zoom-citta";
  return "";
}

function moduleIdFrom(body) {
  if (!body || body.length > 72) return "";
  const verb = /^(?:apri|vai(?:\s+a|\s+su|\s+alla|\s+al)?|mostra|porta(?:mi)?(?:\s+a|\s+su)?|controlla\s+modulo)\b/.test(body);
  const bare = /^(?:mappa|map|cartina|globo|pipeline|memory|memoria|chat)$/.test(body);
  // A bare module name or a navigation verb. A longer question that merely
  // mentions the module stays in chat.
  if (!verb && !bare) return "";
  if (/\bpipeline\b/.test(body)) return "pipeline";
  if (/\b(?:memory|memoria)\b/.test(body)) return "memory";
  if (/\bchat\b/.test(body)) return "chat";
  if (/\b(?:mappa|map|cartina)\b/.test(body) || /^(?:globo)$/.test(body) || /\bapri\s+(?:il\s+)?globo\b/.test(body)) {
    return "map";
  }
  return "";
}

function planFromBody(raw, body) {
  const doc = String(raw || "").match(/^(?:(?:agent\s*q|atlas|mani)\s+)?(?:apri|mostra|leggi)\s+(?:il\s+|la\s+|lo\s+)?(?:documento|doc|file)\s+(\S.*)$/i);
  if (doc) {
    const path = doc[1].trim().replace(/^sandbox:\/\//i, "");
    if (!path || path.includes("..") || path.startsWith("/") || path.startsWith("\\") || path.includes("\\")) {
      return {
        matched: true,
        actions: [],
        document: "",
        briefing: false,
        speak: "Percorso documento non consentito.",
        engine: "atlas-hands-plan",
      };
    }
    return {
      matched: true,
      actions: ["document"],
      document: path,
      briefing: false,
      speak: `Apro il documento ${path}.`,
      engine: "atlas-hands-plan",
    };
  }
  if (/^(?:apri|mostra|vedi)?\s*(?:il\s+|lo\s+)?briefing\b/.test(body) && body.length <= 48) {
    return {
      matched: true,
      actions: ["briefing"],
      document: "",
      briefing: true,
      speak: MODULE_SPEAK.briefing,
      engine: "atlas-hands-plan",
    };
  }
  const zoom = zoomIdFrom(body);
  if (zoom) {
    return {
      matched: true,
      actions: [zoom],
      document: "",
      briefing: false,
      speak: ZOOM_SPEAK[zoom] || "Zoom sul globo.",
      engine: "atlas-hands-plan",
    };
  }
  const moduleId = moduleIdFrom(body);
  if (moduleId) {
    return {
      matched: true,
      actions: [moduleId],
      document: "",
      briefing: false,
      speak: MODULE_SPEAK[moduleId] || "Apro il modulo.",
      engine: "atlas-hands-plan",
    };
  }
  if (/^(?:aggiorna|refresh|ricalcola)\b/.test(body) && body.length <= 40) {
    return {
      matched: true,
      actions: ["refresh"],
      document: "",
      briefing: false,
      speak: MODULE_SPEAK.refresh,
      engine: "atlas-hands-plan",
    };
  }
  return emptyPlan();
}

export function planHandsFromUtterance(text) {
  const raw = String(text || "").trim();
  const lower = normalize(raw);
  if (!lower) return emptyPlan();
  const body = commandBody(lower);
  const plan = planFromBody(raw, body);
  if (plan.matched) return plan;
  if (body !== lower) return planFromBody(raw, lower);
  return plan;
}

export function voiceDefersToAtlasHands(text) {
  return planHandsFromUtterance(text).matched;
}

export function payloadFromLocalPlan(plan) {
  const actions = Array.isArray(plan?.actions) ? plan.actions : [];
  return {
    ok: true,
    actions,
    ask: [],
    tagged: actions.map((id) => ({ id, mode: "auto", reason: "hands-plan" })),
    speak: plan?.speak || "",
    document: plan?.document || "",
    briefing: Boolean(plan?.briefing),
    engine: plan?.engine || "atlas-hands-plan",
  };
}
