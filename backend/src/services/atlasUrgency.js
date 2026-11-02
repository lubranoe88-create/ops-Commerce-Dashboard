/**
 * X5 urgency classifier.
 *
 * Ingress and problems get a 0–100 score. The resident still records the
 * event. It speaks and interrupts the operator only at or above the
 * threshold. A wake is the operator opening the plancia, so that shot
 * always speaks. Below the threshold the ingress stays quiet.
 */
export const URGENCY_THRESHOLD = 60;

const SEVERITY = Object.freeze({
  critical: 95,
  high: 80,
  medium: 55,
  low: 25,
});

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

export function scoreProblem(problem) {
  const severity = SEVERITY[String(problem?.severity || "").toLowerCase()] || 0;
  const kind = String(problem?.kind || "").toLowerCase();
  if (kind === "integrity") return Math.max(severity, 90);
  if (kind === "function-board" || kind === "function") return Math.max(severity, 70);
  if (severity) return severity;
  return 30;
}

function scoreNews(event) {
  let best = 30;
  for (const item of asList(event?.items).concat(asList(event?.item))) {
    const change = String(item?.change || "");
    if (change === "updated") best = Math.max(best, 50);
    else if (change === "inserted" || change === "new") best = Math.max(best, 45);
    else best = Math.max(best, 30);
  }
  return best;
}

export function scoreIngressEvent(event) {
  if (!event || typeof event !== "object") return 0;
  const direct = SEVERITY[String(event.severity || "").toLowerCase()] || 0;
  if (event.kind === "problems") {
    const rows = asList(event.problems);
    const nested = rows.reduce((max, problem) => Math.max(max, scoreProblem(problem)), 0);
    return Math.max(direct, nested, rows.length ? 40 : 0);
  }
  if (event.kind === "news") return Math.max(direct, scoreNews(event));
  if (event.kind === "updates") {
    const blob = `${event.update?.title || event.title || ""} ${event.update?.detail || event.detail || ""}`.toLowerCase();
    if (/\bintegrit|\berror[ei]\b|\bfail|\bsandbox\b|\bcritic/.test(blob)) return Math.max(direct, 75);
    return Math.max(direct, 20);
  }
  if (event.kind === "proactive") return Math.max(direct, 25);
  return Math.max(direct, 15);
}

function scoreBundle(bundle, integrity) {
  let score = 0;
  const reasons = [];
  if (integrity && integrity.ok === false) {
    score = Math.max(score, 90);
    reasons.push("integrità");
  }
  const boardErr = Number(bundle?.board?.error) || 0;
  if (boardErr > 0) {
    score = Math.max(score, 65);
    reasons.push("quadro");
  }
  const health = String(bundle?.health?.status || "").toLowerCase();
  if (health === "error" || health === "down") {
    score = Math.max(score, 90);
    reasons.push("salute");
  } else if (health && !["ok", "n/d", "unknown"].includes(health)) {
    score = Math.max(score, 70);
    reasons.push("salute");
  }
  for (const problem of asList(bundle?.problems)) {
    const value = scoreProblem(problem);
    if (value >= score) {
      score = value;
      if (value >= URGENCY_THRESHOLD) reasons.push(problem?.title || problem?.kind || "problema");
    }
  }
  return { score, reasons };
}

export function classifyUrgency({ kind = "ingress", bundle = null, batch = null, integrity = null } = {}) {
  const reasons = [];
  let score = 0;
  if (kind === "wake") {
    const scored = scoreBundle(bundle, integrity);
    score = scored.score;
    reasons.push(...scored.reasons);
  }
  for (const event of asList(batch)) {
    const value = scoreIngressEvent(event);
    if (value >= score) score = value;
    if (value >= URGENCY_THRESHOLD) reasons.push(event.kind || "ingresso");
  }
  const opened = kind === "wake";
  const interrupt = opened || score >= URGENCY_THRESHOLD;
  return {
    score,
    threshold: URGENCY_THRESHOLD,
    interrupt,
    quiet: !interrupt,
    speak: interrupt,
    reasons: [...new Set(reasons)].slice(0, 4),
  };
}
