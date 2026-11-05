/**
 * Done-pack proof for Atlas.
 * Phase Later and X6 are done for the desktop always-on path.
 * iPad always-on stays deferred: touch Safari remains Phase Now (gesture MIC).
 * isolate:true redirects stores to a temp directory. /health uses isolate:false.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { ATLAS_BUILD } from "../atlasBuild.js";
import { aiRouter } from "../routes/ai.js";
import { alternateChatModel } from "./chatModels.js";
import { assembleChatMessages, buildSpeechChain, completeChat } from "./openrouter.js";
import {
  ATLAS_NAME,
  ATLAS_PERSONA_STAMP,
  ATLAS_STATUS_NAME,
  asAtlasLine,
  presentAtlasChatText,
  presentAtlasThreadTitle,
  withAtlasPersona,
} from "./atlasPersonality.js";
import {
  START_CONSERVATIVE,
  THRESHOLD,
  classifyAction,
  describePolicy,
  recordAskApproval,
  setTrustFileForTests,
} from "./atlasAutonomyPolicy.js";
import { installAtlasResident, residentStatus } from "./atlasResident.js";
import { answerFromBundle, answerPlanciaState, isPlanciaStateQuestion } from "./atlasStateAnswer.js";
import {
  isExplicitSearchRequest,
  refusesImplicitSearch,
  searchRefusal,
  stripUnrequestedReads,
} from "./atlasSearchGate.js";
import { collectAutoFixes, proposeResolutions } from "./atlasProblemResolve.js";
import {
  publicAtlasSession,
  readAtlasSession,
  rememberWake,
  restoredFrom,
  setSessionFileForTests,
} from "./atlasSessionStore.js";
import { assessSpendStatus, spendAskId } from "./atlasSpend.js";
import { trustLineForResult, trustLineFromTagged, trustModeFromTagged } from "./atlasTrust.js";
import { proposeNextSteps } from "./atlasSuggestions.js";
import {
  attemptSelfHeal,
  healNeeded,
  isDestructiveSignal,
  isTransientFlag,
  resetSelfHealForTests,
} from "./atlasSelfHeal.js";
import { URGENCY_THRESHOLD, classifyUrgency } from "./atlasUrgency.js";
import {
  bucketFor,
  noteHabit,
  preferredFocus,
  resetHabitsForTests,
  setHabitsClockForTests,
  setHabitsFileForTests,
} from "./atlasHabits.js";
import {
  findAnomalies,
  offerCuriosity,
  resetCuriosityForTests,
  setCuriosityClockForTests,
  setCuriosityFileForTests,
} from "./atlasCuriosity.js";
import { formatRecallBlock, rankRecall } from "./atlasRecall.js";
import {
  FAILURES_TO_OPEN,
  classifyProviderFailure,
  reliabilityNow,
  resetReliabilityForTests,
  retryTransient,
  runProvider,
  setReliabilityClockForTests,
  setReliabilityFileForTests,
  setReliabilitySleeperForTests,
} from "./atlasReliability.js";
import {
  formatDecisionLine,
  listDecisions,
  recordDecision,
  setDecisionFileForTests,
} from "./atlasDecisionLog.js";
import { REQUIRED_HAND_IDS, runStartupIntegrity } from "./atlasStartupIntegrity.js";
import { dispatchAtlasTurn } from "./atlasSpecialists.js";
import { matchWorkflowUtterance, routeAtlasTurn } from "./atlasRoute.js";
import { executeRun, listRuns, publicRun, setRunsFileForTests, startRun } from "./atlasRuns.js";
import { handleMcpMessage, setMcpRegistryFileForTests } from "./atlasMcp.js";
import {
  cronMatches,
  defaultHourlyJob,
  publicSchedule,
  saveJob,
  setScheduleClockForTests,
  setScheduleFileForTests,
  stopScheduleForTests,
} from "./atlasSchedule.js";
import { buildCockpit } from "./atlasCockpit.js";
import { listWorkflows, setWorkflowDepsForTests } from "./atlasWorkflows.js";
import { buildMemoryGraph } from "./atlasMemoryGraph.js";
import { setToolLogFileForTests } from "./atlasToolLog.js";
import { setMemoryExpandPathForTests } from "./agentqBridge.js";
import * as speak from "../../public/js/atlasSpeak.js";
import * as call from "../../public/js/atlasCall.js";
import * as wake from "../../public/js/atlasWake.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

export const PROVE_DEFERRED = Object.freeze([
  {
    id: "ipad-always-on",
    title: "iPad always-on",
    detail: "iPad and iPhone stay Phase Now (gesture MIC). Desktop always-on does not claim the iPad audio session.",
  },
]);

function must(cond, message) {
  if (!cond) throw new Error(message || "prove check failed");
}

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function findRoute(router, routePath, method) {
  const want = String(method || "get").toLowerCase();
  for (const layer of router?.stack || []) {
    const route = layer?.route;
    if (!route || route.path !== routePath) continue;
    if (route.methods?.[want]) return route;
  }
  return null;
}

function invokeRoute(route, req) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (status, body) => {
      if (settled) return;
      settled = true;
      resolve({ status, body });
    };
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        finish(this.statusCode, body);
        return this;
      },
      end() {
        finish(this.statusCode, null);
        return this;
      },
    };
    const handlers = (route?.stack || []).map((layer) => layer.handle);
    let index = 0;
    const next = (err) => {
      if (settled) return;
      if (err) {
        settled = true;
        reject(err);
        return;
      }
      const handler = handlers[index];
      index += 1;
      if (!handler) {
        finish(res.statusCode, null);
        return;
      }
      try {
        const out = handler(req, res, next);
        if (out && typeof out.then === "function") {
          out.then(
            () => {
              if (!settled && index >= handlers.length) finish(res.statusCode, null);
            },
            (error) => {
              if (!settled) {
                settled = true;
                reject(error);
              }
            },
          );
        }
      } catch (error) {
        if (!settled) {
          settled = true;
          reject(error);
        }
      }
    };
    next();
  });
}

async function withPaid(fn) {
  const prev = config.aiEntitlement;
  config.aiEntitlement = "paid";
  try {
    return await fn();
  } finally {
    config.aiEntitlement = prev;
  }
}

function beginIsolate() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-prove-"));
  const file = (name) => path.join(dir, name);
  setTrustFileForTests(file("trust.json"));
  setSessionFileForTests(file("session.json"), { mirror: false });
  setDecisionFileForTests(file("decisions.json"));
  setToolLogFileForTests(file("tools.json"));
  setRunsFileForTests(file("runs.json"));
  setScheduleFileForTests(file("schedule.json"));
  setScheduleClockForTests(() => Date.parse("2026-11-02T10:00:00.000Z"));
  setMcpRegistryFileForTests(file("mcp.json"));
  setMemoryExpandPathForTests(file("memory.json"));
  setHabitsFileForTests(file("habits.json"));
  setHabitsClockForTests(() => Date.parse("2026-11-02T10:00:00.000Z"));
  setCuriosityFileForTests(file("curiosity.json"));
  setCuriosityClockForTests(() => Date.parse("2026-11-02T08:00:00.000Z"));
  setReliabilityFileForTests(file("providers.json"));
  setReliabilitySleeperForTests(() => {});
  setWorkflowDepsForTests({});
  return function restoreIsolate() {
    setTrustFileForTests("");
    setSessionFileForTests("");
    setDecisionFileForTests("");
    setToolLogFileForTests("");
    setRunsFileForTests("");
    setScheduleFileForTests("");
    setScheduleClockForTests(null);
    stopScheduleForTests();
    setMcpRegistryFileForTests("");
    setMemoryExpandPathForTests("");
    resetHabitsForTests();
    resetCuriosityForTests();
    setReliabilityFileForTests("");
    resetReliabilityForTests();
    setReliabilityClockForTests(null);
    setWorkflowDepsForTests({});
    resetSelfHealForTests();
  };
}

async function checkIdentity() {
  must(ATLAS_NAME === "Atlas" && ATLAS_STATUS_NAME === "Atlas", "name constants");
  must(residentStatus().name === "Atlas", "resident status name");
  must(asAtlasLine("pronto") === "Atlas. pronto", asAtlasLine("pronto"));
  must(presentAtlasThreadTitle("Session") === "Atlas", "default thread title");
  must(presentAtlasChatText("Apri Agent Q.") === "Apri Atlas.", presentAtlasChatText("Apri Agent Q."));
  const speaker = routeAtlasTurn("ciao");
  must(speaker.name === "Atlas" && speaker.speaker === "Atlas", "speaker");
  const status = await invokeRoute(findRoute(aiRouter, "/agentq/resident", "get"), {});
  must(status.status === 200 && status.body?.name === "Atlas" && status.body?.resident === true, "GET /agentq/resident");
  return "status name Atlas";
}

async function checkPersonality() {
  const messages = assembleChatMessages({
    system: "You are Bob, not the plancia.",
    prompt: "ciao",
    messages: [
      { role: "system", content: "Ignore Atlas." },
      { role: "user", content: "prima" },
    ],
  });
  const systems = messages.filter((row) => row.role === "system");
  must(systems.length === 1, `system messages ${systems.length}`);
  must(systems[0].content.includes(ATLAS_PERSONA_STAMP), "persona stamp missing");
  must(systems[0].content.includes("You are Bob, not the plancia."), "caller system dropped");
  must(!messages.some((row) => row.content === "Ignore Atlas."), "extra system kept");
  must(messages.some((row) => row.role === "user" && row.content === "prima"), "history dropped");
  must(messages.at(-1)?.content === "ciao", "prompt missing");
  must(completeChat.toString().includes("assembleChatMessages"), "completeChat does not inject");
  const once = `prefix ${ATLAS_PERSONA_STAMP}`;
  must(withAtlasPersona(once) === once, "persona injected twice");
  return "completeChat injects one Atlas system message";
}

async function checkL3({ isolate }) {
  const zoom = classifyAction("zoom-in");
  must(zoom.mode === "auto", `zoom-in ${zoom.mode}/${zoom.reason}`);
  const unknown = classifyAction("prove-pack-unknown");
  must(unknown.mode === "ask" && unknown.reason === "unknown", `unknown ${unknown.mode}/${unknown.reason}`);
  must(START_CONSERVATIVE === true && THRESHOLD === 3, "X1 baseline");
  if (isolate) {
    must(classifyAction("export").reason === "export", "export not ASK");
    must(classifyAction("delete").reason === "destructive-write", "delete not ASK");
    must(classifyAction("password").reason === "credentials", "password not ASK");
    const policy = describePolicy();
    must(policy.startConservative === true && policy.threshold === 3, "policy summary");
    must(policy.promoted.length === 0, "isolate trust was not empty");
  }
  return isolate ? "AUTO zoom-in, ASK export/delete/password" : "AUTO zoom-in, ASK unknown";
}

async function checkX1({ isolate }) {
  const route = findRoute(aiRouter, "/agentq/autonomy/approve", "post");
  must(route, "POST /agentq/autonomy/approve missing");
  await withPaid(async () => {
    const missing = await invokeRoute(route, { body: {} });
    must(missing.status === 400 && missing.body?.error === "actionId richiesto", "missing actionId");
    const blank = await invokeRoute(route, { body: { actionId: "   " } });
    must(blank.status === 400, "blank actionId");
    const auto = await invokeRoute(route, { body: { id: "zoom-in" } });
    must(auto.status === 200, `zoom approve ${auto.status}`);
    must(auto.body?.ok === true && auto.body?.recorded === false, "AUTO id was recorded");
    must(auto.body?.actionId === "zoom-in", "id alias");
    must(auto.body?.threshold === 3 && auto.body?.startConservative === true, "threshold shape");
    must("promoted" in auto.body && "approvalCounts" in auto.body, "promoted shape");
    must("count" in auto.body && "justPromoted" in auto.body && "reason" in auto.body, "count shape");
    if (isolate) {
      let last;
      for (let i = 0; i < 3; i += 1) {
        last = await invokeRoute(route, { body: { actionId: "Password" } });
        must(last.status === 200 && last.body?.recorded === true, `confirm ${i + 1}`);
        must(last.body?.actionId === "password", "id not normalized");
      }
      must(last.body.count === 3 && last.body.justPromoted === true, "third confirm");
      must(last.body.approvalCounts?.password === 3, "approvalCounts");
      must(last.body.promoted.includes("password"), "promoted list");
      must(classifyAction("password").mode === "auto", "password stayed ASK");
      must(classifyAction("token").mode === "ask", "sibling token promoted");
      must(classifyAction("export").mode === "ask", "export promoted with password");
    }
  });
  must(recordAskApproval("").ok === false, "empty id shape");
  return isolate ? "approve shape and third confirm promotes one id" : "approve endpoint shape";
}

async function checkResidentWake() {
  const wake = findRoute(aiRouter, "/agentq/resident/wake", "post");
  must(wake, "POST /agentq/resident/wake missing");
  const src = wake.stack.map((layer) => String(layer.handle)).join("\n");
  must(src.includes("wakeResident"), "wake handler does not call wakeResident");
  const events = findRoute(aiRouter, "/agentq/resident/events", "get");
  must(events, "resident event stream missing");
  must(residentStatus().resident === true, "resident flag");
  return "POST /agentq/resident/wake";
}

async function checkL2() {
  installAtlasResident();
  must(residentStatus().installed === true, "resident not installed");
  must(installAtlasResident.toString().includes("onResidentIngress"), "bus not subscribed");
  const bridge = read("backend/src/services/agentqBridge.js");
  const store = read("backend/src/memory/aiStore.js");
  const schedule = read("backend/src/services/atlasSchedule.js");
  must(bridge.includes('noteResidentIngress({ kind: "updates"'), "updates hook");
  must(store.includes("noteResidentIngress") && store.includes('kind: "proactive"'), "proactive hook");
  must(store.includes('kind: "news"'), "news hook");
  must(schedule.includes("noteResidentIngress(event)"), "schedule hook");
  must(read("backend/src/services/atlasResident.js").includes("onResidentIngress(enqueueIngress)"), "resident subscribe");
  return "wake route bus: updates, news, proactive, schedule";
}

async function checkC2() {
  must(isPlanciaStateQuestion("quanti problemi aperti?"), "problems question");
  must(isPlanciaStateQuestion("zoom out") === false, "zoom counted as state");
  const answer = answerPlanciaState("quanti problemi aperti?", { module: "map", problemCount: 4 });
  must(answer.name === "Atlas" && answer.model === null, "state used a model");
  must(answer.reply.startsWith("Atlas."), answer.reply);
  must(answer.reply.includes("Problemi aperti: 4"), answer.reply);
  must(!answer.reply.includes("Acme"), "invented a top");
  must(answer.trust?.mode === "auto", "state trust");
  const fromBundle = answerFromBundle("qual è il modulo aperto?", {
    module: "pipeline",
    problemCount: 0,
    health: { status: "ok", score: 90, openErrors: 0 },
  });
  must(fromBundle.reply.includes("Modulo aperto: pipeline"), fromBundle.reply);
  must(findRoute(aiRouter, "/agentq/state", "post"), "state route");
  return "state answers from the given facts";
}

async function checkC3() {
  must(isExplicitSearchRequest("cerca porto di genova"), "explicit search");
  must(refusesImplicitSearch("guarda nella sandbox"), "implicit sandbox");
  must(refusesImplicitSearch("cerca nella sandbox") === false, "explicit search refused");
  must(searchRefusal().startsWith("Atlas."), "refusal name");
  const stripped = stripUnrequestedReads(["search", "zoom-in"], "stato plancia");
  must(stripped.refused === true && !stripped.actions.includes("search") && stripped.actions.includes("zoom-in"), "reads kept");
  await withPaid(async () => {
    const route = findRoute(aiRouter, "/agentq/search", "post");
    must(route, "search route");
    const refused = await invokeRoute(route, { body: { explicit: false, query: "sandbox" } });
    must(refused.status === 409 && refused.body?.searched === false, `search status ${refused.status}`);
    must(refused.body?.name === "Atlas" && String(refused.body?.reply || "").includes("Non cerco"), "search refusal body");
  });
  return "search stays off until asked";
}

async function checkC6() {
  const rows = proposeResolutions([
    { id: "pipe-1", kind: "pipeline", title: "Ritardo porto", detail: "banchina" },
  ]);
  must(rows.length === 1 && rows[0].steps.length >= 2, "pipeline steps");
  must(rows[0].auto.includes("pipeline") && rows[0].auto.includes("inspect"), `auto ${rows[0].auto}`);
  must(collectAutoFixes(rows).includes("pipeline"), "auto fixes");
  const browser = proposeResolutions([
    { id: "br", kind: "function-board", title: "browser-use fermo", detail: "browser-use non installato" },
  ]);
  must(browser[0].ask.some((step) => step.id === "browser-use" && step.mode === "ask"), "browser-use ran");
  must(!browser[0].auto.includes("browser-use"), "browser-use auto");
  must(findRoute(aiRouter, "/agentq/problems", "get"), "problems route");
  return "problems propose AUTO steps and keep browser-use on ASK";
}

async function checkC9({ isolate }) {
  const restored = restoredFrom(
    {
      wakeSummary: "Atlas. Plancia sul modulo map.",
      module: "map",
      pendingAsk: [{ id: "export", reason: "export" }],
    },
    { applyModule: true },
  );
  must(restored?.applyModule === true && restored.module === "map", "restore");
  must(restored.pendingAsk[0]?.id === "export", "pending ASK");
  const pub = publicAtlasSession(restored);
  must(pub.name === "Atlas" && pub.wakeSummary.includes("modulo map"), "public session");
  if (isolate) {
    const saved = rememberWake({
      wakeSummary: "Atlas. Plancia sul modulo map.",
      module: "map",
      pendingAsk: [{ id: "export", reason: "export" }],
    });
    must(saved.module === "map" && saved.pendingAsk[0]?.id === "export", "session file");
    const again = readAtlasSession();
    must(again.wakeSummary.includes("modulo map"), "session reread");
  }
  const live = await invokeRoute(findRoute(aiRouter, "/agentq/session", "get"), {});
  must(live.status === 200 && live.body?.name === "Atlas", "session route");
  if (isolate) must(live.body?.module === "map", "session route missed the file");
  return isolate ? "session file restores wake, module, and ASK" : "session restore shape";
}

async function checkC11() {
  const budget = { spentEur: 70, capEur: 100, softRatio: 0.75, softBlocked: false, hardBlocked: false };
  const ask = assessSpendStatus(budget, { tier: "main", confirm: false, estimateEur: 10 });
  must(ask.ask === true && ask.mode === "ask" && ask.reason === "spend-past-soft-band", `ask ${ask.mode}/${ask.reason}`);
  must(/fascia soft/i.test(ask.line) && /conferma/i.test(ask.line), ask.line);
  const confirmed = assessSpendStatus(budget, { tier: "main", confirm: true, estimateEur: 10 });
  must(confirmed.ask === false && confirmed.wouldCross === true, "confirm ignored");
  const under = assessSpendStatus(
    { spentEur: 10, capEur: 100, softRatio: 0.75 },
    { tier: "main", estimateEur: 1 },
  );
  must(under.mode === "auto" && under.ask === false, `under ${under.mode}`);
  must(spendAskId("grok") === "escalate-grok" && spendAskId("main") === "escalate-main", "ask id");
  return "soft band asks before the paid turn";
}

async function checkC12() {
  const line = trustLineFromTagged([
    { id: "zoom-in", mode: "auto" },
    { id: "export", mode: "ask" },
  ]);
  must(line.includes("AUTO zoom-in") && line.includes("ASK export"), line);
  must(trustModeFromTagged([{ id: "export", mode: "ask" }]) === "ask", "mode");
  must(trustLineForResult([]).includes("AUTO"), trustLineForResult([]));
  const state = answerPlanciaState("come sta la plancia?", {
    module: "map",
    health: { status: "ok", score: 80, openErrors: 0 },
  });
  must(state.trust?.mode === "auto" && String(state.trustLine || "").includes("AUTO"), "state tag");
  return "auto and ask tags";
}

async function checkC7() {
  const held = proposeNextSteps({ integrityOk: false, bundle: { health: { status: "degraded", openErrors: 2 } } });
  must(held.held === true && held.auto.length === 0, "suggestions ran while integrity failed");
  const proposed = proposeNextSteps({
    kind: "wake",
    bundle: {
      health: { status: "degraded", openErrors: 2 },
      board: { error: 1 },
      problemCount: 1,
      problems: [{ kind: "pipeline", title: "serve un export", detail: "download" }],
    },
  });
  must(proposed.auto.includes("refresh"), `auto ${proposed.auto.join(",")}`);
  must(proposed.ask.some((step) => step.id === "export" && step.mode === "ask"), "export auto");
  return "C7 proposes through the L3 gate";
}

async function checkC8({ isolate }) {
  must(healNeeded({ ok: false, failures: [{ id: "sandbox-path" }] }, null) === true, "heal not needed");
  must(healNeeded({ ok: true, failures: [] }, { board: { error: 0 }, problems: [] }) === false, "heal on a calm board");
  must(isTransientFlag({ detail: "timeout temporaneo" }) === true, "transient");
  must(isDestructiveSignal({ detail: "wipe the table" }) === true, "destructive");
  must(isDestructiveSignal({ detail: "timeout" }) === false, "timeout treated as destructive");
  if (isolate) {
    const heal = await attemptSelfHeal({
      integrity: { ok: false, failures: [{ id: "probe", detail: "timeout" }] },
      bundle: { board: { error: 1 }, problems: [] },
      deps: {
        refresh: async () => "snapshot riletto",
        rerunChecks: async () => ({ ok: true, failures: [] }),
        listFlags: () => [{ id: "flag-1", detail: "timeout probe", transient: true }],
        clearFlag: async () => true,
      },
    });
    must(heal?.attempted === true && heal.executed.includes("refresh"), "refresh not run");
    must(heal.cleared.includes("flag-1"), "transient flag kept");
    must(heal.ask.length === 0, "transient flag became ASK");
    must(String(heal.decisionLine || "").includes("heal"), heal.decisionLine || "no decision");
  }
  return isolate ? "self-heal refreshes and clears a transient flag" : "self-heal module";
}

async function checkX5() {
  const wake = classifyUrgency({ kind: "wake", bundle: { health: { status: "ok" } } });
  must(wake.speak === true && wake.threshold === URGENCY_THRESHOLD, "wake stayed quiet");
  const quiet = classifyUrgency({
    kind: "ingress",
    batch: [{ kind: "updates", update: { title: "nota", detail: "ordinaria" } }],
  });
  must(quiet.quiet === true && quiet.interrupt === false && quiet.score < URGENCY_THRESHOLD, `quiet ${quiet.score}`);
  const loud = classifyUrgency({
    kind: "ingress",
    batch: [{ kind: "problems", problems: [{ kind: "integrity", title: "sandbox" }] }],
  });
  must(loud.speak === true && loud.score >= URGENCY_THRESHOLD, `loud ${loud.score}`);
  return "urgency speaks only at the threshold, wake always speaks";
}

async function checkP2({ isolate }) {
  must(bucketFor("2026-11-02T10:00:00.000Z") === "morning", bucketFor("2026-11-02T10:00:00.000Z"));
  if (!isolate) {
    const focus = preferredFocus({ at: "2026-11-02T10:00:00.000Z", prepare: false });
    must(focus == null || typeof focus.module === "string", "preferredFocus");
    return "habits module";
  }
  noteHabit({ module: "map", command: "export", at: "2026-11-02T10:00:00.000Z" });
  noteHabit({ module: "map", at: "2026-11-02T10:00:00.000Z" });
  const focus = preferredFocus({ at: "2026-11-02T10:00:00.000Z", prepare: true });
  must(focus?.module === "map" && focus.apply === true && focus.mode === "auto", JSON.stringify(focus));
  must(!focus.prepare.includes("export"), "ASK habit prepared");
  return "morning habit prepares map and holds export";
}

async function checkP3({ isolate }) {
  const found = findAnomalies({
    bundle: { health: { status: "ok" }, board: { error: 2 }, problemCount: 0 },
  });
  must(found.length > 0 && /anomalia/i.test(found[0].text), "no anomaly");
  if (!isolate) return "curiosity module";
  const first = offerCuriosity({
    bundle: { health: { status: "ok" }, board: { error: 2 } },
    at: "2026-11-02T08:00:00.000Z",
  });
  must(first?.offered === true && String(first.text || "").startsWith("Atlas."), "offer");
  const again = offerCuriosity({
    bundle: { health: { status: "ok" }, board: { error: 2 } },
    at: "2026-11-02T09:00:00.000Z",
  });
  must(again == null, "cooldown ignored");
  return "one curiosity observation then cooldown";
}

async function checkM1() {
  const now = Date.parse("2026-11-02T12:00:00.000Z");
  const ranked = rankRecall(
    [
      { id: "old", title: "Porto di Genova", text: "banchina", tags: ["durable"], at: "2026-10-01T12:00:00.000Z" },
      { id: "near", title: "Porto di Genova", text: "banchina", tags: ["durable"], at: "2026-11-01T12:00:00.000Z" },
      { id: "other", title: "Altra nota", text: "niente", tags: ["durable"], at: "2026-11-02T11:00:00.000Z" },
    ],
    "genova porto",
    { now, limit: 3 },
  );
  must(ranked[0]?.entry?.id === "near", `rank ${ranked.map((row) => row.entry?.id).join(",")}`);
  must(!ranked.some((row) => row.entry?.id === "other"), "unrelated note recalled");
  const block = formatRecallBlock(ranked.map((row) => row.entry));
  must(block.includes("FATTI RICHIAMATI AUTOMATICAMENTE") && block.includes("non è una ricerca"), block);
  return "recall ranks by keyword and recency";
}

async function checkM2({ isolate }) {
  const alt = alternateChatModel("deepseek/deepseek-v4.1-flash");
  must(alt && alt !== "deepseek/deepseek-v4.1-flash", `alternate ${alt}`);
  must(typeof runProvider === "function" && FAILURES_TO_OPEN === 3, "runProvider");
  if (!isolate) return `alternate model ${alt}`;
  let primary = 0;
  const value = await runProvider({
    provider: "prove-m2",
    attempts: 1,
    timeoutMs: 300,
    baseDelayMs: 1,
    budgetMs: 2000,
    run: async () => {
      primary += 1;
      const err = new Error("busy");
      err.status = 503;
      throw err;
    },
    alternate: async () => ({ content: "Atlas. alternate" }),
    mechanical: async () => ({ content: "Atlas. mechanical", fallback: "mechanical" }),
  });
  must(primary === 1, `primary calls ${primary}`);
  must(value?.fallback === "model" && String(value.content).includes("alternate"), JSON.stringify(value));
  return "primary failure falls back to the alternate model";
}

async function checkM3({ isolate }) {
  const fatal = classifyProviderFailure({ status: 401, message: "no" });
  const retry = classifyProviderFailure({ status: 503, message: "busy" });
  must(fatal.retryable === false && fatal.fatal === true, "401 retried");
  must(retry.retryable === true && retry.fatal === false, "503 fatal");
  if (!isolate) return "fatal 401, retryable 503";
  const trial = await retryTransient(
    async () => {
      const err = new Error("denied");
      err.status = 401;
      throw err;
    },
    { provider: "prove-m3", attempts: 3, baseDelayMs: 1, timeoutMs: 200, deadlineAt: reliabilityNow() + 5000 },
  );
  must(trial.ok === false && trial.attempts === 1 && trial.kind?.fatal === true, `attempts ${trial.attempts}`);
  return "fatal failures are not retried";
}

async function checkM4({ isolate }) {
  const line = formatDecisionLine({
    source: "wake",
    choices: [{ action: "zoom-in", mode: "auto", reason: "zoom", because: "zoom sicuro" }],
  });
  must(line.includes("Decisioni · wake") && line.includes("zoom-in AUTO"), line);
  if (!isolate) return "decision line";
  const entry = recordDecision({
    source: "wake",
    choices: [{ action: "zoom-in", mode: "auto", reason: "zoom", because: "prove pack" }],
  });
  must(entry?.id, "decision not stored");
  must(listDecisions({ limit: 8 }).some((row) => row.id === entry.id), "decision missing");
  return "decision log appends why";
}

async function checkM5() {
  must(typeof runStartupIntegrity === "function", "integrity runner");
  must(REQUIRED_HAND_IDS.includes("map") && REQUIRED_HAND_IDS.includes("zoom-in"), "hand ids");
  const server = read("backend/src/server.js");
  const bootAt = server.indexOf('runStartupIntegrity({ reason: "boot" })');
  const listenAt = server.indexOf("app.listen(");
  must(bootAt > 0 && listenAt > bootAt, "boot integrity is not before listen");
  return "startup integrity runs before listen";
}

async function checkJ1({ isolate }) {
  const state = routeAtlasTurn("qual è lo stato della plancia?");
  const chat = routeAtlasTurn("ciao atlas");
  must(state.specialist === "state" && state.fanout === false && state.selected.length === 1, "state route");
  must(state.name === "Atlas" && state.speaker === "Atlas", "speaker");
  must(chat.specialist === null && chat.selected.length === 0, "chat fanout");
  must(findRoute(aiRouter, "/agentq/route", "post"), "route endpoint");
  if (!isolate) return "one specialist, speaker Atlas";
  const calls = [];
  const spy = (id) => async () => {
    calls.push(id);
    return { ok: true, reply: "Atlas. Fatto.", actions: [], ask: [] };
  };
  const turn = await dispatchAtlasTurn("zoom in sul globo", {
    state: spy("state"),
    news: spy("news"),
    hands: spy("hands"),
    research: spy("research"),
  });
  must(calls.join(",") === "hands", `called ${calls.join(",")}`);
  must(turn.name === "Atlas" && turn.fanout === false && turn.handled === true, "dispatch");
  return "dispatch calls one specialist";
}

async function checkJ2({ isolate }) {
  const view = publicRun({
    id: "run-prove",
    kind: "workflow",
    title: "prove",
    workflowId: "morning-open",
    status: "paused",
    cursor: 1,
    phase: "paused",
    pendingAsk: [{ id: "export" }],
    steps: [{ id: "wake", kind: "wake", status: "done", result: { summary: "ok" } }],
  });
  must(view?.status === "paused" && view.steps[0]?.summary === "ok", "public run");
  must(findRoute(aiRouter, "/agentq/runs", "get"), "runs route");
  await mustReject(executeRun("missing", null), /performer/);
  if (!isolate) {
    must(Array.isArray(listRuns()), "listRuns");
    return "run shape";
  }
  const run = startRun({
    kind: "workflow",
    title: "prove",
    workflowId: "morning-open",
    steps: [
      { id: "wake", kind: "wake" },
      { id: "module", kind: "module" },
    ],
  });
  const paused = await executeRun(run.id, async (step) => {
    if (step.id === "module") return { pause: true, summary: "ask", ask: [{ id: "export", mode: "ask" }] };
    return { ok: true, summary: "awake" };
  });
  must(paused.status === "paused" && paused.cursor === 1, `${paused.status} cursor ${paused.cursor}`);
  const resumed = await executeRun(run.id, async () => ({ ok: true, summary: "done" }), { resumePaused: true });
  must(resumed.status === "done", resumed.status);
  return "run pauses on ASK and resumes";
}

async function mustReject(promise, pattern) {
  try {
    await promise;
  } catch (err) {
    must(pattern.test(String(err?.message || err)), err?.message || "unexpected error");
    return;
  }
  throw new Error("expected a rejection");
}

async function checkJ3() {
  const init = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize" });
  must(init.result?.serverInfo?.name === "Atlas", "mcp name");
  must(init.result?.serverInfo?.version === ATLAS_BUILD, `mcp version ${init.result?.serverInfo?.version}`);
  must(init.result?.protocolVersion === "2024-11-05", "protocol");
  const listed = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const names = (listed.result?.tools || []).map((tool) => tool.name);
  must(names.includes("zoom-in") && names.includes("workflow.morning-open"), names.slice(0, 6).join(","));
  must(findRoute(aiRouter, "/agentq/mcp", "post"), "mcp route");
  return "initialize and tools/list";
}

async function checkJ5({ isolate }) {
  const at = new Date("2026-11-02T10:00:00.000Z");
  must(cronMatches("0 10 * * *", at) === true, "cron match");
  must(cronMatches("15 10 * * *", at) === false, "cron false match");
  const job = defaultHourlyJob(Date.parse("2026-11-02T10:00:00.000Z"));
  must(job.id === "hourly-status" && job.enabled === true && job.kind === "status-digest", job.id);
  must(findRoute(aiRouter, "/agentq/schedule", "get"), "schedule route");
  const current = publicSchedule();
  must(current.name === "Atlas" && Array.isArray(current.jobs), "schedule payload");
  if (!isolate) return "hourly digest schedule";
  const saved = saveJob({ id: "prove-hourly", title: "Prove", everyMs: 3_600_000, enabled: true });
  must(saved.id === "prove-hourly", "saveJob");
  must(publicSchedule().jobs.some((row) => row.id === "prove-hourly"), "job not listed");
  return "schedule persists a job";
}

async function checkJ6() {
  const route = findRoute(aiRouter, "/agentq/cockpit", "get");
  must(route, "cockpit route");
  const live = await invokeRoute(route, {});
  const body = live.body || {};
  must(live.status === 200 && body.ok === true && body.name === "Atlas", "cockpit name");
  must(body.resident?.name === "Atlas", "cockpit resident");
  for (const key of ["pendingAsk", "decisions", "toolCalls", "runs", "schedule"]) {
    must(Array.isArray(body[key]), `cockpit ${key}`);
  }
  const direct = buildCockpit();
  must(direct.name === "Atlas" && Array.isArray(direct.decisions), "buildCockpit");
  return "cockpit payload";
}

async function checkX2() {
  const flows = listWorkflows();
  const morning = flows.find((flow) => flow.id === "morning-open");
  must(morning, "morning-open missing");
  must(morning.steps.map((step) => step.kind).join(",") === "wake,module,problems", morning.steps.map((step) => step.kind).join(","));
  must(matchWorkflowUtterance("buongiorno plancia")?.id === "morning-open", "alias");
  const route = findRoute(aiRouter, "/agentq/workflows", "get");
  const live = await invokeRoute(route, {});
  must(live.body?.name === "Atlas" && live.body?.workflows?.some((flow) => flow.id === "morning-open"), "workflows route");
  return "morning-open is listed";
}

async function checkX4() {
  const graph = buildMemoryGraph([
    { id: "a", title: "Porto", text: "genova", tags: ["porto"] },
    { id: "b", title: "Banchina", text: "altro", tags: ["porto"] },
  ]);
  must(graph.name === "Atlas" && graph.nodes.length === 2, "graph nodes");
  must(graph.edges.some((edge) => edge.reason === "tag:porto"), "tag edge");
  must(findRoute(aiRouter, "/agentq/memory/graph", "get"), "graph route");
  return "memory graph links shared tags";
}

async function checkTts() {
  const chain = buildSpeechChain();
  must(chain.length >= 3, "speech chain");
  must(/eleven[_-]flash/i.test(String(chain[0].model)), `primary ${chain[0].model}`);
  const models = chain.map((step) => String(step.model));
  const flashAt = models.findIndex((model) => /eleven[_-]flash/i.test(model));
  const deepAt = models.findIndex((model) => model.includes("deepgram"));
  const maiAt = models.findIndex((model) => model.includes("mai-voice"));
  must(flashAt === 0 && deepAt > flashAt && maiAt > deepAt, models.join(" > "));
  must(/eleven-flash/i.test(config.openRouterTtsModel), config.openRouterTtsModel);
  return `primary ${chain[0].model}`;
}

async function checkAlphabet() {
  must(speak.ALPHABET_PACK === "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@.-/#%+", speak.ALPHABET_PACK);
  for (const ch of speak.ALPHABET_PACK) {
    const expected = speak.ITALIAN_LETTERS[ch] || speak.ITALIAN_DIGITS[ch] || speak.ITALIAN_SYMBOLS[ch];
    must(speak.spellCharacter(ch) === expected, `spell ${ch}`);
  }
  const gate = speak.lockVoiceForInformationalRead();
  must(gate.locked === true && gate.missing.length === 0 && gate.fallback == null, "voice lock");
  const coded = speak.normalizeSpeakText("Il codice è AB-12");
  must(coded.text === "Il codice è a, bi, trattino, uno, due" && coded.voiceLocked === true, coded.text);
  must(speak.normalizeSpeakText("Apri la mappa").spelled === false, "prose spelled");
  return "alphabet pack locks before a code is spoken";
}

async function checkCall() {
  const opened = call.reduceCall({ open: false, phase: "idle" }, "tap");
  must(opened.action === "open" && opened.phase === "listen" && opened.duplex === "barge-cancel", "open");
  const fromWake = call.reduceCall({ open: false, phase: "idle" }, "wake");
  must(fromWake.action === "open" && fromWake.phase === "listen" && fromWake.open === true, "wake opens");
  const barge = call.reduceCall({ open: true, phase: "tts" }, "speech");
  const tap = call.reduceCall({ open: true, phase: "tts" }, "tap");
  must(barge.action === "barge" && barge.cancelAudio === true && barge.open === true, "speech barge");
  must(tap.action === "barge" && tap.cancelAudio === true && tap.phase === "listen", "tap barge");
  must(call.VOICE_DUPLEX === "barge-cancel", call.VOICE_DUPLEX);
  const src = read("public/js/atlasCall.js");
  must(src.startsWith("/**\n * Phase Now"), "Phase Now header");
  const wake = call.wakeWordStatus(true);
  must(wake.env === true && wake.armed === false && wake.phase === "later", "wake unarmed without desktop");
  must(/not armed/i.test(wake.note), wake.note);
  const app = read("public/js/app.js");
  must(app.includes("reduceCall") && app.includes("bargeIn") && app.includes("cancelPlayback"), "call ui");
  must(app.includes("isIpadLike") && app.includes("getPrimedAudioContext"), "ipad audio unlock stays");
  must(app.includes('reduceCall({ open: false, phase: "idle" }, "wake")'), "wake handoff");
  return "Phase Now barge-cancel; wake reuses the same open";
}

async function checkPhaseLater() {
  must(wake.canArmAlwaysOn({ alwaysOnEnv: true, desktop: true }) === true, "arm desktop");
  must(wake.canArmAlwaysOn({ alwaysOnEnv: true, desktop: false }) === false, "no ipad arm");
  must(wake.canArmAlwaysOn({ alwaysOnEnv: false, desktop: true }) === false, "env off");
  must(wake.isDesktopVoiceHost("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)") === false, "ipad ua");
  must(wake.isDesktopVoiceHost("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)") === false, "iphone");
  must(wake.isDesktopVoiceHost("Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)") === false, "ipod");
  must(
    wake.isDesktopVoiceHost("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", { platform: "MacIntel", maxTouchPoints: 5 }) === false,
    "ipados desktop ua",
  );
  must(wake.isDesktopVoiceHost("Mozilla/5.0 (Windows NT 10.0; Win64; x64)") === true, "windows");
  const off = call.wakeWordStatus(true, { desktop: false });
  const on = call.wakeWordStatus(true, { desktop: true });
  must(off.armed === false && off.phase === "later" && off.env === true, "server-shaped status");
  must(on.armed === true && on.phase === "desktop-always-on", "desktop status");
  must(/wake word opens Phase Now/i.test(on.note), on.note);
  const app = read("public/js/app.js");
  must(app.includes("canArmAlwaysOn") && app.includes("isDesktopVoiceHost"), "client gate");
  must(app.includes("armAlwaysOnFromGesture"), "first mic tap arms");
  must(app.includes("desktop-always-on"), "dataset phase");
  must(!app.includes("new RTCPeerConnection"), "no webrtc");
  return "desktop always-on armed; iPad stays Phase Now";
}

async function checkX6() {
  must(wake.WAKE_WORD === "Atlas", wake.WAKE_WORD);
  must(wake.WAKE_PHRASES.includes("atlas") && wake.WAKE_PHRASES.includes("ehi atlas") && wake.WAKE_PHRASES.includes("hey atlas"), "phrases");
  must(wake.matchesWakeWord("Ehi, Atlas!") && wake.matchesWakeWord("hey atlas") && wake.matchesWakeWord("Atlas"), "match");
  must(wake.matchesWakeWord("atlante") === false && wake.matchesWakeWord("apri la mappa") === false, "non match");
  let state = wake.reduceAlwaysOn({ enabled: false, phase: "off" }, "enable");
  must(state.phase === "arming" && state.enabled === true, "arming");
  state = wake.reduceAlwaysOn(state, "mic-ready");
  must(state.phase === "listening", "listening");
  const miss = wake.reduceAlwaysOn(state, "transcript", { text: "apri la mappa" });
  must(miss.phase === "listening" && miss.action === "keep", "miss");
  const opened = wake.reduceAlwaysOn(state, "transcript", { text: "ehi atlas" });
  must(opened.action === "open-call" && opened.phase === "waking", "open-call");
  const callOpen = call.reduceCall({ open: false, phase: "idle" }, "wake");
  must(callOpen.action === "open" && callOpen.phase === "listen", "same call stack");
  const inCall = wake.reduceAlwaysOn(opened, "call-open");
  must(inCall.phase === "in-call", "in-call");
  const during = wake.reduceAlwaysOn(inCall, "transcript", { text: "atlas" });
  must(during.phase === "in-call" && during.action !== "open-call", "paused");
  const back = wake.reduceAlwaysOn(inCall, "call-end");
  must(back.phase === "listening" && back.enabled === true && back.action === "resume-listen", "resume");
  const app = read("public/js/app.js");
  must(app.includes("matchesWakeWord") && app.includes("wakeOnly"), "wake spotter");
  must(app.includes("openCallFromWake"), "handoff");
  const server = read("backend/src/server.js");
  must(server.includes("wakeWordStatus(config.voiceAlwaysOn, { desktop: false })"), "health desktop false");
  must(server.includes('wakePhrase: "Atlas"'), "wake phrase");
  must(server.includes("armed: false"), "server stays unarmed");
  must(app.includes("In ascolto — di' Atlas per parlare."), "listen cue");
  must(read("backend/src/services/agentqBridge.js").includes("wakeWordStatus(config.voiceAlwaysOn, { desktop: false })"), "bridge");
  must(read("backend/src/services/agentqBridge.js").includes('wakePhrase: "Atlas"'), "bridge phrase");
  return "desktop wake word opens Phase Now; iPad always-on stays out of scope";
}

async function checkBuild() {
  const build = ATLAS_BUILD;
  must(build === "rail-44-memory-still", build);
  const server = read("backend/src/server.js");
  const app = read("public/js/app.js");
  const html = read("public/index.html");
  must(server.includes(`build: "${build}"`), "server stamp");
  must(server.includes("runtimeProve") && server.includes("summarizeProve"), "health prove");
  must(app.includes(`const BUILD_ID = "${build}"`), "BUILD_ID");
  must(html.includes(`src="/js/app.js?v=${build}"`) && html.includes(`href="/css/app.css?v=${build}"`), "html stamp");
  for (const rel of ["js/app.js", "js/atlasCall.js", "js/atlasSpeak.js", "js/atlasWake.js", "index.html"]) {
    must(read(`public/${rel}`) === read(`backend/public/${rel}`), `mirror ${rel}`);
  }
  const init = await handleMcpMessage({ jsonrpc: "2.0", id: 7, method: "initialize" });
  must(init.result?.serverInfo?.version === build, "mcp stamp");
  return build;
}

const CHECKS = [
  { id: "identity", title: "Identity and status name Atlas", run: checkIdentity },
  { id: "personality", title: "Personality inject on completeChat", run: checkPersonality },
  { id: "L3", title: "L3 AUTO vs ASK", run: checkL3 },
  { id: "X1", title: "X1 approve endpoint", run: checkX1 },
  { id: "resident-wake", title: "Resident wake route", run: checkResidentWake },
  { id: "L2", title: "L2 event bus hooks", run: checkL2 },
  { id: "C2", title: "C2 state Q&A", run: checkC2 },
  { id: "C3", title: "C3 search-on-request gate", run: checkC3 },
  { id: "C6", title: "C6 problems", run: checkC6 },
  { id: "C9", title: "C9 session file", run: checkC9 },
  { id: "C11", title: "C11 spend gate", run: checkC11 },
  { id: "C12", title: "C12 trust tags", run: checkC12 },
  { id: "C7", title: "C7 suggestions", run: checkC7 },
  { id: "C8", title: "C8 self-heal", run: checkC8 },
  { id: "X5", title: "X5 urgency", run: checkX5 },
  { id: "P2", title: "P2 habits", run: checkP2 },
  { id: "P3", title: "P3 curiosity", run: checkP3 },
  { id: "M1", title: "M1 recall", run: checkM1 },
  { id: "M2", title: "M2 provider fallback", run: checkM2 },
  { id: "M3", title: "M3 retry classification", run: checkM3 },
  { id: "M4", title: "M4 decision log", run: checkM4 },
  { id: "M5", title: "M5 startup integrity", run: checkM5 },
  { id: "J1", title: "J1 one specialist route", run: checkJ1 },
  { id: "J2", title: "J2 durable runs", run: checkJ2 },
  { id: "J3", title: "J3 MCP initialize and tools/list", run: checkJ3 },
  { id: "J5", title: "J5 schedule", run: checkJ5 },
  { id: "J6", title: "J6 cockpit payload", run: checkJ6 },
  { id: "X2", title: "X2 workflows list", run: checkX2 },
  { id: "X4", title: "X4 memory graph", run: checkX4 },
  { id: "tts", title: "TTS eleven-flash primary", run: checkTts },
  { id: "alphabet", title: "Alphabet normalize pack", run: checkAlphabet },
  { id: "call", title: "Call reducer Phase Now barge-cancel", run: checkCall },
  { id: "phase-later", title: "Phase Later desktop always-on", run: checkPhaseLater },
  { id: "X6", title: "X6 wake word opens Phase Now", run: checkX6 },
  { id: "build", title: "Build stamp", run: checkBuild },
];

export const PROVE_ITEM_IDS = Object.freeze(CHECKS.map((check) => check.id));

export async function runProvePack({ isolate = false } = {}) {
  const restore = isolate ? beginIsolate() : null;
  const items = [];
  try {
    for (const check of CHECKS) {
      try {
        const detail = await check.run({ isolate });
        items.push({ id: check.id, title: check.title, ok: true, detail: String(detail || "ok") });
      } catch (err) {
        items.push({
          id: check.id,
          title: check.title,
          ok: false,
          detail: String(err?.message || err),
        });
      }
    }
  } finally {
    if (restore) restore();
  }
  const passed = items.filter((item) => item.ok).length;
  const total = items.length;
  return {
    ok: total > 0 && passed === total,
    build: ATLAS_BUILD,
    depth: isolate ? "isolated" : "runtime",
    passed,
    total,
    percent: total ? Math.round((passed / total) * 100) : 0,
    deferred: PROVE_DEFERRED.map((item) => ({ ...item })),
    items,
  };
}

/** Side-effect-free pack used by GET /health. */
export function runtimeProve() {
  return runProvePack({ isolate: false });
}

export function summarizeProve(report) {
  return {
    ok: report?.ok === true,
    build: report?.build || ATLAS_BUILD,
    depth: report?.depth || "runtime",
    passed: report?.passed || 0,
    total: report?.total || 0,
    percent: report?.percent || 0,
    deferred: report?.deferred || PROVE_DEFERRED.map((item) => ({ ...item })),
    items: (report?.items || []).map((item) => ({
      id: item.id,
      title: item.title,
      ok: item.ok === true,
      detail: String(item.detail || "").slice(0, 180),
    })),
  };
}
