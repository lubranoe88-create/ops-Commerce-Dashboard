/**
 * C11 spend / turn awareness.
 * Soft-band status is stated on paid escalations.
 * Crossing the band is ASK: the main/grok call does not start until confirmed.
 * An already-crossed band stays blocked (router only).
 */
import { estimateCostUsd, getBudgetStatus } from "./aiBudget.js";
import { asAtlasLine } from "./atlasPersonality.js";

const USD_TO_EUR = Number(process.env.AI_USD_EUR_RATE || "0.92") || 0.92;

const ESTIMATE_TOKENS = {
  router: { in: 400, out: 200 },
  main: { in: 1800, out: 700 },
  grok: { in: 1800, out: 900 },
};

export function estimateTierEur(tier) {
  const tokens = ESTIMATE_TOKENS[tier] || ESTIMATE_TOKENS.main;
  const priceTier = ESTIMATE_TOKENS[tier] ? tier : "main";
  return estimateCostUsd(priceTier, tokens.in, tokens.out) * USD_TO_EUR;
}

export function formatBandLine(budget, { wouldCross = false, alreadyPast = false, hard = false, tier = "main", unreadable = false } = {}) {
  if (unreadable) {
    return "Non leggo la fascia di spesa. Nessuna escalation finché il budget non è disponibile.";
  }
  const spent = Number(budget?.spentEur || 0);
  const cap = Number(budget?.capEur || 0);
  const softPct = Math.round((Number(budget?.softRatio) || 0.75) * 100);
  const ratioPct = cap > 0 ? Math.round((spent / cap) * 100) : 0;
  const spentText = spent.toFixed(2);
  const capText = cap.toFixed(2);
  if (hard) {
    return `Cap giornaliero raggiunto: €${spentText} su €${capText}. Nessun turno a pagamento. I dati meccanici restano disponibili.`;
  }
  if (alreadyPast) {
    return `Fascia soft già superata (${softPct}% di €${capText}, spesi €${spentText}, ${ratioPct}%). Resto sul modello economico e non escalo.`;
  }
  if (wouldCross) {
    return `Questo turno ${tier} porterebbe la spesa oltre la fascia soft (${softPct}% di €${capText}, ora €${spentText}). Chiedo conferma prima di andare oltre.`;
  }
  return `Fascia soft: €${spentText} su €${capText} (${ratioPct}%, soglia ${softPct}%). Sotto soglia.`;
}

/**
 * Pure decision. `confirm` authorizes one turn that would cross the soft band.
 * It does not authorize a turn that is already past the band or over the hard cap.
 */
export function assessSpendStatus(budget, { tier = "main", confirm = false, estimateEur = 0 } = {}) {
  const estimate = Number.isFinite(Number(estimateEur)) ? Number(estimateEur) : 0;
  const cap = Number(budget?.capEur) || 0;
  const spent = Number(budget?.spentEur) || 0;
  const soft = Number(budget?.softRatio) || 0.75;
  const paidTier = tier === "main" || tier === "grok";
  const hard = Boolean(budget?.hardBlocked || budget?.zeroRemaining);
  const alreadyPast = Boolean(budget?.softBlocked || budget?.hardBlocked);
  const nextRatio = cap > 0 ? (spent + estimate) / cap : 1;
  const wouldCross = paidTier && !alreadyPast && !hard && nextRatio >= soft;
  const blocked = paidTier && (hard || alreadyPast);
  const ask = paidTier && wouldCross && !confirm && !blocked;
  const ratio = cap > 0 ? spent / cap : 0;
  return {
    budget,
    tier,
    estimateEur: estimate,
    alreadyPast,
    wouldCross,
    blocked,
    ask,
    mode: ask || blocked ? "ask" : "auto",
    reason: blocked || ask ? (hard ? "hard-cap" : "spend-past-soft-band") : "within-soft-band",
    line: formatBandLine(budget, { wouldCross, alreadyPast, hard, tier }),
    relevant: alreadyPast || wouldCross || hard || ratio >= 0.5,
  };
}

export function assessLiveSpend({ tier = "main", confirm = false, estimateEur = null } = {}) {
  try {
    const budget = getBudgetStatus();
    return assessSpendStatus(budget, {
      tier,
      confirm,
      estimateEur: estimateEur == null ? estimateTierEur(tier) : estimateEur,
    });
  } catch {
    const paidTier = tier === "main" || tier === "grok";
    return {
      budget: null,
      tier,
      estimateEur: 0,
      alreadyPast: true,
      wouldCross: false,
      blocked: paidTier,
      ask: false,
      mode: "ask",
      reason: "spend-past-soft-band",
      line: formatBandLine(null, { unreadable: true }),
      relevant: true,
      unreadable: true,
    };
  }
}

export function withBudgetLine(reply, assessment, { force = false } = {}) {
  if (!assessment?.line) return String(reply || "");
  if (!force && !assessment.relevant) return String(reply || "");
  const line = asAtlasLine(assessment.line);
  const body = String(reply || "").trim();
  if (!body) return line;
  if (body.includes("Fascia soft") || body.includes("Cap giornaliero") || body.includes("Non leggo la fascia")) {
    return body;
  }
  return `${line}\n${body}`;
}

export function spendAskId(tier) {
  return tier === "grok" ? "escalate-grok" : "escalate-main";
}
