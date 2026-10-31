import { config } from "../config.js";
import {
  dayKeyInTz,
  getUsageDay,
  recordAiSpend,
} from "../memory/aiStore.js";

/** Rough USD→EUR; OpenRouter bills USD. Cap is stored/enforced in EUR. */
const USD_TO_EUR = Number(process.env.AI_USD_EUR_RATE || "0.92") || 0.92;

/** Fallback $/1M tokens when usage.cost absent (router cheap / main mid). */
const PRICE_PER_M = {
  router: { in: 0.06, out: 0.06 },
  main: { in: 0.15, out: 0.4 },
  /** Grok power tier — higher estimate; actual cost from OpenRouter usage when present. */
  grok: { in: 1.25, out: 2.5 },
};

export function budgetDayKey() {
  return dayKeyInTz(config.aiBudgetTz);
}

export function estimateCostUsd(tier, promptTokens, completionTokens) {
  const p = PRICE_PER_M[tier] || PRICE_PER_M.router;
  return (promptTokens / 1e6) * p.in + (completionTokens / 1e6) * p.out;
}

export function getBudgetStatus() {
  const dayKey = budgetDayKey();
  const row = getUsageDay(dayKey);
  const spentEur = Number(row?.spent_eur || 0);
  const cap = config.aiDailyBudgetEur;
  const ratio = cap > 0 ? spentEur / cap : 1;
  return {
    dayKey,
    spentEur,
    spentUsd: Number(row?.spent_usd || 0),
    capEur: cap,
    remainingEur: Math.max(0, cap - spentEur),
    ratio,
    softBlocked: ratio >= config.aiBudgetSoftRatio,
    hardBlocked: ratio >= config.aiBudgetHardRatio,
    routerCalls: row?.router_calls || 0,
    mainCalls: row?.main_calls || 0,
    grokCalls: row?.grok_calls || 0,
    blockedEscalations: row?.blocked_escalations || 0,
  };
}

/**
 * Hard cap semantics: never fill the budget.
 * - hardBlocked → no LLM calls
 * - softBlocked → router only (no main escalation)
 */
export function assertCanCall(tier) {
  const st = getBudgetStatus();
  if (st.hardBlocked) {
    const err = new Error("AI daily spend cap reached — analysis paused (mechanical data still available)");
    err.code = "AI_BUDGET_HARD";
    err.status = 429;
    err.budget = st;
    throw err;
  }
  if ((tier === "main" || tier === "grok") && st.softBlocked) {
    const err = new Error(
      "AI soft budget band — power/main models blocked; using cheap agent only",
    );
    err.code = "AI_BUDGET_SOFT";
    err.status = 429;
    err.budget = st;
    recordAiSpend({
      dayKey: st.dayKey,
      tier,
      model: "blocked",
      blocked: true,
      note: "soft_band",
    });
    throw err;
  }
  return st;
}

export function recordCompletion({ tier, model, usage }) {
  const dayKey = budgetDayKey();
  const pt = Number(usage?.prompt_tokens || 0);
  const ct = Number(usage?.completion_tokens || 0);
  let costUsd =
    typeof usage?.cost === "number"
      ? usage.cost
      : estimateCostUsd(tier, pt, ct);
  // Some OpenRouter payloads nest cost
  if (!costUsd && typeof usage?.total_cost === "number") costUsd = usage.total_cost;
  const costEur = costUsd * USD_TO_EUR;
  return recordAiSpend({
    dayKey,
    tier,
    model: model || tier,
    promptTokens: pt,
    completionTokens: ct,
    costUsd,
    costEur,
  });
}
