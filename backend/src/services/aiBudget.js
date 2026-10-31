import { config } from "../config.js";
import {
  dayKeyInTz,
  getUsageDay,
  listUsageEvents,
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

/**
 * Hard-cap ledger status.
 * remainingEur is "under cap" — never framed as spend-to-burn.
 * reserveEur is intentionally unused headroom inside the cap.
 */
export function getBudgetStatus() {
  const dayKey = budgetDayKey();
  const row = getUsageDay(dayKey);
  const spentEur = Number(row?.spent_eur || 0);
  const cap = config.aiDailyBudgetEur;
  const reserve = Math.min(config.aiBudgetReserveEur, cap);
  const spendable = Math.max(0, cap - reserve);
  const ratio = cap > 0 ? spentEur / cap : 1;
  const remainingUnderCap = Math.max(0, cap - spentEur);
  const remainingSpendable = Math.max(0, spendable - spentEur);
  const softBlocked = ratio >= config.aiBudgetSoftRatio;
  const hardBlocked =
    ratio >= config.aiBudgetHardRatio || remainingSpendable <= 0 || remainingUnderCap <= 0;
  return {
    dayKey,
    spentEur,
    spentUsd: Number(row?.spent_usd || 0),
    capEur: cap,
    reserveEur: reserve,
    spendableEur: spendable,
    remainingEur: remainingUnderCap,
    remainingSpendableEur: remainingSpendable,
    ratio,
    softRatio: config.aiBudgetSoftRatio,
    hardRatio: config.aiBudgetHardRatio,
    softBlocked,
    hardBlocked,
    zeroRemaining: remainingUnderCap <= 0 || remainingSpendable <= 0,
    routerCalls: row?.router_calls || 0,
    mainCalls: row?.main_calls || 0,
    grokCalls: row?.grok_calls || 0,
    blockedEscalations: row?.blocked_escalations || 0,
    framing: "hard_cap_not_target",
    note: "Unused budget stays unused — never burn to fill the cap.",
  };
}

/** Admin-facing usage snapshot (remaining under cap, never "to burn"). */
export function getUsageAdmin() {
  const budget = getBudgetStatus();
  const events = listUsageEvents(budget.dayKey, 50);
  return {
    budget,
    events,
    message: `Remaining under cap: €${budget.remainingEur.toFixed(2)} (reserve €${budget.reserveEur.toFixed(2)} untouched). Cap is a ceiling, not a spend target.`,
  };
}

/**
 * Hard cap semantics: never fill the budget.
 * - remaining 0 / hardBlocked → no LLM calls (incl. router)
 * - softBlocked → router only (no main/grok escalation)
 */
export function assertCanCall(tier) {
  const st = getBudgetStatus();
  if (st.hardBlocked || st.zeroRemaining) {
    const err = new Error(
      "AI daily spend cap reached — analysis paused (mechanical data still available)",
    );
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

export function canUseBrowserAutomation() {
  const st = getBudgetStatus();
  if (st.remainingEur < config.aiBrowserUseMinRemainingEur) {
    return {
      ok: false,
      reason: "budget_floor",
      minRemainingEur: config.aiBrowserUseMinRemainingEur,
      budget: st,
    };
  }
  return { ok: true, budget: st };
}

export function recordCompletion({ tier, model, usage }) {
  const dayKey = budgetDayKey();
  const pt = Number(usage?.prompt_tokens || 0);
  const ct = Number(usage?.completion_tokens || 0);
  let costUsd =
    typeof usage?.cost === "number"
      ? usage.cost
      : estimateCostUsd(tier, pt, ct);
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

/** Test helper: inject synthetic spend without OpenRouter. */
export function recordTestSpend(eur, { tier = "main", note = "test" } = {}) {
  const dayKey = budgetDayKey();
  return recordAiSpend({
    dayKey,
    tier,
    model: "test-meter",
    promptTokens: 0,
    completionTokens: 0,
    costUsd: eur / USD_TO_EUR,
    costEur: eur,
    note,
  });
}
