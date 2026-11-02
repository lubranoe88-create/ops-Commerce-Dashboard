/**
 * J5: scheduled continuous agents beyond L2 news.
 * Jobs persist on disk. A node timer fires due work.
 * X5 decides whether the digest may interrupt. L3 decides which ids may run.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { classifyUrgency } from "./atlasUrgency.js";
import { gateHandActions } from "./atlasAutonomyPolicy.js";
import { asAtlasLine } from "./atlasPersonality.js";
import { recordDecision } from "./atlasDecisionLog.js";
import { noteResidentIngress } from "./atlasResidentBus.js";
import { noteToolCall } from "./atlasToolLog.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, "../../data/agentq-memory/atlas-schedule.json");
const HOUR_MS = 60 * 60 * 1000;

let pathOverride = "";
let nowFn = () => Date.now();
let timer = null;
let installed = false;

export function setScheduleFileForTests(filePath) {
  pathOverride = filePath ? path.resolve(filePath) : "";
}

export function setScheduleClockForTests(fn) {
  nowFn = typeof fn === "function" ? fn : () => Date.now();
}

export function stopScheduleForTests() {
  if (timer) clearTimeout(timer);
  timer = null;
  installed = false;
}

function clock() {
  return nowFn();
}

function schedulePath() {
  return pathOverride || DEFAULT_PATH;
}

function emptySchedule() {
  return { version: 1, jobs: [] };
}

export function readSchedule() {
  try {
    const raw = JSON.parse(fs.readFileSync(schedulePath(), "utf8"));
    if (!raw || !Array.isArray(raw.jobs)) return emptySchedule();
    return { version: 1, jobs: raw.jobs };
  } catch {
    return emptySchedule();
  }
}

function persist(data) {
  const dest = schedulePath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const body = { version: 1, jobs: data.jobs || [] };
  const tmp = path.join(path.dirname(dest), `.atlas-schedule.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, dest);
  return body;
}

export function cronMatches(expr, date) {
  const parts = String(expr || "").trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const fields = [
    date.getUTCMinutes(),
    date.getUTCHours(),
    date.getUTCDate(),
    date.getUTCMonth() + 1,
    date.getUTCDay(),
  ];
  return parts.every((part, index) => fieldMatches(part, fields[index]));
}

function fieldMatches(part, value) {
  if (part === "*") return true;
  if (part.startsWith("*/")) {
    const step = Number(part.slice(2));
    return Number.isFinite(step) && step > 0 && value % step === 0;
  }
  return part.split(",").some((bit) => Number(bit) === value);
}

export function nextCronAt(expr, fromMs) {
  const start = new Date(fromMs);
  start.setUTCSeconds(0, 0);
  for (let i = 1; i <= 60 * 24 * 8; i += 1) {
    const at = new Date(start.getTime() + i * 60000);
    if (cronMatches(expr, at)) return at.toISOString();
  }
  return new Date(fromMs + HOUR_MS).toISOString();
}

function nextAtFor(job, fromMs) {
  if (Number(job.everyMs) > 0) return new Date(fromMs + Number(job.everyMs)).toISOString();
  if (job.cron) return nextCronAt(job.cron, fromMs);
  return new Date(fromMs + HOUR_MS).toISOString();
}

export function defaultHourlyJob(now = clock()) {
  return {
    id: "hourly-status",
    title: "Digest stato orario",
    kind: "status-digest",
    everyMs: HOUR_MS,
    cron: "",
    enabled: true,
    nextAt: new Date(now + HOUR_MS).toISOString(),
    lastAt: null,
    lastResult: null,
  };
}

export function ensureDefaultSchedule() {
  const data = readSchedule();
  if (!data.jobs.some((job) => job.id === "hourly-status")) {
    data.jobs.push(defaultHourlyJob());
    persist(data);
  }
  return readSchedule();
}

