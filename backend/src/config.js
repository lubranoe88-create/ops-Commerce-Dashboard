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
    "meta-llama/llama-3.2-3b-instruct",
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
