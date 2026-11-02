import { config } from "../config.js";
import { alternateChatModel, resolveChatModel } from "./chatModels.js";
import { asAtlasLine, presentAtlasChatText, withAtlasPersona } from "./atlasPersonality.js";
import {
  classifyProviderFailure,
  isCircuitOpen,
  noteProviderFailure,
  noteProviderSuccess,
  reliabilityNow,
  retryTransient,
  runProvider,
} from "./atlasReliability.js";

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Tests replace the network without touching global fetch. */
export function setOpenRouterFetchForTests(fn) {
  fetchImpl = typeof fn === "function" ? fn : (...args) => globalThis.fetch(...args);
}

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Atlas is the only system message. Extra system turns are dropped so a caller
 * cannot replace the persona with another name.
 */
export function assembleChatMessages({
  system,
  prompt,
  messages: priorMessages,
} = {}) {
  const messages = [{ role: "system", content: withAtlasPersona(system) }];
  if (Array.isArray(priorMessages)) {
    for (const m of priorMessages) {
      if (!m?.role || typeof m.content !== "string") continue;
      if (String(m.role).toLowerCase() === "system") continue;
      messages.push({ role: m.role, content: m.content });
    }
  }
  if (prompt) messages.push({ role: "user", content: prompt });
  return messages;
}

function requireOpenRouterKey() {
  const key = config.openRouterApiKey;
  if (!key || /CHANGE_ME|PLACEHOLDER|your-key/i.test(key)) {
    const err = new Error("OpenRouter not configured");
    err.code = "NO_OPENROUTER";
    err.status = 503;
    throw err;
  }
  return key;
}

function mechanicalChat(reason) {
  return {
    content: asAtlasLine(
      "Risposta meccanica: il modello esterno non ha risposto. Resto sui dati già in plancia.",
    ),
    model: "mechanical",
    usage: null,
    fallback: reason === "circuit" ? "circuit" : "mechanical",
  };
}

async function postChat({ key, modelId, messages, maxTokens, temperature, signal }) {
  let response;
  try {
    response = await fetchImpl(OPENROUTER_URL, {
      method: "POST",
      signal,
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
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      err.status = err.status || 504;
      err.code = err.code || "TIMEOUT";
    }
    throw err;
  }

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
    err.code = "EMPTY_RESPONSE";
    throw err;
  }

  return {
    content: presentAtlasChatText(content.trim()),
    model: payload?.model || modelId,
    usage: payload?.usage ?? null,
    fallback: null,
  };
}

/**
 * Call OpenRouter chat completions. API key stays server-side.
 * Returns usage for budget metering. Every chat path gets the Atlas persona.
 * A failed call retries transient errors, then an alternate model, then a
 * mechanical reply. An open circuit skips the network (M2, M3, X3).
 */