export function saveJob(input = {}) {
  const id = String(input.id || "").trim().slice(0, 40);
  if (!id) {
    const err = new Error("id richiesto");
    err.status = 400;
    throw err;
  }
  const data = readSchedule();
  const prev = data.jobs.find((job) => job.id === id) || {};
  const everyMs = input.everyMs == null ? prev.everyMs || 0 : Number(input.everyMs) || 0;
  const cron = input.cron == null ? prev.cron || "" : String(input.cron || "").trim();
  const job = {
    id,
    title: String(input.title || prev.title || id).slice(0, 80),
    kind: String(input.kind || prev.kind || "status-digest").slice(0, 40),
    everyMs,
    cron,
    enabled: input.enabled == null ? prev.enabled !== false : Boolean(input.enabled),
    nextAt: input.nextAt || prev.nextAt || nextAtFor({ everyMs, cron }, clock()),
    lastAt: prev.lastAt || null,
    lastResult: prev.lastResult || null,
  };
  const idx = data.jobs.findIndex((row) => row.id === id);
  if (idx >= 0) data.jobs[idx] = job;
  else data.jobs.push(job);
  persist(data);
  return job;
}

function publicJob(job) {
  const last = job.lastResult;
  return {
    id: job.id,
    title: job.title,
    kind: job.kind,
    everyMs: job.everyMs || 0,
    cron: job.cron || "",
    enabled: job.enabled !== false,
    nextAt: job.nextAt || null,
    lastAt: job.lastAt || null,
    lastResult: last
      ? {
          at: last.at,
          spoken: Boolean(last.spoken),
          quiet: Boolean(last.quiet),
          score: last.score,
          summary: last.summary,
          executed: last.executed || [],
          ask: last.ask || [],
        }
      : null,
  };
}

export function publicSchedule() {
  return { ok: true, name: "Atlas", jobs: readSchedule().jobs.map(publicJob) };
}

export function urgencyForBundle(bundle) {
  const batch = [];
  const health = String(bundle?.health?.status || "").toLowerCase();
  if (health === "error" || health === "down") {
    batch.push({
      kind: "problems",
      severity: "critical",
      problems: [{ kind: "integrity", severity: "critical", title: "salute" }],
    });
  } else if (health && !["ok", "n/d", "unknown"].includes(health)) {
    batch.push({
      kind: "problems",
      severity: "high",
      problems: [{ kind: "function", severity: "high", title: "salute" }],
    });
  }
  if ((Number(bundle?.board?.error) || 0) > 0) {
    batch.push({ kind: "problems", problems: [{ kind: "function-board", title: "quadro" }] });
  }
  for (const problem of Array.isArray(bundle?.problems) ? bundle.problems : []) {
    batch.push({ kind: "problems", problems: [problem] });
  }
  if (!batch.length) batch.push({ kind: "proactive", eventKind: "status-digest" });
  return classifyUrgency({ kind: "schedule", batch });
}

function defaultPropose(bundle) {
  const ids = [];
  if ((Number(bundle?.problemCount) || bundle?.problems?.length || 0) > 0) ids.push("problems");
  if ((Number(bundle?.board?.error) || 0) > 0) ids.push("refresh");
  return ids;
}

function digestLine(bundle, urgency) {
  const health = bundle?.health?.status || "n/d";
  const score = bundle?.health?.score == null || bundle?.health?.score === "" ? "n/d" : bundle.health.score;
  const problems = bundle?.problemCount ?? bundle?.problems?.length ?? 0;
  const boardErr = bundle?.board?.error ?? 0;
  const tail = urgency.quiet ? " Sotto soglia: resto in silenzio." : " Segnalo perché la soglia è superata.";
  return `Digest orario. Salute ${health} (${score}). Quadro: ${boardErr} errori. Problemi aperti: ${problems}.${tail}`;
}

async function defaultCollect() {
  const { collectWakeBundle } = await import("./atlasResident.js");
  return collectWakeBundle({ module: "map" });
}

