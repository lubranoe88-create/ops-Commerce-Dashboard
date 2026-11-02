import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-capabilities-"));
process.env.MEMORY_DB_PATH = path.join(dir, "memory.sqlite");
process.env.BROWSER_USE_ENABLED = "false";

const { answerFromBundle, answerPlanciaState, isPlanciaStateQuestion } = await import("./atlasStateAnswer.js");
const {
  isExplicitSearchRequest,
  refusesImplicitSearch,
  searchRefusal,
  stripUnrequestedReads,
  userAskedForMemory,
} = await import("./atlasSearchGate.js");
const { collectAutoFixes, proposeResolutions } = await import("./atlasProblemResolve.js");
const { assessSpendStatus, formatBandLine } = await import("./atlasSpend.js");
const { trustLineForResult, trustLineFromTagged } = await import("./atlasTrust.js");
const session = await import("./atlasSessionStore.js");
const bridge = await import("./agentqBridge.js");
const resident = await import("./atlasResident.js");
const ui = await import("../../../public/js/agentqUi.js");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const facts = {
  module: "pipeline",
  health: { status: "degraded", score: 61, openErrors: 2 },
  board: { ok: 12, error: 1, unverified: 3, total: 16 },
  tops: [{ title: "Northwind", rank: 1, score: 0.91 }],
  pins: [{ title: "Markets open" }],
  problemCount: 4,
  updates: [{ title: "Seed" }],
  updateCount: 1,
};

