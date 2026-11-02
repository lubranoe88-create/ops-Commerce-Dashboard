/**
 * Atlas personality layer — stable identity + tone for every AI turn.
 * Atlas is Agente Q renamed; presents as Atlas; same capabilities.
 * Keep tone consistent: never invent a new mood or alias per turn.
 */

export const ATLAS_NAME = "Atlas";

/**
 * Stable card prepended to every chat / speak-planning / agent system prompt.
 * Stamp phrase is how we detect the card is already present (do not shorten it).
 */
export const ATLAS_PERSONA_STAMP = "stay recognizably Atlas";

export const ATLAS_PERSONA = [
  `You are ${ATLAS_NAME}, the OPS plancia assistant.`,
  "Always present yourself only as Atlas. Do not adopt, invent, or answer under any other name.",
  "Tone: professional, calm, precise, concise. Italian-friendly: speak Italian unless the user writes in another language.",
  "Be clear and functional: prefer exact facts, numbers, and short action confirmations.",
  "Do not change personality, mood, or register randomly across turns; stay recognizably Atlas.",
  "You operate inside the plancia dashboard: map/globe, modules, memory, chat, hands, news, problems.",
  "When a task requires JSON only, keep that format; use this same tone inside user-visible text fields.",
].join("\n");

/** Italian one-liner for status / UI when a name is required. */
export const ATLAS_STATUS_NAME = ATLAS_NAME;

export function withAtlasPersona(system) {
  const body = String(system || "").trim();
  if (body.includes(ATLAS_PERSONA_STAMP)) return body;
  if (!body) return ATLAS_PERSONA;
  return `${ATLAS_PERSONA}\n\n${body}`;
}

const DEFAULT_THREAD_TITLE = /^(session|nuova chat|new chat)$/i;

/** One system line when chat opens. The client shows it once per browser session. */
export const ATLAS_CHAT_GREETING =
  "Atlas. Sono l’assistente della plancia. Chiedimi un’analisi, la mappa, la pipeline o la memory.";

export function presentAtlasChatText(text) {
  return String(text ?? "").replace(/\bAgente Q\b|\bAgent Q\b|\bAgentQ\b/g, ATLAS_NAME);
}

/** Default or legacy thread titles present as Atlas. Custom titles stay. */
export function presentAtlasThreadTitle(title) {
  const raw = presentAtlasChatText(title).trim();
  if (!raw || DEFAULT_THREAD_TITLE.test(raw)) return ATLAS_NAME;
  return raw.slice(0, 120);
}

/** Mechanical chat replies that never reach the model still speak as Atlas. */
export function asAtlasLine(text) {
  const body = presentAtlasChatText(text).trim();
  if (!body) return `${ATLAS_NAME}.`;
  if (/^atlas\b/i.test(body)) return body;
  return `${ATLAS_NAME}. ${body}`;
}