export async function runScheduledJob(jobId, deps = {}) {
  const data = readSchedule();
  const job = data.jobs.find((row) => row.id === jobId);
  if (!job) {
    const err = new Error("job assente");
    err.status = 404;
    throw err;
  }
  const collect = deps.collect || defaultCollect;
  let bundle = {};
  try {
    bundle = (await collect()) || {};
  } catch (err) {
    bundle = { health: { status: "unknown", score: null }, problems: [], problemCount: 0, board: {} };
    bundle.collectError = err?.message || "collect failed";
  }
  const urgency = deps.urgency || urgencyForBundle(bundle);
  const ids = Array.isArray(deps.propose) ? deps.propose : defaultPropose(bundle);
  const gated = gateHandActions(ids);
  const spoken = urgency.speak === true && urgency.quiet !== true;
  const executed = spoken ? gated.actions : [];
  const summary = asAtlasLine(digestLine(bundle, urgency));
  const result = {
    at: new Date(clock()).toISOString(),
    jobId: job.id,
    spoken,
    quiet: !spoken,
    score: urgency.score,
    threshold: urgency.threshold,
    summary,
    executed,
    actions: executed,
    ask: gated.ask,
    tagged: gated.tagged,
  };
  job.lastAt = result.at;
  job.lastResult = result;
  job.nextAt = nextAtFor(job, clock());
  const idx = data.jobs.findIndex((row) => row.id === job.id);
  data.jobs[idx] = job;
  persist(data);
  recordDecision({
    source: "schedule",
    choices: [
      {
        action: job.id,
        mode: spoken ? "auto" : "ask",
        reason: spoken ? "digest" : "urgency",
        because: spoken
          ? "Sopra soglia X5: annuncio il digest. Solo gli id AUTO partono."
          : "Sotto soglia X5: registro il digest e non interrompo.",
      },
      ...gated.tagged.map((step) => ({
        action: step.id,
        mode: spoken && step.mode === "auto" ? "auto" : "ask",
        reason: step.reason || "schedule",
        because: spoken && step.mode === "auto" ? `Digest: «${step.id}» può partire.` : `Digest: «${step.id}» non parte.`,
      })),
    ],
  });
  noteToolCall({
    name: `schedule.${job.id}`,
    mode: spoken ? "auto" : "ask",
    stub: false,
    detail: spoken ? "digest annunciato" : "digest silenzioso",
  });
  if (spoken) {
    const event = {
      kind: "proactive",
      severity: urgency.score >= 90 ? "critical" : "high",
      toast: summary,
      eventKind: "status-digest",
    };
    if (typeof deps.publish === "function") deps.publish(event);
    else noteResidentIngress(event);
  }
  return { ...result, name: "Atlas", job: publicJob(job) };
}

export async function runDueJobs(deps = {}) {
  const now = clock();
  const due = readSchedule().jobs.filter((job) => job.enabled !== false && Date.parse(job.nextAt || "") <= now);
  const results = [];
  for (const job of due) {
    results.push(await runScheduledJob(job.id, deps));
  }
  return results;
}

function arm(delayMs) {
  if (timer) clearTimeout(timer);
  const delay = Math.max(250, Math.min(delayMs, 2 ** 31 - 1));
  timer = setTimeout(() => {
    timer = null;
    runDueJobs()
      .catch((err) => console.warn("[atlas-schedule]", err?.message || err))
      .finally(() => {
        if (installed) armNext();
      });
  }, delay);
  if (typeof timer.unref === "function") timer.unref();
}

function armNext() {
  const now = Date.now();
  const times = readSchedule()
    .jobs.filter((job) => job.enabled !== false && job.nextAt)
    .map((job) => Date.parse(job.nextAt))
    .filter((value) => Number.isFinite(value));
  if (!times.length) {
    arm(HOUR_MS);
    return;
  }
  arm(Math.max(250, Math.min(...times) - now));
}

export function installAtlasSchedule() {
  if (installed) return publicSchedule();
  installed = true;
  try {
    ensureDefaultSchedule();
  } catch (err) {
    console.warn("[atlas-schedule] seed", err?.message || err);
  }
  armNext();
  return publicSchedule();
}
