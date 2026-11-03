/**
 * Logica di routing host-side: heuristica + (opzionale) classificazione LLM 8B.
 * Il router piccolo NON esegue tool: al massimo escalate al cervello 35B.
 */

const TOOLISH =
  /\b(memoria|ricord|cerca|status|stato|tool|impost|avvia|termina|hangup|microfono|invia|messagg|deploy|cancella|elimina|scrivi|modifica|pianifica|confronta|perch[eé]|come funzion|spiega|analizza)\b/i;

const EASY =
  /^(ciao|salve|hey|buongiorno|buonasera|buonanotte|thanks|grazie|prego|ok|okay|va bene|s[iì]|no|a dopo|arrivederci|chi sei)\b/i;

export const DEFAULT_POLICY = {
  maxEasyChars: 220,
  minConfidence: 0.75,
  /** heuristic | llm | hybrid */
  mode: "hybrid",
};

/**
 * @param {string} userText
 * @param {{ maxEasyChars?: number }} [policy]
 * @returns {{ route: 'router'|'brain', reason: string, intent?: string, confidence: number }}
 */
export function heuristicRoute(userText, policy = {}) {
  const maxEasyChars = policy.maxEasyChars ?? DEFAULT_POLICY.maxEasyChars;
  const text = (userText || "").trim();
  if (!text) {
    return { route: "brain", reason: "empty", intent: "other", confidence: 1 };
  }
  if (text.length > maxEasyChars) {
    return { route: "brain", reason: "too_long", intent: "complex", confidence: 1 };
  }
  if (TOOLISH.test(text)) {
    return { route: "brain", reason: "toolish_keyword", intent: "tool", confidence: 0.95 };
  }
  if (/\?/.test(text) && text.length > 80) {
    return { route: "brain", reason: "long_question", intent: "complex", confidence: 0.85 };
  }
  if (EASY.test(text) && text.length <= 80) {
    return { route: "router", reason: "easy_greeting", intent: "greeting", confidence: 0.9 };
  }
  // Incerto → in hybrid passerà al LLM router; in heuristic-only → brain (fail-safe)
  return { route: "brain", reason: "uncertain_heuristic", intent: "other", confidence: 0.4 };
}

/**
 * Interpreta l'output JSON del modello 8B in modalità classificazione.
 * @param {string} raw
 */
export function parseRouterClassification(raw) {
  const text = String(raw || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    const route = obj.route === "router" ? "router" : obj.route === "brain" ? "brain" : null;
    if (!route) return null;
    const confidence = Number(obj.confidence);
    return {
      route,
      intent: typeof obj.intent === "string" ? obj.intent : "other",
      confidence: Number.isFinite(confidence) ? confidence : 0,
      reply: typeof obj.reply === "string" ? obj.reply : null,
      reason: "llm_router",
    };
  } catch {
    return null;
  }
}

/**
 * Decisione finale secondo policy.
 * @param {object} args
 * @param {string} args.userText
 * @param {'heuristic'|'llm'|'hybrid'} [args.mode]
 * @param {number} [args.minConfidence]
 * @param {(prompt: string) => Promise<string>} [args.classifyWithRouter] — chiama 8B, ritorna testo
 */
export async function decideRoute(args) {
  const mode = args.mode || process.env.ROUTER_MODE || DEFAULT_POLICY.mode;
  const minConfidence = args.minConfidence ?? DEFAULT_POLICY.minConfidence;
  const heur = heuristicRoute(args.userText, args);

  if (mode === "heuristic") {
    // Fail-safe: uncertain → brain
    if (heur.reason === "uncertain_heuristic") {
      return { ...heur, route: "brain", reason: "heuristic_fail_safe" };
    }
    return heur;
  }

  if (mode === "llm") {
    if (!args.classifyWithRouter) {
      return { route: "brain", reason: "llm_router_unavailable", intent: "other", confidence: 0 };
    }
    const raw = await args.classifyWithRouter(args.userText);
    const parsed = parseRouterClassification(raw);
    if (!parsed) {
      return { route: "brain", reason: "llm_parse_fail", intent: "other", confidence: 0 };
    }
    if (parsed.route === "router" && parsed.confidence < minConfidence) {
      return { ...parsed, route: "brain", reason: "low_confidence" };
    }
    return parsed;
  }

  // hybrid (default): keyword forti subito; solo uncertain → LLM; easy greeting senza LLM
  if (heur.route === "brain" && heur.reason !== "uncertain_heuristic") {
    return heur;
  }
  if (heur.route === "router" && heur.reason === "easy_greeting") {
    return heur;
  }
  if (!args.classifyWithRouter) {
    return { route: "brain", reason: "hybrid_no_llm_fallback", intent: heur.intent, confidence: 0.5 };
  }
  const raw = await args.classifyWithRouter(args.userText);
  const parsed = parseRouterClassification(raw);
  if (!parsed) {
    return { route: "brain", reason: "hybrid_parse_fail", intent: "other", confidence: 0 };
  }
  if (parsed.route === "router" && parsed.confidence < minConfidence) {
    return { ...parsed, route: "brain", reason: "low_confidence" };
  }
  return parsed;
}

export function openaiToolsDisabled() {
  // Contratto: sul router non si passano tools.
  return undefined;
}
