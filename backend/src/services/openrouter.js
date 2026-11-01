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

const OPENROUTER_TRANSCRIBE_URL = "https://openrouter.ai/api/v1/audio/transcriptions";

/**
 * Transcribe short mic audio (Safari/iOS MediaRecorder fallback).
 * Uses OpenRouter Whisper; API key stays server-side.
 */
export async function transcribeAudio({
  buffer,
  mimeType = "audio/webm",
  filename = "mic.webm",
  language = "it",
} = {}) {
  const key = config.openRouterApiKey;
  if (!key || /CHANGE_ME|PLACEHOLDER|your-key/i.test(key)) {
    const err = new Error("OpenRouter not configured");
    err.code = "NO_OPENROUTER";
    err.status = 503;
    throw err;
  }
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 32) {
    const err = new Error("Audio vuoto o troppo corto");
    err.status = 400;
    throw err;
  }
  if (buffer.length > 4_500_000) {
    const err = new Error("Audio troppo grande (max ~4MB)");
    err.status = 413;
    throw err;
  }

  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
  form.append("file", blob, filename || "mic.webm");
  form.append("model", "openai/whisper-1");
  if (language) form.append("language", language);

  const response = await fetch(OPENROUTER_TRANSCRIBE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "HTTP-Referer": config.openRouterHttpReferer,
      "X-Title": config.openRouterAppTitle,
    },
    body: form,
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail =
      payload?.error?.message ||
      payload?.message ||
      `OpenRouter transcribe HTTP ${response.status}`;
    const err = new Error(detail);
    err.status = response.status >= 400 && response.status < 600 ? response.status : 502;
    err.upstream = true;
    throw err;
  }

  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!text) {
    const err = new Error("Nessuna trascrizione (audio silenzioso?)");
    err.status = 422;
    throw err;
  }
  return { text, model: payload?.model || "openai/whisper-1" };
}
