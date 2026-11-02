/**
 * Italian letter-by-letter gate for codes, emails, and IDs.
 * The alphabet pack must normalize before a voice is locked for those reads.
 * Unknown characters fail soft to "simbolo" and the spelled form is what TTS receives.
 */

export const ALPHABET_PACK = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@.-/#%+";

export const ITALIAN_LETTERS = {
  A: "a",
  B: "bi",
  C: "ci",
  D: "di",
  E: "e",
  F: "effe",
  G: "gi",
  H: "acca",
  I: "i",
  J: "i lunga",
  K: "kappa",
  L: "elle",
  M: "emme",
  N: "enne",
  O: "o",
  P: "pi",
  Q: "cu",
  R: "erre",
  S: "esse",
  T: "ti",
  U: "u",
  V: "vu",
  W: "doppia vu",
  X: "ics",
  Y: "ipsilon",
  Z: "zeta",
};

export const ITALIAN_DIGITS = {
  0: "zero",
  1: "uno",
  2: "due",
  3: "tre",
  4: "quattro",
  5: "cinque",
  6: "sei",
  7: "sette",
  8: "otto",
  9: "nove",
};

export const ITALIAN_SYMBOLS = {
  "@": "chiocciola",
  ".": "punto",
  "-": "trattino",
  "/": "barra",
  "#": "cancelletto",
  "%": "percento",
  "+": "più",
};

const TOKEN = /[A-Za-z0-9@.+#/%_+-]+/g;
const LABEL_HEAD = /\b(?:codice|code|email|e-mail|id|pin|iban|seriale)\b\s*[:#]?/gi;

export function spellCharacter(ch) {
  const raw = String(ch || "");
  if (!raw) return null;
  if (ITALIAN_DIGITS[raw]) return ITALIAN_DIGITS[raw];
  if (ITALIAN_SYMBOLS[raw]) return ITALIAN_SYMBOLS[raw];
  const upper = raw.toUpperCase();
  if (/[A-Z]/.test(upper) && ITALIAN_LETTERS[upper]) return ITALIAN_LETTERS[upper];
  return null;
}

export function spellToken(token) {
  const parts = [];
  let unknown = 0;
  for (const ch of String(token || "")) {
    if (/\s/.test(ch)) continue;
    const said = spellCharacter(ch);
    if (!said) {
      unknown += 1;
      parts.push("simbolo");
    } else {
      parts.push(said);
    }
  }
  return {
    text: parts.join(", "),
    unknown,
    locked: unknown === 0 && parts.length > 0,
  };
}

/** Run the A–Z / 0–9 / symbol pack before a voice may lock for informational reads. */
export function lockVoiceForInformationalRead(pack = ALPHABET_PACK) {
  const rows = [];
  const missing = [];
  for (const ch of String(pack)) {
    const said = spellCharacter(ch);
    if (!said) missing.push(ch);
    else rows.push({ ch, said });
  }
  const locked = missing.length === 0 && rows.length === [...String(pack)].length && rows.length > 0;
  return {
    locked,
    missing,
    rows,
    text: rows.map((row) => row.said).join(", "),
    fallback: locked ? null : "spelled",
  };
}

function isInformationalToken(token) {
  if (!token || token.length < 2) return false;
  if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(token)) return true;
  if (/[@#%+]/.test(token) && /[A-Za-z0-9]/.test(token)) return true;
  if (/^[A-Za-z0-9]+(?:[./-][A-Za-z0-9]+)+$/.test(token) && (/\d/.test(token) || token.length >= 4)) {
    return true;
  }
  if (/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{2,}$/.test(token)) return true;
  if (/^\d{4,}$/.test(token)) return true;
  return false;
}

function mergeSpans(spans) {
  const sorted = spans
    .filter((span) => span && span.end > span.start)
    .sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (!last || span.start > last.end) out.push({ start: span.start, end: span.end });
    else if (span.end > last.end) last.end = span.end;
  }
  return out;
}

function shouldSpellLabeled(token) {
  if (!token) return false;
  if (isInformationalToken(token)) return true;
  if (/[A-Z]/.test(token) && token.length >= 2 && token.length <= 12) return true;
  if (/[^A-Za-zÀ-ÿ'-]/.test(token)) return true;
  return false;
}

function findLabeledSpans(raw) {
  const spans = [];
  for (const match of raw.matchAll(LABEL_HEAD)) {
    let index = match.index + match[0].length;
    while (index < raw.length && /\s/.test(raw[index])) index += 1;
    const filler = /^(?:è|e|di)\b/i.exec(raw.slice(index));
    if (filler) {
      index += filler[0].length;
      while (index < raw.length && /\s/.test(raw[index])) index += 1;
    }
    const token = /^[^\s,;]+/.exec(raw.slice(index));
    if (!token || !shouldSpellLabeled(token[0])) continue;
    spans.push({ start: index, end: index + token[0].length });
  }
  return spans;
}

export function findInformationalSpans(text) {
  const raw = String(text || "");
  const spans = [];
  for (const match of raw.matchAll(TOKEN)) {
    const token = match[0];
    if (!isInformationalToken(token)) continue;
    spans.push({ start: match.index, end: match.index + token.length });
  }
  spans.push(...findLabeledSpans(raw));
  return mergeSpans(spans).map((span) => ({
    ...span,
    value: raw.slice(span.start, span.end),
  }));
}

/**
 * Normalize a line for TTS. Informational spans are always spoken letter by letter.
 * A failed alphabet lock or an unknown character still returns the spelled form.
 */
export function normalizeSpeakText(text, pack = ALPHABET_PACK) {
  const gate = lockVoiceForInformationalRead(pack);
  const raw = String(text || "")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) {
    return {
      text: "",
      spoken: "",
      spelled: false,
      voiceLocked: false,
      fallback: "empty",
      unknown: 0,
      gate,
    };
  }
  const spans = findInformationalSpans(raw);
  if (!spans.length) {
    return {
      text: raw,
      spoken: raw,
      spelled: false,
      voiceLocked: gate.locked,
      fallback: gate.locked ? null : "spelled",
      unknown: 0,
      gate,
    };
  }
  let unknown = 0;
  let out = "";
  let cursor = 0;
  for (const span of spans) {
    out += raw.slice(cursor, span.start);
    const spelled = spellToken(span.value);
    unknown += spelled.unknown;
    if (out && !/\s$/.test(out)) out += " ";
    out += spelled.text;
    cursor = span.end;
  }
  out = `${out}${raw.slice(cursor)}`.replace(/\s+/g, " ").trim();
  const voiceLocked = Boolean(gate.locked && unknown === 0);
  return {
    text: out,
    spoken: out,
    spelled: true,
    voiceLocked,
    fallback: voiceLocked ? null : "spelled",
    unknown,
    gate,
  };
}
