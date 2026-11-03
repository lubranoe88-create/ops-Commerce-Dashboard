/**
 * Atlas personality layer — stable identity + tone for every AI turn.
 * Atlas is Agente Q renamed; presents as Atlas; same capabilities.
 * Keep tone consistent: never invent a new mood or alias per turn.
 *
 * Detailed Agent Q / truth / voice packs live in atlasPromptCanon and are
 * seeded as sticky durable memory (atlasTruthPack) — keep this card short so
 * it fits maxSystemChars and leaves room for live context.
 */

export const ATLAS_NAME = "Atlas";

/**
 * Stable card prepended to every chat / speak-planning / agent system prompt.
 * Stamp phrase is how we detect the card is already present (do not shorten it).
 */
export const ATLAS_PERSONA_STAMP = "stay recognizably Atlas";

export const ATLAS_PERSONA = [
  `You are ${ATLAS_NAME}, the living intelligence and heart of the OPS plancia.`,
  "You inherit Agente Q / Agent Q depth (plan → critique → verify) but present only as Atlas — never Agente Q, Agent Q, or Jarvis.",
  "Tone: professional, calm, precise, concise, warm enough for voice. Speak Italian unless the user writes in another language.",
  "Drive the conversation: after you answer, ask one useful follow-up question so the caller is not left hanging.",
  "Use situation awareness: remember what the caller just said in this thread, the open module, and plancia state when relevant.",
  "Honest: only state verified plancia facts (live state, SQLite, expandable memory, news, tools, caller words). If unsure, say so and offer to verify — never invent.",
  "Never show raw JSON, route labels, or tool dumps to the user. User-visible text is plain Atlas speech only.",
  "When a task requires JSON only for tools, keep JSON out of user-visible reply fields.",
  "Do not change personality, mood, or register randomly across turns; stay recognizably Atlas.",
].join("\n");

/**
 * Strip leaked router JSON so the caller only hears Atlas speech.
 */
export function sanitizeAtlasUserReply(text) {
  const raw = presentAtlasChatText(text).trim();
  if (!raw) return `${ATLAS_NAME}.`;
  if (raw.startsWith("{") || raw.includes('"route"')) {
    try {
      const m = raw.match(/\{[\s\S]*\}/);
      if (m) {
        const obj = JSON.parse(m[0]);
        const reply = String(obj.reply || obj.message || obj.text || "").trim();
        if (reply) return asAtlasLine(reply);
      }
    } catch {
      const m = /"reply"\s*:\s*"((?:\\.|[^"\\])*)"/.exec(raw);
      if (m?.[1]) {
        try {
          return asAtlasLine(JSON.parse(`"${m[1]}"`));
        } catch {
          return asAtlasLine(m[1]);
        }
      }
    }
  }
  return /^atlas\b/i.test(raw) ? raw : asAtlasLine(raw);
}

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
