/**
 * X2: named multi-step playbooks Atlas can run.
 * morning-open is wake, then the module, then open problems.
 * Each step is checkpointed (J2) and gated by L3.
 */
import { gateHandActions } from "./atlasAutonomyPolicy.js";
import { asAtlasLine } from "./atlasPersonality.js";
import { recordDecision } from "./atlasDecisionLog.js";
import { noteToolCall } from "./atlasToolLog.js";
import { workflowById, ATLAS_WORKFLOWS } from "./atlasRoute.js";
import { executeRun, publicRun, readRun, startRun } from "./atlasRuns.js";

let depsOverride = {};

export function setWorkflowDepsForTests(deps) {
  depsOverride = deps && typeof deps === "object" ? deps : {};
}

export function listWorkflows() {
  return ATLAS_WORKFLOWS.map((workflow) => ({
    id: workflow.id,
    title: workflow.title,
    aliases: [...workflow.aliases],
    steps: workflow.steps.map((step) => ({ id: step.id, kind: step.kind })),
  }));
}

function clip(value, max) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max).trim();
}

async function defaultWake() {
  const { wakeResident } = await import("./atlasResident.js");
  return wakeResident({ prepareHabits: true, preferStored: true });
}

async function defaultProblems() {
  const { getAgentqProblems } = await import("./agentqBridge.js");
  return getAgentqProblems({ limit: 12 });
}

async function defaultStatus() {
  const { answerPlanciaStateLive } = await import("./atlasStateAnswer.js");
  return answerPlanciaStateLive({ question: "stato della plancia", module: "map" });
}

async function defaultNews() {
  const { getCachedNews } = await import("./newsIngest.js");
  return getCachedNews(6);
}

async function resolveModule(step, deps) {
  if (step?.module) return String(step.module);
  if (deps.module) return String(deps.module);
  try {
    const { readAtlasSession } = await import("./atlasSessionStore.js");
    return readAtlasSession().module || "map";
  } catch {
    return "map";
  }
}

export async function performWorkflowStep(step, deps = {}) {
  const kind = step?.kind;
  if (kind === "wake") {
    const wake = deps.wake ? await deps.wake(step) : await defaultWake();
    return { ok: true, summary: clip(wake?.summary || wake?.reply || "Risveglio eseguito.", 400) };
  }
  if (kind === "module") {
    const moduleId = (await resolveModule(step, deps)) || "map";
    const gated = gateHandActions([moduleId]);
    const pause = gated.actions.length === 0;
    return {
      ok: true,
      pause,
      summary: pause ? `Modulo «${moduleId}» resta ASK e non lo apro.` : `Apro il modulo ${moduleId}.`,
      actions: gated.actions,
      ask: gated.ask,
      tagged: gated.tagged,
    };
  }
  if (kind === "problems") {
    const problems = deps.problems ? await deps.problems() : await defaultProblems();
    const list = Array.isArray(problems?.problems) ? problems.problems : [];
    const count = Number(problems?.count ?? list.length) || 0;
    const titles = list.slice(0, 3).map((row) => row?.title).filter(Boolean);
    return {
      ok: true,
      summary: `Problemi aperti: ${count}${titles.length ? ` (${titles.join("; ")})` : ""}.`,
    };
  }
  if (kind === "status") {
    const answer = deps.status ? await deps.status() : await defaultStatus();
    return { ok: true, summary: clip(answer?.reply || answer?.summary || "Stato letto.", 400) };
  }
  if (kind === "news") {
    const { explainNewsForOperator } = await import("./atlasNewsLiteracy.js");
    const news = deps.news ? await deps.news() : await defaultNews();
    const explained = explainNewsForOperator(news, {});
    const gated = {
      actions: explained.auto || [],
      ask: explained.ask || [],
    };
    return {
      ok: true,
      summary: clip(explained.text || "Nessuna news in cache. Non invento titoli.", 500),
      actions: gated.actions,
      ask: gated.ask,
      tagged: [...(gated.actions || []).map((id) => ({ id, mode: "auto", reason: "updates" })), ...(gated.ask || [])],
    };
  }
  if (kind === "hand") {
    const action = String(step.action || step.id || "").trim();
    const gated = gateHandActions([action]);
    const pause = gated.actions.length === 0;
    return {
      ok: true,
      pause,
      summary: pause ? `«${action}» resta ASK e non parte.` : `«${action}» è AUTO.`,
      actions: gated.actions,
      ask: gated.ask,
      tagged: gated.tagged,
    };
  }
  return { ok: false, pause: true, summary: `Passo «${step?.id || "?"}» non riconosciuto.`, ask: [] };
}

