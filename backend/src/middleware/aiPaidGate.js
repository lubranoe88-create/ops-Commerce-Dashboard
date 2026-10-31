import { config } from "../config.js";

/** Paid AI entitlement on top of site-password session (Stripe later). */
export function isAiPaid() {
  return config.aiEntitlement === "paid";
}

export function requireAiPaid(req, res, next) {
  if (isAiPaid()) return next();
  return res.status(402).json({
    error: "AI paid tier required",
    code: "AI_PAYMENT_REQUIRED",
    entitlement: "free",
  });
}

export function aiEntitlementPayload() {
  return {
    entitlement: config.aiEntitlement,
    paid: isAiPaid(),
    routerModel: config.aiRouterModel,
    mainModel: config.aiMainModel,
    grokModel: config.aiGrokModel,
    dailyBudgetEur: config.aiDailyBudgetEur,
  };
}
