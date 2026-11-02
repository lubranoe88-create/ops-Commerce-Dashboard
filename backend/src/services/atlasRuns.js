/**
 * J2: durable resumable runs.
 * Each step is checkpointed to disk before it starts and after it finishes.
 * A restart reads the file and continues from the unfinished step.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, "../../data/agentq-memory/atlas-runs.json");
const MAX_RUNS = 40;

let pathOverride = "";

export function setRunsFileForTests(filePath) {
  pathOverride = filePath ? path.resolve(filePath) : "";
}

export function runsFilePath() {
  return pathOverride || DEFAULT_PATH;
}

function emptyStore() {
  return { version: 1, runs: [] };
}

export function readRunStore() {
  try {
    const raw = JSON.parse(fs.readFileSync(runsFilePath(), "utf8"));
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.runs)) return emptyStore();
    return { version: 1, runs: raw.runs };
  } catch {
    return emptyStore();
  }
}

function persist(data) {
  const dest = runsFilePath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const body = {
    version: 1,
    runs: (data.runs || []).slice(0, MAX_RUNS),
  };
  const tmp = path.join(path.dirname(dest), `.atlas-runs.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, dest);
  return body;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function publicRun(run) {
  if (!run) return null;
  return {
    id: run.id,
    kind: run.kind,
    title: run.title,
    workflowId: run.workflowId || "",
    status: run.status,
    cursor: run.cursor,
    phase: run.phase || "",
    lastError: run.lastError || "",
    pendingAsk: Array.isArray(run.pendingAsk) ? run.pendingAsk : [],
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    steps: (run.steps || []).map((step) => ({
      id: step.id,
      kind: step.kind,
      status: step.status,
      summary: step.result?.summary || "",
    })),
  };
}

function compactResult(outcome) {
  if (!outcome || typeof outcome !== "object") return {};
  const actions = Array.isArray(outcome.actions) ? outcome.actions.map((id) => String(id)).slice(0, 12) : [];
  const ask = Array.isArray(outcome.ask) ? outcome.ask.slice(0, 12) : [];
  const tagged = Array.isArray(outcome.tagged) ? outcome.tagged.slice(0, 12) : [];
  return {
    ok: outcome.ok !== false,
    summary: String(outcome.summary || "").slice(0, 500),
    actions,
    ask,
    tagged,
    pause: Boolean(outcome.pause),
  };
}

function normalizeSteps(steps) {
  return (Array.isArray(steps) ? steps : []).slice(0, 24).map((step, index) => ({
    id: String(step?.id || `step-${index + 1}`).slice(0, 40),
    kind: String(step?.kind || "hand").slice(0, 24),
    module: String(step?.module || "").slice(0, 40),
    action: String(step?.action || "").slice(0, 60),
    status: "pending",
    result: null,
  }));
}

export function startRun({ kind = "workflow", title = "", workflowId = "", steps = [] } = {}) {
  const now = new Date().toISOString();
  const run = {
    id: `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    kind: String(kind || "workflow").slice(0, 24),
    title: String(title || workflowId || "run").slice(0, 80),
    workflowId: String(workflowId || "").slice(0, 60),
    status: "running",
    cursor: 0,
    phase: "created",
    lastError: "",
    pendingAsk: [],
    steps: normalizeSteps(steps),
    createdAt: now,
    updatedAt: now,
  };
  if (!run.steps.length) {
    run.status = "done";
    run.phase = "done";
  }
  const data = readRunStore();
  data.runs.unshift(run);
  const open = data.runs.filter((row) => row.status === "running" || row.status === "paused");
  const rest = data.runs.filter((row) => row.status !== "running" && row.status !== "paused");
  data.runs = [...open, ...rest].slice(0, MAX_RUNS);
  persist(data);
  return clone(run);
}

export function readRun(id) {
  const run = readRunStore().runs.find((row) => row.id === id);
  return run ? clone(run) : null;
}

export function updateRun(id, mutate) {
  const data = readRunStore();
  const run = data.runs.find((row) => row.id === id);
  if (!run) return null;
  mutate(run);
  run.updatedAt = new Date().toISOString();
  persist(data);
  return clone(run);
}

export function listRuns({ status = "" } = {}) {
  const want = String(status || "").trim();
  return readRunStore()
    .runs.filter((run) => !want || run.status === want)
    .slice(0, 20)
    .map(publicRun);
}

export function listOpenRuns() {
  return readRunStore()
    .runs.filter((run) => run.status === "running" || run.status === "paused")
    .map(publicRun);
}

/**
 * Continue a run from its cursor. The current step is marked started on disk
 * before `performer` is awaited, so a crash mid-step retries that step.
 * ASK outcomes pause the run and do not advance the cursor.
 */
export async function executeRun(id, performer, { resumePaused = false } = {}) {
  if (typeof performer !== "function") throw new Error("performer richiesto");
  let allowPaused = Boolean(resumePaused);
  for (let guard = 0; guard < 30; guard += 1) {
    const run = readRun(id);
    if (!run) {
      const err = new Error("run assente");
      err.status = 404;
      throw err;
    }
    if (run.status === "done") return run;
    if (run.status === "paused" && !allowPaused) return run;
    allowPaused = false;
    if (run.cursor >= run.steps.length) {
      return updateRun(id, (row) => {
        row.status = "done";
        row.phase = "done";
      });
    }
    updateRun(id, (row) => {
      row.status = "running";
      row.phase = "started";
      row.lastError = "";
      const step = row.steps[row.cursor];
      if (step) {
        step.status = "started";
        step.startedAt = new Date().toISOString();
      }
    });
    let outcome;
    try {
      outcome = await performer(readRun(id).steps[readRun(id).cursor], readRun(id));
    } catch (err) {
      updateRun(id, (row) => {
        row.status = "running";
        row.phase = "error";
        row.lastError = String(err?.message || err).slice(0, 240);
        const step = row.steps[row.cursor];
        if (step) {
          step.status = "error";
          step.error = row.lastError;
        }
      });
      throw err;
    }
    const compact = compactResult(outcome);
    if (outcome?.pause) {
      return updateRun(id, (row) => {
        row.status = "paused";
        row.phase = "paused";
        row.pendingAsk = compact.ask;
        const step = row.steps[row.cursor];
        if (step) {
          step.status = "paused";
          step.result = compact;
        }
      });
    }
    const finished = updateRun(id, (row) => {
      const step = row.steps[row.cursor];
      if (step) {
        step.status = "done";
        step.result = compact;
      }
      row.cursor += 1;
      row.pendingAsk = [];
      row.phase = "checkpoint";
      row.status = row.cursor >= row.steps.length ? "done" : "running";
    });
    if (finished.status === "done") return finished;
  }
  return readRun(id);
}

export async function resumeInterruptedRuns(performer) {
  const pending = readRunStore().runs.filter((run) => run.status === "running");
  const out = [];
  for (const run of pending) {
    try {
      out.push(await executeRun(run.id, performer, { resumePaused: false }));
    } catch (err) {
      out.push({ id: run.id, error: String(err?.message || err) });
    }
  }
  return out;
}
