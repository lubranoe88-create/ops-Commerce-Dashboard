import { config } from "../config.js";

/**
 * LM Studio on the user's desktop (hostname bionic / bionic.local on LAN).
 * Not on the Cursor/cloud server — never assume server loopback.
 */

const DEFAULT_HOSTS = ["bionic.local", "bionic"];

export function localLlmEnabled() {
  return config.localLlmEnabled === true;
}

/** Hostnames to try, in order (mDNS .local first). */
export function localLlmHosts() {
  const raw = String(config.localLlmHosts || "").trim();
  if (!raw) return [...DEFAULT_HOSTS];
  return raw
    .split(/[,;\s]+/)
    .map((h) => h.trim())
    .filter(Boolean);
}

export function localLlmPort() {
  const n = Number(config.localLlmPort);
  return Number.isFinite(n) && n > 0 ? n : 23000;
}

/**
 * Prefer an explicit base URL (may include host+port+/v1).
 * Otherwise build from host list + port.
 */
export function localLlmBaseUrlCandidates() {
  const explicit = String(config.localLlmBaseUrl || "").trim().replace(/\/+$/, "");
  if (explicit) {
    const withV1 = /\/v1$/i.test(explicit) ? explicit : `${explicit}/v1`;
    return [withV1];
  }
  const port = localLlmPort();
  return localLlmHosts().map((host) => `http://${host}:${port}/v1`);
}

export function localLlmChatUrl(baseUrl) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  return `${base}/chat/completions`;
}

export function localLlmModelsUrl(baseUrl) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  return `${base}/models`;
}

export function localLlmApiKey() {
  const key = String(config.localLlmApiKey || "").trim();
  return key || "lm-studio";
}

export function localLlmModelId() {
  return (
    String(config.localLlmModel || "").trim() ||
    "Huihui-Qwen3.6-35B-A3B-Claude-4.7-Opus-abliterated-MTP-GGUF"
  );
}

/**
 * Probe LM Studio over LAN hostnames. Returns first reachable base + model ids.
 */
export async function probeLocalLlm({
  fetchImpl = globalThis.fetch,
  timeoutMs = 2500,
} = {}) {
  const candidates = localLlmBaseUrlCandidates();
  const errors = [];
  for (const base of candidates) {
    const url = localLlmModelsUrl(base);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: "GET",
        signal: ac.signal,
        headers: {
          Authorization: `Bearer ${localLlmApiKey()}`,
          Accept: "application/json",
        },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        errors.push({ base, status: res.status, detail: body?.error?.message || `HTTP ${res.status}` });
        continue;
      }
      const models = Array.isArray(body?.data)
        ? body.data.map((m) => m?.id).filter(Boolean)
        : [];
      return {
        ok: true,
        baseUrl: base,
        chatUrl: localLlmChatUrl(base),
        models,
        model: models[0] || localLlmModelId(),
        hostTried: candidates,
      };
    } catch (err) {
      errors.push({
        base,
        detail: String(err?.cause?.code || err?.code || err?.message || err).slice(0, 160),
      });
    } finally {
      clearTimeout(timer);
    }
  }
  return {
    ok: false,
    baseUrl: candidates[0] || null,
    chatUrl: candidates[0] ? localLlmChatUrl(candidates[0]) : null,
    models: [],
    model: localLlmModelId(),
    hostTried: candidates,
    errors,
  };
}
