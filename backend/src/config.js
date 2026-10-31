import dotenv from "dotenv";

dotenv.config();

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`Invalid integer env var ${name}: ${raw}`);
  }
  return n;
}

function floatEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`Invalid float env var ${name}: ${raw}`);
  }
  return n;
}

/** Placeholders allowed so the site boots before the user fills secrets. */
function secretOrPlaceholder(name, placeholder) {
  const value = process.env[name]?.trim();
  if (value) return value;
  return placeholder;
}

export const config = {
  port: intEnv("PORT", 8787),
  host: process.env.HOST?.trim() || "0.0.0.0",
  openRouterApiKey: secretOrPlaceholder(
    "OPENROUTER_API_KEY",
    "CHANGE_ME_OPENROUTER_KEY",
  ),
  openRouterModel:
    process.env.OPENROUTER_MODEL?.trim() ||
    "deepseek/deepseek-v4.1-flash",
  openRouterHttpReferer:
    process.env.OPENROUTER_HTTP_REFERER?.trim() || "http://localhost:8787",
  openRouterAppTitle:
    process.env.OPENROUTER_APP_TITLE?.trim() || "Holographic Dashboard",
  sitePassword: secretOrPlaceholder("SITE_PASSWORD", "CHANGE_ME_SITE_PASSWORD"),
  sessionSecret:
    process.env.SESSION_SECRET?.trim() ||
    secretOrPlaceholder("SITE_PASSWORD", "CHANGE_ME_SITE_PASSWORD") + "-session",
  rateLimitWindowMs: intEnv("RATE_LIMIT_WINDOW_MS", 15 * 60 * 1000),
  rateLimitMax: intEnv("RATE_LIMIT_MAX", 60),
  maxPromptChars: intEnv("MAX_PROMPT_CHARS", 8000),
  maxSystemChars: intEnv("MAX_SYSTEM_CHARS", 2000),
  maxTokens: intEnv("MAX_TOKENS", 1024),
  /** Cheap front-agent model (same OpenRouter key). Always used first on paid. */
  aiRouterModel:
    process.env.AI_ROUTER_MODEL?.trim() || "meta-llama/llama-3.2-3b-instruct",
  /** Main analysis model — only when router escalates and budget allows. */
  aiMainModel:
    process.env.OPENROUTER_MODEL?.trim() || "deepseek/deepseek-v4.1-flash",
  /**
   * Power override (Grok via OpenRouter). Front agent may escalate here when
   * the task needs more power — spend counts against the hard daily cap.
   */
  aiGrokModel: process.env.AI_GROK_MODEL?.trim() || "x-ai/grok-4.20",
  /** Hard daily OpenRouter spend CAP in EUR (not a target to fill / burn). */
  aiDailyBudgetEur: floatEnv("AI_DAILY_BUDGET_EUR", 10),
  /**
   * Soft reserve kept unused inside the cap (EUR). Effective spendable =
   * max(0, cap - reserve). Soft/hard bands apply to spent / cap.
   */
  aiBudgetReserveEur: floatEnv("AI_BUDGET_RESERVE_EUR", 0),
  /** Soft band ~70–80%: stop main/grok escalations (default 0.75). */
  aiBudgetSoftRatio: floatEnv("AI_BUDGET_SOFT_RATIO", 0.75),
  /** Hard band 95–100%: block all new LLM calls (default 0.95). */
  aiBudgetHardRatio: floatEnv("AI_BUDGET_HARD_RATIO", 0.95),
  /**
   * Paid AI entitlement for site-password sessions until Stripe lands.
   * AI_ENTITLEMENT=paid|free (default paid for single-tenant ops dashboard).
   */
  aiEntitlement: (process.env.AI_ENTITLEMENT || "paid").trim().toLowerCase() === "paid"
    ? "paid"
    : "free",
  aiBudgetTz: process.env.AI_BUDGET_TZ?.trim() || "Europe/Berlin",
  newsRssUrl:
    process.env.NEWS_RSS_URL?.trim() ||
    "https://feeds.bbci.co.uk/news/world/rss.xml",
  /** Proactive TTS: opt_in (default) | on | off. opt_in = silent until user enables. */
  aiProactiveTts: (process.env.AI_PROACTIVE_TTS || "opt_in").trim().toLowerCase(),
  /** browser-use disabled when remaining EUR under this floor. */
  aiBrowserUseMinRemainingEur: floatEnv("AI_BROWSER_USE_MIN_REMAINING_EUR", 3),
  browserUseAllowOrigin:
    process.env.BROWSER_USE_ALLOW_ORIGIN?.trim() ||
    process.env.OPENROUTER_HTTP_REFERER?.trim() ||
    "http://127.0.0.1:8787",
  browserUseRateLimitPerMin: intEnv("BROWSER_USE_RATE_LIMIT_PER_MIN", 6),
  browserUseEnabled:
    (process.env.BROWSER_USE_ENABLED || "true").trim().toLowerCase() !== "false",
};

export function assertRuntimeSecrets() {
  if (config.sitePassword.includes("CHANGE_ME")) {
    console.warn(
      "[warn] SITE_PASSWORD is still a placeholder — set it in the host env before sharing widely.",
    );
  }
  if (config.openRouterApiKey.includes("CHANGE_ME")) {
    console.warn(
      "[warn] OPENROUTER_API_KEY is still a placeholder — chat uses local fallback until set.",
    );
  }
}