export async function completeChat({
  prompt,
  system,
  model,
  maxTokens,
  temperature = 0.2,
  messages: priorMessages,
} = {}) {
  // Every chat completion (dashboard chat, /api/chat, agent turns, hands) gets Atlas.
  const messages = assembleChatMessages({ system, prompt, messages: priorMessages });
  const modelId = resolveChatModel(model);
  const key = requireOpenRouterKey();
  const alternateId = alternateChatModel(modelId);
  const run = ({ signal }) => postChat({ key, modelId, messages, maxTokens, temperature, signal });
  const alternate = alternateId
    ? ({ signal }) => postChat({ key, modelId: alternateId, messages, maxTokens, temperature, signal })
    : null;
  return runProvider({
    provider: "openrouter",
    run,
    alternate,
    mechanical: ({ reason }) => mechanicalChat(reason),
    attempts: 2,
    timeoutMs: 4000,
    baseDelayMs: 80,
    budgetMs: 9000,
  });
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
  if (isCircuitOpen("stt")) return mechanicalTranscript("circuit");

  const sniffed = sniffAudio(buffer);
  const primary = sniffed?.format || sttFormat(mimeType, filename);
  const sendMime = sniffed?.mime || mimeType;
  const sendName = sniffed?.filename || filename;
  // Safari audio/mp4 is AAC-in-M4A. If Whisper rejects the label, try the sibling.
  const formats = [primary];
  if (primary === "m4a") formats.push("aac");
  else if (primary === "aac") formats.push("m4a");
  const models = [
    "openai/whisper-1",
    "openai/whisper-large-v3",
    "openai/whisper-large-v3-turbo",
  ];
  let lastErr = null;
  const deadlineAt = reliabilityNow() + 8000;

  for (const model of models) {
    if (reliabilityNow() >= deadlineAt) break;
    const tryFormats = model === models[0] ? formats : [primary];
    let modelMissing = false;
    for (const format of tryFormats) {
      if (reliabilityNow() >= deadlineAt) break;
      const { response, payload } = await postTranscriptionReliable({
        key,
        model,
        format,
        buffer,
        language,
        deadlineAt,
      });
      if (!response.ok) {
        const detail =
          payload?.error?.message ||
          payload?.message ||
          `OpenRouter transcribe HTTP ${response.status}`;
        lastErr = new Error(`${detail} (model ${model}, format ${format}, ${buffer.length} byte)`);
        lastErr.status = response.status >= 400 && response.status < 600 ? response.status : 502;
        lastErr.upstream = true;
        if (lastErr.status === 401 || lastErr.status === 403) {
          modelMissing = true;
          break;
        }
        if (
          response.status === 404 ||
          /model|not found|no endpoint|unavailable|does not exist/i.test(detail)
        ) {
          modelMissing = true;
          break;
        }
        continue;
      }
      const text = typeof payload?.text === "string" ? payload.text.trim() : "";
      if (text) {
        noteProviderSuccess("stt");
        return { text, model: payload?.model || model, format, fallback: null };
      }
      lastErr = new Error(
        `Whisper ${model} ha restituito testo vuoto (${buffer.length} byte, format ${format})`,
      );
      lastErr.status = 422;
      lastErr.upstream = true;
    }
    if (lastErr?.status === 401 || lastErr?.status === 403) break;
    if (modelMissing) continue;
  }

  if (reliabilityNow() < deadlineAt && lastErr?.status !== 401 && lastErr?.status !== 403) {
    try {
      const multipart = await postMultipartTranscription({
        key,
        model: "openai/whisper-1",
        buffer,
        mimeType: sendMime,
        filename: sendName,
        language,
        deadlineAt,
      });
      if (multipart.text) {
        noteProviderSuccess("stt");
        return { ...multipart, fallback: multipart.fallback || "model" };
      }
      lastErr = new Error(
        `Whisper multipart testo vuoto (${buffer.length} byte, ${sendMime || "mime?"}, format ${primary})`,
      );
      lastErr.status = 422;
      lastErr.upstream = true;
    } catch (err) {
      if (!lastErr) lastErr = err;
    }
  }

  const row = noteProviderFailure("stt");
  return mechanicalTranscript(row.state === "open" ? "circuit" : "mechanical");
}

function mechanicalTranscript(fallback) {
  return {
    text: "",
    model: "mechanical",
    format: null,
    fallback,
    reply: asAtlasLine("Non ho trascritto l'audio. Ripeti la frase."),
  };
}

async function postTranscriptionReliable({ key, model, format, buffer, language, deadlineAt }) {
  const tried = await retryTransient(
    async ({ signal }) => {
      const { response, payload } = await postTranscription({
        key,
        model,
        format,
        buffer,
        language,
        signal,
      });
      if (!response?.ok) {
        const detail =
          payload?.error?.message ||
          payload?.message ||
          `OpenRouter transcribe HTTP ${response?.status}`;
        const err = new Error(detail);
        err.status = response?.status >= 400 && response?.status < 600 ? response.status : 502;
        err.upstream = true;
        if (classifyProviderFailure(err).retryable) throw err;
        return { response, payload };
      }
      return { response, payload };
    },
    { provider: "stt", attempts: 2, timeoutMs: 3500, baseDelayMs: 40, deadlineAt },
  );
  if (tried.ok) return tried.value;
  const err = tried.error || new Error("transcribe failed");
  return {
    response: { ok: false, status: Number(err.status) || 502 },
    payload: { error: { message: err.message || "transcribe failed" } },
  };
}

async function postMultipartTranscription({
  key,
  model,
  buffer,
  mimeType,
  filename,
  language,
  deadlineAt,
}) {
  const tried = await retryTransient(
    ({ signal }) =>
      postMultipartOnce({
        key,
        model,
        buffer,
        mimeType,
        filename,
        language,
        signal,
      }),
    { provider: "stt", attempts: 2, timeoutMs: 3500, baseDelayMs: 40, deadlineAt },
  );
  if (tried.ok) return tried.value;
  throw tried.error || new Error("multipart transcribe failed");
}

