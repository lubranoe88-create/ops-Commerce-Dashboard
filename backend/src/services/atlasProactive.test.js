import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-rail33-"));
process.env.MEMORY_DB_PATH = path.join(dir, "memory.sqlite");
process.env.BROWSER_USE_ENABLED = "false";

const suggestions = await import("./atlasSuggestions.js");
const urgency = await import("./atlasUrgency.js");
const habits = await import("./atlasHabits.js");
const curiosity = await import("./atlasCuriosity.js");
const heal = await import("./atlasSelfHeal.js");
const decisions = await import("./atlasDecisionLog.js");
const resident = await import("./atlasResident.js");
const { classifyAction } = await import("./atlasAutonomyPolicy.js");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function calm(over = {}) {
  return {
    compact: true,
    module: "map",
    generatedAt: "2026-11-02T08:00:00.000Z",
    health: { status: "ok", score: 90, openErrors: 0 },
    tops: [{ title: "Northwind", score: 0.9, rank: 1 }],
    openErrors: [],
    board: { ok: 4, error: 0, unverified: 0, total: 4 },
    updates: [],
    problems: [],
    problemCount: 0,
    news: [],
    queuedIngress: [],
    ...over,
  };
}

describe("Atlas rail-33 proactive", { concurrency: false }, () => {
  beforeEach(async () => {
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    habits.setHabitsFileForTests(path.join(dir, `habits-${stamp}.json`));
    habits.setHabitsClockForTests(() => Date.parse("2026-11-02T07:30:00.000Z"));
    curiosity.setCuriosityFileForTests(path.join(dir, `curiosity-${stamp}.json`));
    curiosity.setCuriosityClockForTests(() => Date.parse("2026-11-02T07:30:00.000Z"));
    decisions.setDecisionFileForTests(path.join(dir, `decisions-${stamp}.json`));
    heal.setSelfHealDepsForTests({
      refresh: async () => "snapshot riletto (ok)",
      listFlags: async () => [],
      clearFlag: async () => {},
    });
    await resident.residentIdle();
    resident.resetResidentForTests();
    resident.setResidentPaidCheckForTests(() => true);
    resident.setResidentIntegrityCheckForTests(async () => ({
      ok: true,
      hardFail: false,
      failures: [],
      checks: [],
    }));
    resident.setResidentCollectorForTests(async (input) => calm({ module: input?.module || "map" }));
    resident.setResidentCompleterForTests(async () => ({
      content: JSON.stringify({ summary: "Quadro calmo.", actions: [], ask: [], newsLiteracy: "" }),
      model: "resident-test",
    }));
  });

  test("C7 proposes AUTO steps on wake and news, and keeps export on ASK", async () => {
    const degraded = suggestions.proposeNextSteps({
      kind: "wake",
      bundle: calm({
        health: { status: "degraded", score: 40, openErrors: 2 },
        board: { ok: 3, error: 2, unverified: 0, total: 5 },
        problemCount: 1,
        problems: [{ kind: "pipeline", title: "orders", detail: "timeout" }],
      }),
    });
    assert.equal(degraded.held, false);
    assert.deepEqual(degraded.auto, ["status", "refresh", "controlli", "problems", "pipeline", "inspect"]);
    assert.deepEqual(degraded.ask, []);
    assert.match(degraded.text, /^Proposta\./);
    assert.match(degraded.text, /Posso «refresh»/);
    for (const id of degraded.auto) assert.equal(classifyAction(id).mode, "auto", id);

    const asked = suggestions.proposeNextSteps({
      kind: "wake",
      bundle: calm({
        problemCount: 1,
        problems: [{ kind: "function", title: "Export tops", detail: "chiede export del csv" }],
      }),
    });
    assert.ok(asked.auto.includes("problems"));
    assert.equal(asked.auto.includes("export"), false);
    assert.equal(asked.ask[0].id, "export");
    assert.equal(asked.ask[0].mode, "ask");
    assert.match(asked.text, /Chiedo conferma per «export»/);

    const held = suggestions.proposeNextSteps({
      kind: "wake",
      integrityOk: false,
      bundle: calm({ board: { error: 2 } }),
    });
    assert.equal(held.held, true);
    assert.deepEqual(held.auto, []);

    const news = suggestions.proposeNextSteps({
      kind: "ingress",
      newsItems: [{ title: "Port strike", source: "bbc-world-rss", change: "updated" }],
      bundle: calm(),
    });
    assert.deepEqual(news.auto, ["news"]);
    const wakeNews = suggestions.proposeNextSteps({
      kind: "wake",
      bundle: calm({ news: [{ title: "Port strike", source: "bbc-world-rss" }] }),
    });
    assert.equal(wakeNews.auto.includes("news"), false);

    resident.setResidentCollectorForTests(async (input) =>
      calm({
        module: input?.module || "map",
        board: { ok: 3, error: 1, unverified: 0, total: 4 },
        problemCount: 1,
        problems: [{ kind: "function", title: "browser-use", detail: "off" }],
        news: [{ title: "Markets open", source: "bbc-world-rss", summary: "shares" }],
      }),
    );
    resident.setResidentCompleterForTests(async () => ({
      content: JSON.stringify({
        summary: "Tutto calmo sul modulo.",
        actions: ["zoom-in"],
        ask: ["delete"],
        newsLiteracy: "",
      }),
      model: "resident-test",
    }));
    const wake = await resident.wakeResident({ module: "pipeline" });
    assert.deepEqual(wake.actions, ["zoom-in"]);
    assert.equal(wake.actions.includes("news"), false);
    assert.equal(wake.actions.includes("refresh"), false);
    assert.ok(wake.suggestions.auto.includes("refresh"));
    assert.ok(wake.suggestions.auto.includes("controlli"));
    assert.ok(wake.suggestions.auto.includes("problems"));
    assert.equal(wake.suggestions.auto.includes("news"), false);
    assert.equal(wake.suggestions.auto.includes("browser-use"), false);
    assert.equal(wake.suggestions.auto.includes("delete"), false);
    assert.equal(wake.suggestions.held, false);
    assert.match(wake.suggestions.text, /Proposta/);
    assert.equal(wake.summary.includes("Proposta"), false);
    assert.ok(wake.ask.some((step) => step.id === "delete" && step.mode === "ask"));
  });

  test("C8 repairs transient flags, re-runs checks, and escalates destructive work", async () => {
    const cleared = [];
    const calls = { refresh: 0, rerun: 0 };
    const healthy = await heal.attemptSelfHeal({
      integrity: { ok: true, failures: [] },
      bundle: calm(),
      deps: {
        refresh: async () => "skip",
        rerunChecks: async () => ({ ok: true, failures: [] }),
        listFlags: async () => [],
        clearFlag: async () => {},
      },
    });
    assert.equal(healthy, null);

    const report = await heal.attemptSelfHeal({
      integrity: {
        ok: false,
        hardFail: true,
        failures: [{ id: "sandbox-path", detail: "chiede wipe della sandbox" }],
      },
      bundle: calm({ board: { ok: 1, error: 1, unverified: 0, total: 2 } }),
      deps: {
        refresh: async () => {
          calls.refresh += 1;
          return "snapshot riletto (ok)";
        },
        rerunChecks: async () => {
          calls.rerun += 1;
          return {
            ok: false,
            failures: [{ id: "sandbox-path", detail: "chiede wipe della sandbox" }],
          };
        },
        listFlags: async () => [
          { functionId: "ux-refresh", errorType: "TRANSIENT", detail: "timeout temporaneo" },
          { functionId: "openrouter-key", errorType: "NO_OPENROUTER", detail: "chiave assente" },
          { functionId: "wipe-board", errorType: "WIPE", detail: "wipe the cache" },
        ],
        clearFlag: async (id) => {
          cleared.push(id);
        },
      },
    });
    assert.equal(calls.refresh, 1);
    assert.equal(calls.rerun, 1);
    assert.equal(report.recovered, false);
    assert.deepEqual(cleared, ["ux-refresh"]);
    assert.deepEqual(report.cleared, ["ux-refresh"]);
    assert.ok(report.executed.includes("refresh"));
    assert.ok(report.executed.includes("controlli"));
    assert.ok(report.executed.includes("transient-flags"));
    assert.equal(report.executed.includes("wipe"), false);
    assert.equal(report.executed.includes("wipe-board"), false);
    assert.ok(report.ask.some((step) => step.id === "wipe-board" && step.mode === "ask"));
    assert.ok(report.ask.some((step) => step.id === "sandbox-path" && step.mode === "ask"));
    const logged = decisions.listDecisions({ limit: 3 });
    assert.equal(logged[0].source, "heal");
    assert.ok(logged[0].choices.some((choice) => choice.action === "transient-flags" && choice.mode === "auto"));
    assert.ok(logged[0].choices.some((choice) => choice.action === "wipe-board" && choice.mode === "ask"));
    assert.match(logged[0].choices.find((choice) => choice.action === "refresh").because, /snapshot/);
    assert.match(decisions.decisionSnippet(), /Decisioni · heal:/);

    let passes = 0;
    resident.setResidentIntegrityCheckForTests(async () => {
      passes += 1;
      if (passes === 1) {
        return {
          ok: false,
          hardFail: true,
          failures: [{ id: "updates-readable", detail: "timeout temporaneo" }],
        };
      }
      return { ok: true, hardFail: false, failures: [], checks: [] };
    });
    let models = 0;
    resident.setResidentCompleterForTests(async () => {
      models += 1;
      return {
        content: JSON.stringify({ summary: "Di nuovo intero.", actions: ["status"], ask: [], newsLiteracy: "" }),
        model: "resident-test",
      };
    });
    const recovered = await resident.wakeResident({ module: "map" });
    assert.equal(models, 1);
    assert.equal(recovered.heal.recovered, true);
    assert.equal(recovered.fallback, null);
    assert.equal(recovered.integrity.wakeGated, false);
    assert.deepEqual(recovered.actions, ["status"]);
    assert.match(recovered.decisionLine, /Decisioni · heal:/);
    assert.ok(decisions.readDecisionLog().entries.some((entry) => entry.source === "heal"));

    resident.resetResidentForTests();
    resident.setResidentPaidCheckForTests(() => true);
    resident.setResidentCollectorForTests(async (input) => calm({ module: input?.module || "map" }));
    resident.setResidentIntegrityCheckForTests(async () => ({
      ok: false,
      hardFail: true,
      at: "2026-11-02T00:00:00.000Z",
      failures: [{ id: "sandbox-path", detail: "sandbox assente" }],
    }));
    models = 0;
    resident.setResidentCompleterForTests(async () => {
      models += 1;
      return {
        content: JSON.stringify({ summary: "non devo partire", actions: ["zoom-in"], ask: [], newsLiteracy: "" }),
        model: "should-not-run",
      };
    });
    const gated = await resident.wakeResident({ module: "map" });
    assert.equal(models, 0);
    assert.equal(gated.fallback, "integrity");
    assert.equal(gated.integrity.wakeGated, true);
    assert.deepEqual(gated.actions, []);
    assert.deepEqual(gated.ask, []);
    assert.equal(gated.suggestions.held, true);
    assert.equal(gated.heal.recovered, false);
    assert.ok(gated.heal.executed.includes("refresh"));
    assert.match(gated.summary, /Integrità di avvio non superata/);
    assert.match(gated.decisionLine, /Decisioni · heal:/);
  });

  test("X5 speaks only above the threshold and stays quiet otherwise", async () => {
    const routine = urgency.classifyUrgency({
      kind: "ingress",
      batch: [{ kind: "updates", update: { title: "Nota di servizio", detail: "nessun guasto" } }],
    });
    assert.ok(routine.score < urgency.URGENCY_THRESHOLD);
    assert.equal(routine.quiet, true);
    assert.equal(routine.interrupt, false);

    const headline = urgency.classifyUrgency({
      kind: "ingress",
      batch: [{ kind: "news", items: [{ title: "Port strike", change: "updated" }] }],
    });
    assert.equal(headline.quiet, true);

    const integrity = urgency.classifyUrgency({
      kind: "ingress",
      batch: [{ kind: "updates", update: { title: "Integrità avvio", detail: "sandbox assente" } }],
    });
    assert.ok(integrity.score >= urgency.URGENCY_THRESHOLD);
    assert.equal(integrity.interrupt, true);
    assert.equal(integrity.quiet, false);

    const severe = urgency.classifyUrgency({
      kind: "ingress",
      batch: [{ kind: "problems", problems: [{ severity: "high", title: "browser-use", kind: "function" }] }],
    });
    assert.equal(severe.interrupt, true);
    assert.ok(severe.score >= 80);

    const opened = urgency.classifyUrgency({
      kind: "wake",
      bundle: calm(),
      integrity: { ok: true },
    });
    assert.equal(opened.interrupt, true);
    assert.equal(opened.quiet, false);

    const wake = await resident.wakeResident({ module: "map" });
    assert.equal(wake.urgency.interrupt, true);
    assert.equal(wake.urgency.quiet, false);
    resident.setResidentCompleterForTests(async ({ prompt }) => ({
      content: JSON.stringify({ summary: prompt, actions: [], ask: [], newsLiteracy: "" }),
      model: "resident-test",
    }));
    let body = "";
    resident.subscribeResidentStream(
      { setTimeout() {}, on() {} },
      {
        write(chunk) {
          body += chunk;
          return true;
        },
        on() {},
        setTimeout() {},
        writeHead() {},
      },
      { after: wake.seq },
    );
    const bridge = await import("./agentqBridge.js");
    const updatesPath = path.join(dir, `updates-${Date.now()}.json`);
    bridge.setUpdatesPathForTests(updatesPath);
    fs.writeFileSync(updatesPath, "[]\n");
    bridge.appendEntryUpdate({ title: "Nota di servizio", detail: "nessun guasto" });
    await resident.residentIdle();
    bridge.appendEntryUpdate({ title: "Integrità avvio", detail: "sandbox assente" });
    await resident.residentIdle();
    const rows = [...body.matchAll(/^data: (\{.*\})$/gm)].map((match) => JSON.parse(match[1]));
    const quiet = rows.find((row) => /Nota di servizio/.test(row.summary));
    const loud = rows.find((row) => /Integrità avvio/.test(row.summary));
    assert.equal(quiet.urgency.quiet, true);
    assert.equal(loud.urgency.quiet, false);
    assert.equal(loud.urgency.interrupt, true);

    const ui = read("public/js/agentqUi.js");
    assert.match(ui, /urgency\?\.quiet === true/);
    assert.equal(ui, read("backend/public/js/agentqUi.js"));
  });

  test("P2 prepares the morning module and does not run an ASK habit", async () => {
    assert.equal(habits.bucketFor("2026-11-02T03:30:00.000Z"), "night");
    assert.equal(habits.bucketFor("2026-11-02T04:30:00.000Z"), "morning");
    assert.equal(habits.bucketFor("2026-11-02T10:30:00.000Z"), "morning");
    assert.equal(habits.bucketFor("2026-11-02T11:00:00.000Z"), "afternoon");

    habits.noteHabit({ module: "pipeline" });
    habits.noteHabit({ module: "pipeline" });
    habits.noteHabit({ module: "memory" });
    const morning = habits.preferredFocus({ prepare: true });
    assert.equal(morning.bucket, "morning");
    assert.equal(morning.module, "pipeline");
    assert.equal(morning.moduleCount, 2);
    assert.equal(morning.mode, "auto");
    assert.equal(morning.apply, true);
    assert.match(morning.because, /mattina/);
    assert.match(morning.because, /pipeline/);

    habits.setHabitsClockForTests(() => Date.parse("2026-11-02T15:00:00.000Z"));
    habits.noteHabit({ module: "chat" });
    habits.noteHabit({ module: "chat" });
    const afternoon = habits.preferredFocus({ prepare: true });
    assert.equal(afternoon.bucket, "afternoon");
    assert.equal(afternoon.module, "chat");
    assert.equal(habits.preferredFocus({ at: "2026-11-02T07:30:00.000Z", prepare: true }).module, "pipeline");

    habits.setHabitsFileForTests(path.join(dir, `habits-ask-${Date.now()}.json`));
    habits.setHabitsClockForTests(() => Date.parse("2026-11-02T07:30:00.000Z"));
    habits.noteHabit({ module: "pipeline", command: "export" });
    const asked = habits.preferredFocus({ prepare: true });
    assert.equal(asked.command, "export");
    assert.equal(asked.commandMode, "ask");
    assert.deepEqual(asked.prepare, ["pipeline"]);
    assert.equal(asked.apply, true);

    habits.noteHabit({ module: "password" });
    habits.noteHabit({ module: "password" });
    habits.noteHabit({ module: "password" });
    const locked = habits.preferredFocus({ prepare: true });
    assert.equal(locked.module, "password");
    assert.equal(locked.mode, "ask");
    assert.equal(locked.apply, false);
    assert.deepEqual(locked.prepare, []);

    habits.setHabitsFileForTests(path.join(dir, `habits-wake-${Date.now()}.json`));
    habits.noteHabit({ module: "pipeline" });
    habits.noteHabit({ module: "pipeline" });
    const wake = await resident.wakeResident({ module: "map", prepareHabits: true });
    assert.equal(wake.focus.apply, true);
    assert.equal(wake.focus.module, "pipeline");
    assert.equal(wake.focus.mode, "auto");
    assert.equal(wake.state.module, "pipeline");
    assert.equal(wake.actions.includes("export"), false);
    assert.equal(wake.actions.includes("password"), false);

    const ui = read("public/js/agentqUi.js");
    assert.match(ui, /prepareHabits: true/);
    assert.match(ui, /focus\?\.apply/);
    assert.match(read("backend/src/routes/ai.js"), /prepareHabits/);
  });

  test("P3 offers one observation and then waits out the cooldown", () => {
    const bundle = calm({
      board: { ok: 3, error: 1, unverified: 0, total: 4 },
      news: [{ title: "Markets open", source: "bbc-world-rss", summary: "shares" }],
    });
    const steps = suggestions.proposeNextSteps({ kind: "wake", bundle });
    const at = Date.parse("2026-11-02T08:00:00.000Z");
    const first = curiosity.offerCuriosity({ bundle, at });
    assert.match(first.text, /^Atlas\. Osservo/);
    assert.equal(/Proposta|Posso «/.test(first.text), false);
    assert.match(first.text, /anomalia|quadro funzioni/);
    assert.notEqual(first.text, steps.text);
    assert.match(steps.text, /Proposta/);
    assert.equal(curiosity.offerCuriosity({ bundle, at: at + 1000 }), null);
    const later = curiosity.offerCuriosity({
      bundle,
      at: at + curiosity.CURIOSITY_COOLDOWN_MS + 5,
    });
    assert.match(later.text, /Osservo/);

    curiosity.setCuriosityFileForTests(path.join(dir, `curiosity-news-${Date.now()}.json`));
    const newsOnly = calm({
      news: [{ title: "Port strike", source: "bbc-world-rss", summary: "ships wait" }],
    });
    const observed = curiosity.offerCuriosity({ bundle: newsOnly, at });
    assert.match(observed.text, /Port strike/);
    assert.equal(/Proposta|Posso «/.test(observed.text), false);
    assert.equal(observed.kind, "news");
  });

  test("rail-33-proactive is stamped and the public mirrors match", () => {
    assert.match(read("public/js/app.js"), /const BUILD_ID = "rail-33-proactive"/);
    assert.match(read("backend/src/server.js"), /build:\s*"rail-33-proactive"/);
    assert.match(read("public/index.html"), /src="\/js\/app\.js\?v=rail-33-proactive"/);
    assert.match(read("public/index.html"), /href="\/css\/app\.css\?v=rail-33-proactive"/);
    assert.match(read("backend/src/server.js"), /runStartupIntegrity\(\{\s*reason:\s*"boot"\s*\}\)/);
    assert.match(read("backend/src/server.js"), /attemptSelfHeal\(/);
    assert.equal(read("public/js/app.js"), read("backend/public/js/app.js"));
    assert.equal(read("public/js/agentqUi.js"), read("backend/public/js/agentqUi.js"));
    assert.equal(read("public/index.html"), read("backend/public/index.html"));
    assert.match(read("public/js/app.js"), /case "status"/);
    assert.match(read("public/js/app.js"), /case "problems"/);
    assert.match(read("public/js/agentqUi.js"), /suggestions/);
    assert.match(read("public/js/agentqUi.js"), /curiosity/);
    const service = read("backend/src/services/atlasResident.js");
    assert.equal(service.includes("setInterval("), false);
    assert.equal(/\bsetTimeout\s*\(/.test(service), false);
  });
});
