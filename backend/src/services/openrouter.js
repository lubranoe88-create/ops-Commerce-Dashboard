import { config } from "../config.js";
import { resolveChatModel } from "./chatModels.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Call OpenRouter chat completions. API key stays server-side.
 * Returns usage for budget metering.
 */
export async function completeChat({
  prompt,
  system,
  model,
  maxTokens,
  temperature = 0.2,
  messages: priorMessages,
} = {}) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  if (Array.isArray(priorMessages) && priorMessages.length) {
    for (const m of priorMessages) {
      if (m?.role && typeof m.content === "string") messages.push(m);
    }
  }
  if (prompt) messages.push({ role: "user", content: prompt });

  const modelId = resolveChatModel(model);
  const key = config.openRouterApiKey;
  if (!key || /CHANGE_ME|PLACEHOLDER|your-key/i.test(key)) {
    const err = new Error("OpenRouter not configured");
    err.code = "NO_OPENROUTER";
    err.status = 503;
    throw err;
  }

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": config.openRouterHttpReferer,
      "X-Title": config.openRouterAppTitle,
    },
    body: JSON.stringify({
      model: modelId,
      messages,
      max_tokens: maxTokens || config.maxTokens,
      temperature,
    }),
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const detail =
      payload?.error?.message ||
      payload?.message ||
      `OpenRouter HTTP ${response.status}`;
    const err = new Error(detail);
    err.status = response.status >= 400 && response.status < 600 ? response.status : 502;
    err.upstream = true;
    throw err;
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    const err = new Error("Empty model response");
    err.status = 502;
    throw err;
  }

  return {
    content: content.trim(),
    model: payload?.model || modelId,
    usage: payload?.usage ?? null,
  };
}