async function postMultipartOnce({
  key,
  model,
  buffer,
  mimeType,
  filename,
  language,
  signal,
}) {
  const form = new FormData();
  const blob = new Blob([buffer], { type: mimeType || "application/octet-stream" });
  form.append("file", blob, filename || "mic.webm");
  form.append("model", model);
  if (language) form.append("language", language);
  const response = await fetchImpl(OPENROUTER_TRANSCRIBE_URL, {
    method: "POST",
    signal,
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
    const err = new Error(`${detail} (multipart ${model}, ${buffer.length} byte)`);
    err.status = response.status >= 400 && response.status < 600 ? response.status : 502;
    err.upstream = true;
    throw err;
  }
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  return { text, model: payload?.model || model, format: "multipart" };
}

function sniffAudio(buffer) {
  if (!buffer || buffer.length < 12) return null;
  if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return { format: "webm", filename: "mic.webm", mime: "audio/webm" };
  }
  if (buffer.slice(0, 4).toString("ascii") === "RIFF") {
    return { format: "wav", filename: "mic.wav", mime: "audio/wav" };
  }
  if (buffer.slice(0, 4).toString("ascii") === "OggS") {
    return { format: "ogg", filename: "mic.ogg", mime: "audio/ogg" };
  }
  if (buffer.slice(4, 8).toString("ascii") === "ftyp") {
    return { format: "m4a", filename: "mic.m4a", mime: "audio/mp4" };
  }
  if (buffer[0] === 0xff && (buffer[1] & 0xf6) === 0xf0) {
    return { format: "aac", filename: "mic.aac", mime: "audio/aac" };
  }
  if (buffer.slice(0, 3).toString("ascii") === "ID3" || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) {
    return { format: "mp3", filename: "mic.mp3", mime: "audio/mpeg" };
  }
  return null;
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

async function postTranscription({ key, model, format, buffer, language, signal }) {
  let response;
  try {
    response = await fetchImpl(OPENROUTER_TRANSCRIBE_URL, {
      method: "POST",
      signal,
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
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      err.status = err.status || 504;
      err.code = err.code || "TIMEOUT";
    }
    throw err;
  }
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
  if (isCircuitOpen("tts")) return mechanicalSpeech(input, "circuit");

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
  const deadlineAt = reliabilityNow() + 8000;
  for (const attempt of queue) {
    if (reliabilityNow() >= deadlineAt) break;
    const tried = await retryTransient(
      ({ signal }) => requestSpeech({ key, attempt, input, signal }),
      { provider: "tts", attempts: 2, timeoutMs: 3500, baseDelayMs: 40, deadlineAt },
    );
    if (tried.ok) {
      noteProviderSuccess("tts");
      return tried.value;
    }
    lastErr = tried.error || lastErr;
    if (tried.budgetExceeded) break;
    if (lastErr?.status === 401 || lastErr?.status === 403) break;
  }

  const row = noteProviderFailure("tts");
  return mechanicalSpeech(input, row.state === "open" ? "circuit" : "mechanical");
}

function mechanicalSpeech(text, fallback) {
  return {
    buffer: null,
    mime: null,
    model: "mechanical",
    voice: null,
    fallback,
    text,
    reply: asAtlasLine("Voce esterna non disponibile. Il testo resta in plancia."),
  };
}

async function requestSpeech({ key, attempt, input, signal }) {
  let response;
  try {
    response = await fetchImpl(OPENROUTER_SPEECH_URL, {
      method: "POST",
      signal,
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
  } catch (err) {
    if (err?.name === "AbortError" || err?.name === "TimeoutError") {
      err.status = err.status || 504;
      err.code = err.code || "TIMEOUT";
    }
    throw err;
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail =
      payload?.error?.message ||
      payload?.message ||
      `OpenRouter TTS HTTP ${response.status}`;
    const err = new Error(detail);
    err.status = response.status >= 400 && response.status < 600 ? response.status : 502;
    err.upstream = true;
    throw err;
  }
  const buf = Buffer.from(await response.arrayBuffer());
  if (!buf.length) {
    const err = new Error("TTS audio vuoto");
    err.status = 502;
    throw err;
  }
  return {
    buffer: buf,
    mime: attempt.response_format === "pcm" ? "audio/pcm" : "audio/mpeg",
    model: attempt.model,
    voice: attempt.voice,
    fallback: null,
  };
}
