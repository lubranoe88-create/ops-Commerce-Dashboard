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

const OPENROUTER_SPEECH_URL = "https://openrouter.ai/api/v1/audio/speech";

/**
 * Server TTS for Safari/iPad: returns raw audio bytes (mp3) for AudioContext playback.
 * Key stays server-side; used when speechSynthesis is gated or silent with mic in use.
 */
export async function synthesizeSpeech({
  text,
  model = config.openRouterTtsModel,
  voice = config.openRouterTtsVoice,
  responseFormat = "mp3",
} = {}) {
  const key = config.openRouterApiKey;
  if (!key || /CHANGE_ME|PLACEHOLDER|your-key/i.test(key)) {
    const err = new Error("OpenRouter not configured");
    err.code = "NO_OPENROUTER";
    err.status = 503;
    throw err;
  }
  const input = String(text || "")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
  if (!input) {
    const err = new Error("testo TTS richiesto");
    err.status = 400;
    throw err;
  }

  const attempts = [
    { model, voice, response_format: responseFormat || "mp3" },
    // Fallbacks if the configured model is unavailable on the account.
    {
      model: "deepgram/aura-2",
      voice: "aura-2-cinzia-it",
      response_format: "mp3",
    },
    {
      model: "microsoft/mai-voice-2.1-flash",
      voice: "it-IT-Rosa:MAI-Voice-2.1-Flash",
      response_format: "mp3",
    },
  ];
  // Deduplicate identical attempts
  const seen = new Set();
  const queue = [];
  for (const a of attempts) {
    const k = `${a.model}|${a.voice}`;
    if (seen.has(k)) continue;
    seen.add(k);
    queue.push(a);
  }

  let lastErr = null;
  for (const attempt of queue) {
    const response = await fetch(OPENROUTER_SPEECH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": config.openRouterHttpReferer,
        "X-Title": config.openRouterAppTitle,
      },
      body: JSON.stringify({
        model: attempt.model,
        input,
        voice: attempt.voice,
        response_format: attempt.response_format,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const detail =
        payload?.error?.message ||
        payload?.message ||
        `OpenRouter TTS HTTP ${response.status}`;
      lastErr = new Error(detail);
      lastErr.status =
        response.status >= 400 && response.status < 600 ? response.status : 502;
      lastErr.upstream = true;
      continue;
    }

    const buf = Buffer.from(await response.arrayBuffer());
    if (!buf.length) {
      lastErr = new Error("TTS audio vuoto");
      lastErr.status = 502;
      continue;
    }
    return {
      buffer: buf,
      mime: attempt.response_format === "pcm" ? "audio/pcm" : "audio/mpeg",
      model: attempt.model,
      voice: attempt.voice,
    };
  }

  throw lastErr || new Error("TTS fallita");
}
