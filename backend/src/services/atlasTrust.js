/**
 * C12 trust surface. Every Atlas action carries auto vs ask.
 * The compact line is safe to put in a chat bubble.
 */

export function trustLineFromTagged(tagged = []) {
  const autos = [];
  const asks = [];
  for (const step of Array.isArray(tagged) ? tagged : []) {
    const id = String(step?.id || step || "").trim();
    if (!id) continue;
    if (step?.mode === "ask") asks.push(id);
    else autos.push(id);
  }
  const parts = [];
  if (autos.length) parts.push(`AUTO ${autos.join(", ")}`);
  if (asks.length) parts.push(`ASK ${asks.join(", ")}`);
  if (!parts.length) return "";
  return `Affidabilità · ${parts.join(" · ")}`;
}

/** Read-only results (state, wake with no hands) are AUTO letture. */
export function trustLineForResult(tagged, { empty = "lettura" } = {}) {
  const line = trustLineFromTagged(tagged);
  if (line) return line;
  return `Affidabilità · AUTO · ${empty}`;
}

export function trustModeFromTagged(tagged = []) {
  const list = Array.isArray(tagged) ? tagged : [];
  if (list.some((step) => step?.mode === "ask")) return "ask";
  if (list.length) return "auto";
  return "auto";
}
