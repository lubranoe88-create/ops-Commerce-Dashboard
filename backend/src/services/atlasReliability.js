/**
 * M2 / M3 / X3: provider fallback, classified retries, and a circuit breaker.
 *
 * Transient failures retry with backoff. Fatal failures do not.
 * After FAILURES_TO_OPEN consecutive failed calls the provider trips open
 * for COOLDOWN_MS and the caller uses its fallback (alternate model or a
 * mechanical reply) without waiting on the network.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, "../../data/agentq-memory/atlas-provider-state.json");

export const FAILURES_TO_OPEN = 3;
export const COOLDOWN_MS = 30_000;
const MAX_OUTCOMES = 80;

let pathOverride = "";
let loaded = false;
let clockFn = null;
let sleepFn = null;
const circuits = new Map();
const outcomes = [];

export function setReliabilityFileForTests(filePath) {
  pathOverride = filePath ? path.resolve(filePath) : "";
  circuits.clear();
  outcomes.length = 0;
  loaded = true;
}

export function setReliabilityClockForTests(fn) {
  clockFn = typeof fn === "function" ? fn : null;
}

export function setReliabilitySleeperForTests(fn) {
  sleepFn = typeof fn === "function" ? fn : null;
}

export function resetReliabilityForTests() {
  circuits.clear();
  outcomes.length = 0;
  loaded = true;
  clockFn = null;
  sleepFn = null;
}

export function reliabilityNow() {
  return clockFn ? Number(clockFn()) || 0 : Date.now();
}

function reliabilitySleep(ms) {
  if (sleepFn) return Promise.resolve(sleepFn(ms));
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statePath() {
  return pathOverride || DEFAULT_PATH;
}

function publicCircuit(row) {
  return {
    provider: row.provider,
    state: row.state,
    consecutive: row.consecutive,
    openedAt: row.openedAt,
    openUntil: row.openUntil,
    lastFailureAt: row.lastFailureAt,
    lastSuccessAt: row.lastSuccessAt,
  };
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(statePath(), "utf8"));
    for (const row of Object.values(raw?.circuits || {})) {
      if (!row?.provider) continue;
      circuits.set(row.provider, {
        provider: row.provider,
        state: row.state || "closed",
        consecutive: Number(row.consecutive) || 0,
        openedAt: row.openedAt || null,
        openUntil: Number(row.openUntil) || 0,
        lastFailureAt: row.lastFailureAt || null,
        lastSuccessAt: row.lastSuccessAt || null,
      });
    }
    for (const row of Array.isArray(raw?.outcomes) ? raw.outcomes : []) outcomes.push(row);
    if (outcomes.length > MAX_OUTCOMES) outcomes.splice(0, outcomes.length - MAX_OUTCOMES);
  } catch {
    /* first run has no state file */
  }
}

function persist() {
  try {
    const dest = statePath();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const circuitsOut = {};
    for (const row of circuits.values()) circuitsOut[row.provider] = publicCircuit(row);
    const body = {
      version: 1,
      circuits: circuitsOut,
      outcomes: outcomes.slice(-MAX_OUTCOMES),
    };
    const tmp = path.join(path.dirname(dest), `.atlas-provider.${process.pid}.tmp`);
    fs.writeFileSync(tmp, `${JSON.stringify(body)}\n`, "utf8");
    fs.renameSync(tmp, dest);
  } catch {
    /* the in-memory circuit still governs this process */
  }
}

function ensure(provider) {
  load();
  const key = String(provider || "openrouter");
  if (!circuits.has(key)) {
    circuits.set(key, {
      provider: key,
      state: "closed",
      consecutive: 0,
      openedAt: null,
      openUntil: 0,
      lastFailureAt: null,
      lastSuccessAt: null,
    });
  }
  return circuits.get(key);
}

export function classifyProviderFailure(err) {
  if (!err) return { retryable: false, fatal: true, reason: "unknown" };
  const status = Number(err.status) || 0;
  const code = String(err.code || "");
  const name = String(err.name || "");
  const message = String(err.message || "");
  if (code === "NO_OPENROUTER" || code === "NO_LOCAL_LLM") {
    return { retryable: false, fatal: true, reason: "not_configured" };
  }
  if (code === "PROVIDER_BUDGET") return { retryable: false, fatal: true, reason: "budget" };
  if (status === 408 || status === 429 || (status >= 500 && status <= 599)) {
    return { retryable: true, fatal: false, reason: `http_${status}` };
  }
  if ([400, 401, 403, 404, 413, 415, 422].includes(status)) {
    return { retryable: false, fatal: true, reason: `http_${status}` };
  }
  if (
    name === "AbortError" ||
    name === "TimeoutError" ||
    code === "ABORT_ERR" ||
    code === "ETIMEDOUT" ||
    code === "ECONNRESET" ||
    code === "ECONNREFUSED" ||
    code === "UND_ERR_CONNECT_TIMEOUT" ||
    code === "UND_ERR_SOCKET" ||
    /timeout|fetch failed|network|socket|ECONN/i.test(message)
  ) {
    return { retryable: true, fatal: false, reason: "transient" };
  }
  if (!status) return { retryable: true, fatal: false, reason: "transient" };
  return { retryable: false, fatal: true, reason: status ? `http_${status}` : "fatal" };
}

export function logProviderOutcome(entry) {
  load();
  const row = {
    at: new Date(reliabilityNow()).toISOString(),
    provider: entry?.provider || "openrouter",
    ok: Boolean(entry?.ok),
    attempt: Number(entry?.attempt) || 0,
    retryable: Boolean(entry?.retryable),
    fatal: Boolean(entry?.fatal),
    reason: String(entry?.reason || ""),
    status: Number(entry?.status) || 0,
    fallback: entry?.fallback || null,
  };
  outcomes.push(row);
  if (outcomes.length > MAX_OUTCOMES) outcomes.splice(0, outcomes.length - MAX_OUTCOMES);
  persist();
  return row;
}

