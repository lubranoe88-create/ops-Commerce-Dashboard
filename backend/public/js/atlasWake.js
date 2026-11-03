/**
 * Desktop Phase Later always-on + X6 wake-word (Atlas).
 * Pure helpers: the plancia arms a listener only when the env is on and the
 * host is desktop. iPad / iPhone / iPod stay Phase Now (gesture MIC).
 */

export const WAKE_WORD = "Atlas";

export const WAKE_PHRASES = Object.freeze([
  "ehi atlas",
  "hey atlas",
  "ei atlas",
  "ok atlas",
  "ciao atlas",
  "atlas",
]);

/** Lowercase, strip accents and punctuation, collapse spaces. */
export function normalizeWakeText(text = "") {
  return String(text || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the transcript contains an Atlas wake phrase as whole words.
 * "atlas", "ehi atlas", and "hey atlas" match; "atlante" does not.
 */
export function matchesWakeWord(text) {
  const norm = normalizeWakeText(text);
  if (!norm) return false;
  const padded = ` ${norm} `;
  return WAKE_PHRASES.some((phrase) => padded.includes(` ${phrase} `));
}

/**
 * Text after a leading wake phrase. Empty when the utterance is only the wake
 * word, or when the word sits in the middle of another sentence.
 */
export function wakeCommandRemainder(text) {
  const norm = normalizeWakeText(text);
  if (!matchesWakeWord(norm)) return "";
  const phrases = [...WAKE_PHRASES].sort((a, b) => b.length - a.length);
  for (const phrase of phrases) {
    if (norm === phrase) return "";
    if (norm.startsWith(`${phrase} `)) return norm.slice(phrase.length).trim();
  }
  return "";
}

function voiceNavigator(host) {
  if (host && typeof host === "object") return host;
  if (typeof navigator !== "undefined") return navigator;
  return {};
}

/**
 * Desktop voice host. False for iPhone, iPad, and iPod, including the iPadOS
 * desktop UA (Macintosh / MacIntel + maxTouchPoints > 1).
 * @param {string} [ua] defaults to navigator.userAgent
 * @param {{ userAgent?: string, platform?: string, maxTouchPoints?: number }} [host]
 */
export function isDesktopVoiceHost(ua, host) {
  const nav = voiceNavigator(host);
  const agent = ua == null ? String(nav.userAgent || "") : String(ua);
  if (/iPhone|iPad|iPod/i.test(agent)) return false;
  const touch = Number(nav.maxTouchPoints || 0);
  const platform = String(nav.platform || "");
  if (touch > 1 && (/Macintosh|Mac OS X/i.test(agent) || (platform === "MacIntel" && !agent))) {
    return false;
  }
  if (!agent) return false;
  return true;
}

/** True only when VOICE_ALWAYS_ON is on and the client is a desktop host. */
export function canArmAlwaysOn({ alwaysOnEnv = false, desktop = false } = {}) {
  return Boolean(alwaysOnEnv) && Boolean(desktop);
}

function pack(action, enabled, phase) {
  return {
    action,
    enabled: Boolean(enabled),
    phase,
    wakeWord: WAKE_WORD,
  };
}

/**
 * Desktop always-on listener.
 * phases: off | arming | listening | waking | in-call
 * On wake/transcript match while listening → action open-call, phase waking.
 * call-open then moves to in-call. call-end while still enabled → listening.
 *
 * @param {{ phase?: string, enabled?: boolean }} state
 * @param {"enable"|"disable"|"mic-ready"|"mic-dead"|"transcript"|"wake"|"call-open"|"call-end"|{type?: string, text?: string}} event
 * @param {{ text?: string }} [payload]
 */
export function reduceAlwaysOn(state = {}, event, payload = {}) {
  const type = event && typeof event === "object"
    ? String(event.type || event.event || "")
    : String(event || "");
  const text = event && typeof event === "object"
    ? String(event.text ?? payload?.text ?? "")
    : String(payload?.text ?? "");
  const enabled = Boolean(state?.enabled);
  const phase = state?.phase || (enabled ? "arming" : "off");

  if (type === "disable") return pack("disable", false, "off");

  if (type === "mic-dead") {
    if (!enabled) return pack("mic-dead", false, "off");
    return pack("rearm", true, "arming");
  }

  if (type === "enable") {
    if (enabled && phase !== "off") return pack("keep", true, phase);
    return pack("arm", true, "arming");
  }

  if (!enabled) return pack("ignore", false, "off");

  if (type === "mic-ready") {
    if (phase === "in-call") return pack("keep", true, "in-call");
    if (phase === "listening") return pack("keep", true, "listening");
    return pack("listen", true, "listening");
  }

  if (type === "call-open") return pack("pause-listen", true, "in-call");

  if (type === "call-end") return pack("resume-listen", true, "listening");

  if (type === "wake" || type === "transcript") {
    if (phase !== "listening") return pack("ignore", true, phase);
    const hit = type === "wake" || matchesWakeWord(text);
    if (hit) return pack("open-call", true, "waking");
    return pack("keep", true, "listening");
  }

  return pack("keep", true, phase);
}