function presentWorkflow(workflow, run) {
  const actions = [];
  const ask = [];
  const tagged = [];
  const summaries = [];
  for (const step of run?.steps || []) {
    const result = step.result || {};
    if (result.summary) summaries.push(result.summary);
    for (const id of result.actions || []) {
      if (!actions.includes(id)) actions.push(id);
    }
    for (const item of result.ask || []) {
      if (!ask.some((row) => row.id === item.id)) ask.push(item);
    }
    for (const item of result.tagged || []) tagged.push(item);
  }
  for (const item of run?.pendingAsk || []) {
    if (!ask.some((row) => row.id === item.id)) ask.push(item);
  }
  const id = workflow?.id || run?.workflowId || "workflow";
  recordDecision({
    source: "workflow",
    choices: [
      {
        action: id,
        mode: ask.length ? "ask" : "auto",
        reason: run?.status || "workflow",
        because: `Playbook ${id}: stato ${run?.status || "n/d"}, cursore ${run?.cursor ?? 0}.`,
      },
    ],
  });
  const reply = asAtlasLine(summaries.join(" ") || `Playbook ${workflow?.title || id}.`);
  return {
    ok: run?.status !== "failed",
    name: "Atlas",
    speaker: "Atlas",
    workflow: id,
    run: publicRun(run),
    reply,
    summary: summaries.join(" "),
    actions,
    ask,
    tagged,
    trust: { mode: ask.length ? "ask" : "auto", reason: "workflow" },
    trustLine: ask.length
      ? `Affidabilità · ASK ${ask.map((item) => item.id).join(", ")}`
      : "Affidabilità · AUTO · workflow",
  };
}

function mergedDeps(deps) {
  return { ...depsOverride, ...(deps || {}) };
}

export async function runWorkflow(workflowId, deps = {}) {
  const workflow = workflowById(workflowId);
  if (!workflow) {
    const err = new Error(`Workflow sconosciuto: ${workflowId}`);
    err.status = 404;
    throw err;
  }
  const use = mergedDeps(deps);
  const run = startRun({
    kind: "workflow",
    title: workflow.title,
    workflowId: workflow.id,
    steps: workflow.steps,
  });
  noteToolCall({ name: `workflow.${workflow.id}`, mode: "auto", stub: false, detail: "avvio" });
  const finished = await executeRun(run.id, (step) => performWorkflowStep(step, use));
  return presentWorkflow(workflow, finished);
}

export async function resumeWorkflowRun(runId, deps = {}) {
  const existing = readRun(runId);
  if (!existing) {
    const err = new Error("run assente");
    err.status = 404;
    throw err;
  }
  const workflow = workflowById(existing.workflowId) || {
    id: existing.workflowId,
    title: existing.title,
    steps: existing.steps,
  };
  if (existing.status === "done") return presentWorkflow(workflow, existing);
  const use = mergedDeps(deps);
  noteToolCall({
    name: `workflow.${workflow.id || existing.id}`,
    mode: "auto",
    stub: false,
    detail: "ripresa",
  });
  const finished = await executeRun(existing.id, (step) => performWorkflowStep(step, use), { resumePaused: true });
  return presentWorkflow(workflow, finished);
}

export async function resumeInterruptedWorkflows() {
  const { resumeInterruptedRuns } = await import("./atlasRuns.js");
  return resumeInterruptedRuns((step) => performWorkflowStep(step, mergedDeps({})));
}