export function recentProviderOutcomes({ limit = 8 } = {}) {
  load();
  return outcomes.slice(-Math.max(1, limit)).reverse();
}

/** Open circuits refuse the provider until the cooldown elapses, then allow one trial. */
export function isCircuitOpen(provider, now = reliabilityNow()) {
  const row = ensure(provider);
  if (row.state !== "open") return false;
  if (now >= row.openUntil) {
    row.state = "half-open";
    persist();
    return false;
  }
  return true;
}

export function noteProviderSuccess(provider) {
  const row = ensure(provider);
  row.consecutive = 0;
  row.state = "closed";
  row.openedAt = null;
  row.openUntil = 0;
  row.lastSuccessAt = reliabilityNow();
  persist();
  return publicCircuit(row);
}

export function noteProviderFailure(provider) {
  const row = ensure(provider);
  row.consecutive += 1;
  row.lastFailureAt = reliabilityNow();
  if (row.consecutive >= FAILURES_TO_OPEN) {
    row.state = "open";
    row.openedAt = reliabilityNow();
    row.openUntil = reliabilityNow() + COOLDOWN_MS;
  }
  persist();
  return publicCircuit(row);
}

export function providerStatus() {
  load();
  return {
    failuresToOpen: FAILURES_TO_OPEN,
    cooldownMs: COOLDOWN_MS,
    circuits: [...circuits.values()].map(publicCircuit),
    recent: recentProviderOutcomes({ limit: 8 }),
  };
}

export function reloadReliabilityFromDisk() {
  loaded = false;
  circuits.clear();
  outcomes.length = 0;
  load();
}

/**
 * Retry only retryable failures. Each wait doubles. The deadline stops the
 * loop so a caller cannot sit on a dead provider.
 */
export async function retryTransient(fn, {
  provider = "openrouter",
  attempts = 2,
  timeoutMs = 4000,
  baseDelayMs = 80,
  deadlineAt = reliabilityNow() + 9000,
} = {}) {
  let lastErr = null;
  const delays = [];
  const total = Math.max(1, attempts);
  for (let attempt = 1; attempt <= total; attempt += 1) {
    const now = reliabilityNow();
    if (now >= deadlineAt) {
      const err = new Error("provider budget elapsed");
      err.code = "PROVIDER_BUDGET";
      err.status = 504;
      const kind = classifyProviderFailure(err);
      logProviderOutcome({ provider, ok: false, attempt, ...kind, status: 504 });
      return { ok: false, error: err, kind, attempts: attempt, delays, budgetExceeded: true };
    }
    const slice = Math.min(timeoutMs, Math.max(200, deadlineAt - now));
    let signal = null;
    try {
      signal = AbortSignal.timeout(slice);
    } catch {
      signal = null;
    }
    try {
      const value = await fn({ signal, attempt });
      logProviderOutcome({ provider, ok: true, attempt, retryable: false, fatal: false, reason: "ok", status: 200 });
      return { ok: true, value, attempts: attempt, delays };
    } catch (err) {
      lastErr = err;
      const kind = classifyProviderFailure(err);
      logProviderOutcome({
        provider,
        ok: false,
        attempt,
        retryable: kind.retryable,
        fatal: kind.fatal,
        reason: kind.reason,
        status: Number(err?.status) || 0,
      });
      if (!kind.retryable || attempt === total) {
        return { ok: false, error: err, kind, attempts: attempt, delays };
      }
      const wait = baseDelayMs * 2 ** (attempt - 1);
      delays.push(wait);
      await reliabilitySleep(wait);
    }
  }
  const kind = classifyProviderFailure(lastErr);
  return { ok: false, error: lastErr, kind, attempts: total, delays };
}

/**
 * Closed: try the provider, then the alternate.
 * Open: skip the network and return the mechanical/alternate fallback.
 */
export async function runProvider({
  provider,
  run,
  alternate = null,
  mechanical,
  attempts = 2,
  timeoutMs = 4000,
  baseDelayMs = 80,
  budgetMs = 9000,
} = {}) {
  if (isCircuitOpen(provider)) {
    const value = await mechanical({ reason: "circuit", error: null });
    logProviderOutcome({
      provider,
      ok: false,
      attempt: 0,
      retryable: false,
      fatal: false,
      reason: "circuit_open",
      status: 0,
      fallback: value?.fallback || "circuit",
    });
    return value;
  }
  const deadlineAt = reliabilityNow() + budgetMs;
  const primary = await retryTransient(run, { provider, attempts, timeoutMs, baseDelayMs, deadlineAt });
  if (primary.ok) {
    noteProviderSuccess(provider);
    return primary.value;
  }
  let lastErr = primary.error;
  if (typeof alternate === "function" && reliabilityNow() < deadlineAt) {
    const alt = await retryTransient(alternate, {
      provider,
      attempts: 1,
      timeoutMs,
      baseDelayMs,
      deadlineAt,
    });
    if (alt.ok) {
      noteProviderSuccess(provider);
      return { ...alt.value, fallback: alt.value?.fallback || "model" };
    }
    lastErr = alt.error || lastErr;
  }
  const row = noteProviderFailure(provider);
  const reason = row.state === "open" ? "circuit" : "exhausted";
  const value = await mechanical({ reason, error: lastErr });
  logProviderOutcome({
    provider,
    ok: false,
    attempt: 0,
    retryable: false,
    fatal: false,
    reason,
    status: Number(lastErr?.status) || 0,
    fallback: value?.fallback || "mechanical",
  });
  return value;
}
