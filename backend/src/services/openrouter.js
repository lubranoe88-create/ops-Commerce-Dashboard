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
  if (!buffer || !Buffer.isBuffer(buffer) || buffer.length < 16) {
    const err = new Error("Audio vuoto o troppo corto");
    err.status = 400;
    throw err;
  }
  if (buffer.length > 4_500_000) {
    const err = new Error("Audio troppo grande (max ~4MB)");
    err.status = 413;
    throw err;
  }

  const primary = sttFormat(mimeType, filename);
  const formats = primary === "m4a" ? ["m4a", "aac", "mp4"] : [primary];
  const models = [
    "openai/whisper-1",
    "openai/whisper-large-v3",
    "openai/whisper-large-v3-turbo",
  ];
  let lastErr = null;

  for (const model of models) {
    const tryFormats = model === models[0] ? formats : [primary];
    let modelMissing = false;
    for (const format of tryFormats) {
      const { response, payload } = await postTranscription({
        key,
        model,
        format,
        buffer,
        language,
      });
      if (!response.ok) {
        const detail =
          payload?.error?.message ||
          payload?.message ||
          `OpenRouter transcribe HTTP ${response.status}`;
        lastErr = new Error(`${detail} (model ${model}, format ${format}, ${buffer.length} byte)`);
        lastErr.status = response.status >= 400 && response.status < 600 ? response.status : 502;
        lastErr.upstream = true;
        if (
          response.status === 404 ||
          /model|not found|no endpoint|unavailable|does not exist/i.test(detail)
        ) {
          modelMissing = true;
          break;
        }
        if (/format|audio|unsupported|invalid|mime/i.test(detail)) continue;
        if (response.status >= 500) continue;
        throw lastErr;
      }
      const text = typeof payload?.text === "string" ? payload.text.trim() : "";
      if (text) return { text, model: payload?.model || model, format };
      lastErr = new Error(
        `Whisper ${model} ha restituito testo vuoto (${buffer.length} byte, format ${format})`,
      );
      lastErr.status = 422;
      lastErr.upstream = true;
    }
    if (modelMissing) continue;
    if (lastErr?.status === 422) break;
  }

  throw lastErr || new Error("Trascrizione non riuscita");
}

function sttFormat(mimeType = "", filename = "") {
  const s = `${mimeType} ${filename}`.toLowerCase();
  if (s.includes("wav")) return "wav";
  if (s.includes("mp3") || s.includes("mpeg")) return "mp3";
  if (s.includes("flac")) return "flac";
  if (s.includes("ogg")) return "ogg";
  if (s.includes("webm")) return "webm";
  if (/\baac\b/.test(s) && !s.includes("mp4") && !s.includes("m4a")) return "aac";
  return "m4a";
}

async function postTranscription({ key, model, format, buffer, language }) {
  const response = await fetch(OPENROUTER_TRANSCRIBE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": config.openRouterHttpReferer,
      "X-Title": config.openRouterAppTitle,
    },
    body: JSON.stringify({
      model,
      input_audio: {
        data: buffer.toString("base64"),
        format,
      },
      ...(language ? { language } : {}),
    }),
  });
  const payload = await response.json().catch(() => null);
  return { response, payload };
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