describe("Atlas rail-31 capabilities", { concurrency: false }, () => {
  beforeEach(() => {
    const sessionFile = path.join(dir, `session-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
    const memoryFile = path.join(dir, "expandable.json");
    session.setSessionFileForTests(sessionFile, { mirror: true });
    bridge.setMemoryExpandPathForTests(memoryFile);
  });

  test("C2 answers only from the snapshot facts", () => {
    assert.equal(isPlanciaStateQuestion("come sta la plancia?"), true);
    assert.equal(isPlanciaStateQuestion("qual è il modulo aperto?"), true);
    assert.equal(isPlanciaStateQuestion("quanti problemi aperti?"), true);
    assert.equal(isPlanciaStateQuestion("quali sono i top?"), true);
    assert.equal(isPlanciaStateQuestion("quanti pin ci sono?"), true);
    assert.equal(isPlanciaStateQuestion("salute del quadro funzioni"), true);
    assert.equal(isPlanciaStateQuestion("zoom out"), false);
    assert.equal(isPlanciaStateQuestion("apri pipeline"), false);
    assert.equal(isPlanciaStateQuestion("vai alla memory"), false);
    assert.equal(isPlanciaStateQuestion("controlla modulo pipeline"), false);
    assert.equal(isPlanciaStateQuestion("problemi"), false);
    assert.equal(isPlanciaStateQuestion("cerca budget"), false);

    assert.equal(ui.isPlanciaStateQuestion("come sta la plancia?"), true);
    assert.equal(ui.isPlanciaStateQuestion("controlla modulo pipeline"), false);
    assert.equal(ui.isPlanciaStateQuestion("vai alla memory"), false);

    const tops = answerPlanciaState("quali sono i top?", facts);
    assert.match(tops.reply, /^Atlas\./);
    assert.match(tops.reply, /Northwind/);
    assert.equal(tops.reply.includes("Acme"), false);
    assert.equal(tops.reply.includes("Modulo aperto"), false);
    assert.equal(tops.model, null);
    assert.equal(tops.trust.mode, "auto");

    const broad = answerPlanciaState("stato plancia", facts);
    assert.match(broad.reply, /Modulo aperto: pipeline/);
    assert.match(broad.reply, /degraded \(61\)/);
    assert.match(broad.reply, /Errori aperti nello snapshot: 2/);
    assert.match(broad.reply, /1 errori/);
    assert.match(broad.reply, /Markets open/);
    assert.match(broad.reply, /Problemi aperti: 4/);
    assert.match(broad.reply, /Seed/);

    const missing = answerPlanciaState("come sta la plancia?", { module: "map" });
    assert.match(missing.reply, /n\/d/);
    assert.equal(missing.reply.includes("Northwind"), false);

    const fromBundle = answerFromBundle("stato della plancia", {
      module: "chat",
      health: { status: "ok", score: 80, openErrors: 0 },
      board: { ok: 1, error: 0, unverified: 0, total: 1 },
      tops: [],
      news: [],
      problems: [],
      problemCount: 0,
      updates: [],
    });
    assert.equal(fromBundle.source, "resident");
    assert.match(fromBundle.reply, /Modulo aperto: chat/);
    assert.match(fromBundle.reply, /Problemi aperti: 0/);
    assert.match(fromBundle.reply, /Tops: nessuno/);

    const stateSrc = read("backend/src/services/atlasStateAnswer.js");
    assert.match(stateSrc, /getDashboardSnapshot\(/);
    assert.match(stateSrc, /getAgentqProblems\(/);
    assert.match(stateSrc, /getEntryUpdates\(/);
    assert.equal(stateSrc.includes("completeChat"), false);
    const routes = read("backend/src/routes/ai.js");
    assert.match(routes, /\/agentq\/state/);
    const agent = read("backend/src/services/aiAgent.js");
    assert.match(agent, /isPlanciaStateQuestion\(message\)/);
    assert.match(agent, /answerPlanciaStateLive\(/);
    const uiSrc = read("public/js/agentqUi.js");
    assert.match(uiSrc, /\/api\/ai\/agentq\/state/);
    resident.resetResidentForTests();
    assert.equal(resident.answerResidentState("come sta la plancia?"), null);
  });

  test("C2 resident answers from the wake bundle and does not invent tops", () => {
    resident.resetResidentForTests();
    resident.setResidentAwakeForTests(true);
    const answered = resident.answerResidentState("quali sono i top?");
    assert.equal(answered.source, "resident");
    assert.equal(answered.model, null);
    assert.match(answered.reply, /Tops: nessuno/);
    assert.equal(answered.reply.includes("Northwind"), false);
  });

  test("C3 searches memory only when asked and refuses an implicit sandbox look", async () => {
    assert.equal(userAskedForMemory("come sta la plancia?"), false);
    assert.equal(userAskedForMemory("parlami del budget"), false);
    assert.equal(userAskedForMemory("cerca budget"), true);
    assert.equal(userAskedForMemory("memoria"), true);
    assert.equal(isExplicitSearchRequest("vai alla memory"), false);
    assert.equal(refusesImplicitSearch("guarda nella sandbox"), true);
    assert.equal(refusesImplicitSearch("cerca nella sandbox il budget"), false);
    assert.equal(ui.refusesImplicitSearch("guarda nella sandbox"), true);
    assert.equal(ui.isSearchRequest("parlami del budget"), false);
    assert.equal(ui.isMemoryRecall("vai alla memory"), false);
    assert.equal(ui.isMemoryRecall("cosa ricordi del budget"), true);
    assert.match(searchRefusal(), /^Atlas\./);
    assert.equal(ui.ATLAS_SEARCH_REFUSAL, searchRefusal());

    const stripped = stripUnrequestedReads(["search", "zoom-in", "memory-read"], "fammi un riassunto");
    assert.equal(stripped.refused, true);
    assert.deepEqual(stripped.actions, ["zoom-in"]);
    const asked = stripUnrequestedReads(["search"], "cerca budget");
    assert.equal(asked.refused, false);
    assert.deepEqual(asked.actions, ["search"]);

    const agent = read("backend/src/services/aiAgent.js");
    assert.match(agent, /userAskedForMemory\(message\)/);
    assert.equal(agent.includes("const crossMem = searchCrossThreadMemory(message"), false);

    bridge.appendExpandableMemory({ title: "Agent Q budget", text: "nota Q4", tags: ["voce"] });
    const listed = bridge.listExpandableMemory({ limit: 5, query: "budget" });
    assert.equal(listed.name, "Atlas");
    assert.match(listed.entries[0].title, /Atlas budget/);
    const found = await bridge.runAgentqSearch("budget", { sources: ["memory"] });
    assert.equal(found.name, "Atlas");
    assert.equal(found.searched, true);
    assert.equal(found.onDemand, true);
    assert.ok(found.hits.some((hit) => /budget/i.test(hit.title)));

    const routes = read("backend/src/routes/ai.js");
    assert.match(routes, /explicit === false/);
    assert.match(routes, /searchRefusal\(/);
  });

  test("C6 proposes steps and only executable AUTO fixes", () => {
    const resolutions = proposeResolutions([
      { id: "browser-use", kind: "function", title: "browser-use", detail: "off", severity: "high" },
      { id: "pipe-3", kind: "pipeline", title: "orders · failed", detail: "timeout sul source", severity: "high" },
      { id: "integrity-sandbox-path", kind: "integrity", title: "Integrità avvio · sandbox-path", detail: "sandbox assente", severity: "high" },
    ], { budget: { remainingEur: 2.5, minRemainingEur: 3 } });
    const browser = resolutions[0];
    assert.ok(browser.steps.length >= 3);
    assert.match(browser.steps.join(" "), /€2\.50/);
    assert.deepEqual(browser.auto, ["controlli"]);
    assert.equal(browser.ask[0].id, "browser-use");
    assert.equal(browser.ask[0].mode, "ask");
    const pipeline = resolutions[1];
    assert.deepEqual(pipeline.auto, ["pipeline", "inspect"]);
    assert.match(pipeline.steps.join(" "), /timeout sul source/);
    assert.match(resolutions[2].steps.join(" "), /sandbox assente/);
    assert.deepEqual(collectAutoFixes(resolutions), ["controlli", "pipeline", "inspect"]);
    const uiSrc = read("public/js/agentqUi.js");
    assert.match(uiSrc, /wantsResolution/);
    assert.match(uiSrc, /autoFixes/);
    assert.match(uiSrc, /Eseguo i passi AUTO/);
  });

  test("C9 restores wake summary, module, and pending ASK", () => {
    const saved = session.rememberWake({
      wakeSummary: "Atlas. Plancia sul modulo map.",
      module: "pipeline",
      pendingAsk: [{ id: "export", reason: "export" }],
    });
    assert.equal(saved.module, "pipeline");
    assert.equal(saved.pendingAsk[0].id, "export");
    const again = session.readAtlasSession();
    assert.match(again.wakeSummary, /modulo map/);
    const restored = session.restoredFrom(again, { applyModule: true });
    assert.equal(restored.applyModule, true);
    assert.equal(restored.module, "pipeline");
    assert.equal(restored.pendingAsk[0].reason, "export");

    const patched = session.patchAtlasSession({
      module: "chat",
      pendingAskDrop: "export",
      pendingAskAdd: { id: "browser-use", reason: "browser-use" },
    });
    assert.equal(patched.module, "chat");
    assert.deepEqual(patched.pendingAsk.map((item) => item.id), ["browser-use"]);
    assert.match(patched.wakeSummary, /modulo map/);

    const memory = bridge.listExpandableMemory({ limit: 10, query: "Sessione Atlas" });
    assert.ok(memory.entries.some((entry) => /Modulo preferito: chat/.test(entry.text)));
    assert.match(read("backend/src/services/atlasResident.js"), /rememberWake\(/);
    assert.match(read("backend/src/services/atlasResident.js"), /restoredFrom\(/);
    assert.match(read("public/js/agentqUi.js"), /Riprendo la sessione/);
    assert.match(read("public/js/app.js"), /restoreModule/);
  });

  test("C11 asks before crossing the soft band and states the band", () => {
    const budget = {
      capEur: 10,
      spentEur: 7.4,
      softRatio: 0.75,
      softBlocked: false,
      hardBlocked: false,
      zeroRemaining: false,
    };
    const crossing = assessSpendStatus(budget, { tier: "main", estimateEur: 0.2, confirm: false });
    assert.equal(crossing.wouldCross, true);
    assert.equal(crossing.ask, true);
    assert.equal(crossing.blocked, false);
    assert.match(crossing.line, /Chiedo conferma/);
    assert.match(formatBandLine(budget, { wouldCross: true, tier: "main" }), /€7\.40/);

    const allowed = assessSpendStatus(budget, { tier: "main", estimateEur: 0.2, confirm: true });
    assert.equal(allowed.ask, false);
    assert.equal(allowed.blocked, false);

    const past = assessSpendStatus(
      { ...budget, spentEur: 8, softBlocked: true },
      { tier: "grok", estimateEur: 0.2, confirm: true },
    );
    assert.equal(past.blocked, true);
    assert.equal(past.ask, false);
    assert.match(past.line, /già superata/);

    const under = assessSpendStatus(
      { ...budget, spentEur: 1 },
      { tier: "main", estimateEur: 0.01, confirm: false },
    );
    assert.equal(under.ask, false);
    assert.match(under.line, /Sotto soglia/);

    const agent = read("backend/src/services/aiAgent.js");
    assert.match(agent, /needSpendConfirm: true/);
    assert.match(agent, /spendGate\(tier, confirmSpend\)/);
    assert.match(agent, /withBudgetLine\(/);
    assert.match(read("public/js/app.js"), /needSpendConfirm/);
    assert.match(read("public/js/app.js"), /confirmSpend: true/);
    assert.match(read("public/js/aiAgentUi.js"), /confirmSpend/);
  });

  test("C12 tags hands and resident results as auto or ask", async () => {
    const line = trustLineFromTagged([
      { id: "zoom-in", mode: "auto" },
      { id: "export", mode: "ask" },
    ]);
    assert.equal(line, "Affidabilità · AUTO zoom-in · ASK export");
    assert.match(trustLineForResult([]), /AUTO · lettura/);

    const plan = await bridge.planHandActions("zoom in sul globo");
    assert.equal(plan.actions[0], "zoom-in");
    assert.match(plan.trustLine, /AUTO zoom-in/);
    assert.equal(plan.trust.mode, "auto");

    const uiSrc = read("public/js/agentqUi.js");
    assert.match(uiSrc, /atlasLine\(`AUTO/);
    assert.match(uiSrc, /atlasLine\(`ASK/);
    assert.match(uiSrc, /Azione non eseguita/);
    assert.match(read("public/js/app.js"), /dataset\.trust/);
    assert.match(read("public/css/app.css"), /\.atlas-trust/);
    assert.match(read("public/css/app.css"), /data-trust="ask"/);
    assert.match(read("backend/src/services/atlasResident.js"), /trustLineForResult/);
    assert.equal(read("public/js/app.js").includes('const BUILD_ID = "rail-31-capabilities"'), true);
    assert.equal(read("backend/src/server.js").includes('build: "rail-31-capabilities"'), true);
  });
});
