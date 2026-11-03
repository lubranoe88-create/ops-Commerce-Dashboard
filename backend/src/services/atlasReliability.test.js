import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-rail32-"));
process.env.OPENROUTER_API_KEY = "sk-test-atlas-reliability";
process.env.OPENROUTER_MODEL = "deepseek/deepseek-v4.1-flash";
process.env.AI_ROUTER_MODEL = "meta-llama/llama-3.2-3b-instruct";
process.env.MEMORY_DB_PATH = path.join(dir, "memory.sqlite");
process.env.BROWSER_USE_ENABLED = "false";

const recall = await import("./atlasRecall.js");
const decisions = await import("./atlasDecisionLog.js");
const reliability = await import("./atlasReliability.js");
const openrouter = await import("./openrouter.js");
const bridge = await import("./agentqBridge.js");
const resident = await import("./atlasResident.js");
const { userAskedForMemory } = await import("./atlasSearchGate.js");

const delays = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function jsonResponse(status, body, { audio = false } = {}) {
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => (audio ? bytes.buffer : new ArrayBuffer(0)),
  };
}

function bundle(moduleName = "pipeline") {
  return {
    compact: true,
    module: moduleName,
    generatedAt: "2026-11-02T00:00:00.000Z",
    health: { status: "ok", score: 80, openErrors: 0 },
    tops: [],
    openErrors: [],
    board: { ok: 1, error: 0, unverified: 0, total: 1 },
    updates: [],
    problems: [],
    problemCount: 0,
    news: [{ title: "Markets open", source: "bbc-world-rss", summary: "shares" }],
    queuedIngress: [],
  };
}

describe("Atlas rail-32 reliability", { concurrency: false }, () => {
  beforeEach(async () => {
    const stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    bridge.setMemoryExpandPathForTests(path.join(dir, `mem-${stamp}.json`));
    bridge.setUpdatesPathForTests(path.join(dir, `updates-${stamp}.json`));
    decisions.setDecisionFileForTests(path.join(dir, `decisions-${stamp}.json`));
    reliability.setReliabilityFileForTests(path.join(dir, `provider-${stamp}.json`));
    reliability.resetReliabilityForTests();
    delays.length = 0;
    reliability.setReliabilitySleeperForTests((ms) => {
      delays.push(ms);
    });
    openrouter.setOpenRouterFetchForTests(null);
    await resident.residentIdle();
    resident.resetResidentForTests();
    resident.setResidentPaidCheckForTests(() => true);
    resident.setResidentIntegrityCheckForTests(async () => ({
      ok: true,
      hardFail: false,
      failures: [],
      checks: [],
    }));
    resident.setResidentCollectorForTests(async (input) => bundle(input?.module || "pipeline"));
  });

  test("M1 ranks durable notes by keyword and recency and recalls without a search", () => {
    const now = Date.parse("2026-11-02T12:00:00.000Z");
    const older = {
      id: "old",
      at: "2026-10-01T12:00:00.000Z",
      title: "Budget",
      text: "tetto pipeline",
      tags: ["durable"],
    };
    const newer = {
      id: "new",
      at: "2026-11-02T11:00:00.000Z",
      title: "Budget",
      text: "tetto pipeline",
      tags: ["durable"],
    };
    const noise = {
      id: "noise",
      at: "2026-11-02T12:00:00.000Z",
      title: "Meteo",
      text: "pioggia sul porto",
      tags: ["durable"],
    };
    const plain = {
      id: "plain",
      at: "2026-11-02T12:00:00.000Z",
      title: "Budget",
      text: "tetto pipeline",
      tags: [],
    };
    const durable = {
      id: "durable",
      at: "2026-11-02T12:00:00.000Z",
      title: "Budget",
      text: "tetto pipeline",
      tags: ["durable"],
    };
    const session = {
      id: "session",
      at: "2026-11-02T12:00:00.000Z",
      title: "Budget",
      text: "tetto pipeline",
      tags: ["atlas-session"],
    };

    const recent = recall.rankRecall([older, newer, noise], "budget pipeline", { now, limit: 4 });
    assert.equal(recent[0].entry.id, "new");
    assert.equal(recent.some((row) => row.entry.id === "noise"), false);
    assert.ok(recent[0].score > recent.find((row) => row.entry.id === "old").score);

    const boosted = recall.rankRecall([plain, durable], "budget pipeline", { now, limit: 2 });
    assert.equal(boosted[0].entry.id, "durable");
    assert.equal(recall.rankRecall([session], "budget pipeline", { now }).length, 0);

    const saved = recall.rememberDurableNote({
      title: "Budget pipeline",
      text: "Il tetto della pipeline resta 10 euro.",
      tags: ["ops"],
    });
    assert.ok(saved.entry.tags.includes("durable"));
    bridge.appendExpandableMemory({ title: "Meteo", text: "pioggia sul porto", tags: ["meteo"] });
    bridge.upsertTaggedMemory({
      tag: "atlas-session",
      title: "Sessione Atlas",
      text: "pipeline budget da non richiamare in automatico",
    });

    assert.equal(userAskedForMemory("dimmi della pipeline"), false);
    const found = recall.recallForContext("dimmi della pipeline");
    assert.equal(found.automatic, true);
    assert.equal(found.searched, false);
    assert.equal(found.onDemand, false);
    assert.equal(found.facts[0].title, "Budget pipeline");
    assert.equal(found.facts.some((fact) => /Sessione|Meteo/.test(fact.title)), false);
    assert.match(found.line, /^Ricordo · Budget pipeline/);
    assert.match(found.block, /FATTI RICHIAMATI AUTOMATICAMENTE/);

    const injected = recall.injectAutomaticRecall("dimmi della pipeline", "pipeline");
    assert.equal(injected.injected, true);
    assert.equal(injected.prompt.includes(recall.RECALL_MARKER), true);
    const again = recall.injectAutomaticRecall(injected.prompt, "pipeline");
    assert.equal(again.injected, false);
    assert.equal(again.prompt.split(recall.RECALL_MARKER).length, 2);

    const agent = read("backend/src/services/aiAgent.js");
    assert.match(agent, /automatic_recall/);
    assert.match(agent, /injectAutomaticRecall\(prompt, recallQuery/);
    assert.match(agent, /recallQueryFromTurn/);
    assert.match(agent, /userAskedForMemory\(message\)/);
    assert.equal(agent.includes("const crossMem = searchCrossThreadMemory(message"), false);
    assert.match(read("backend/src/routes/chat.js"), /injectAutomaticRecall/);
    assert.match(read("backend/src/routes/dashboard.js"), /injectAutomaticRecall/);
    assert.equal(read("backend/src/services/atlasRecall.js").includes("runAgentqSearch"), false);
  });

  test("M1 wake injects recalled facts without the operator asking", async () => {
    recall.rememberDurableNote({
      title: "Budget pipeline",
      text: "Il tetto della pipeline resta 10 euro.",
    });
    bridge.appendExpandableMemory({ title: "Meteo", text: "pioggia sul porto", tags: ["meteo"] });
    let captured = "";
    resident.setResidentCompleterForTests(async ({ prompt, system }) => {
      captured = prompt;
      assert.match(system, /recalled:/);
      return {
        content: JSON.stringify({
          summary: "Quadro pipeline stabile.",
          actions: ["status"],
          ask: [],
          newsLiteracy: "",
        }),
        model: "resident-test",
      };
    });
    const wake = await resident.wakeResident({ module: "pipeline" });
    const payload = JSON.parse(captured);
    assert.equal(payload.kind, "wake");
    assert.equal(payload.recalled[0].title, "Budget pipeline");
    assert.equal(payload.recalled.some((fact) => /Meteo/.test(fact.title)), false);
    assert.equal(payload.recallNote, recall.RECALL_MARKER);
    assert.match(wake.recallLine, /Budget pipeline/);
    assert.match(wake.decisionLine, /Decisioni · wake: status AUTO \(status\)/);
    assert.match(wake.decisionLine, /non eseguo il passo news/);
    assert.equal(wake.actions.includes("news"), false);
    assert.match(resident.residentStatus().decisions.snippet, /Decisioni/);
  });

  test("M3 classifies fatal and retryable failures and backs off", async () => {
    assert.equal(reliability.classifyProviderFailure({ status: 503 }).retryable, true);
    assert.equal(reliability.classifyProviderFailure({ status: 429 }).retryable, true);
    assert.equal(reliability.classifyProviderFailure({ status: 401 }).fatal, true);
    assert.equal(reliability.classifyProviderFailure({ status: 400 }).retryable, false);
    assert.equal(reliability.classifyProviderFailure({ code: "NO_OPENROUTER" }).fatal, true);
    assert.equal(
      reliability.classifyProviderFailure(Object.assign(new TypeError("fetch failed"), { name: "TypeError" })).retryable,
      true,
    );
    assert.equal(
      reliability.classifyProviderFailure(Object.assign(new Error("aborted"), { name: "TimeoutError" })).reason,
      "transient",
    );

    let calls = 0;
    openrouter.setOpenRouterFetchForTests(async (_url, init) => {
      calls += 1;
      const model = JSON.parse(init.body).model;
      if (calls === 1) return jsonResponse(503, { error: { message: "busy" } });
      return jsonResponse(200, {
        model,
        choices: [{ message: { content: "ripreso" } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      });
    });
    const recovered = await openrouter.completeChat({ prompt: "stato plancia" });
    assert.match(recovered.content, /ripreso/);
    assert.equal(recovered.fallback, null);
    assert.deepEqual(delays, [80]);
    assert.equal(calls, 2);
    const logged = reliability.recentProviderOutcomes({ limit: 6 });
    assert.ok(logged.some((row) => row.retryable && row.reason === "http_503"));
    assert.ok(logged.some((row) => row.ok && row.reason === "ok"));

    calls = 0;
    delays.length = 0;
    openrouter.setOpenRouterFetchForTests(async () => {
      calls += 1;
      return jsonResponse(400, { error: { message: "bad request" } });
    });
    const fatal = await openrouter.completeChat({ prompt: "stato" });
    assert.equal(fatal.fallback, "mechanical");
    assert.match(fatal.content, /^Atlas\./);
    assert.equal(delays.length, 0);
    assert.equal(calls, 2);
    assert.ok(
      reliability.recentProviderOutcomes({ limit: 6 }).some((row) => row.fatal && row.reason === "http_400"),
    );
  });

  test("M2 falls back to an alternate model and X3 opens the circuit", async () => {
    const seen = [];
    openrouter.setOpenRouterFetchForTests(async (_url, init) => {
      const model = JSON.parse(init.body).model;
      seen.push(model);
      if (model === "deepseek/deepseek-v4.1-flash") {
        return jsonResponse(503, { error: { message: "primary down" } });
      }
      return jsonResponse(200, {
        model,
        choices: [{ message: { content: "da modello alternativo" } }],
      });
    });
    const alt = await openrouter.completeChat({ prompt: "ciao" });
    assert.match(alt.content, /alternativo/);
    assert.equal(alt.fallback, "model");
    assert.equal(seen[0], "deepseek/deepseek-v4.1-flash");
    assert.equal(seen.at(-1), "meta-llama/llama-3.2-3b-instruct");
    assert.equal(reliability.isCircuitOpen("openrouter"), false);

    reliability.resetReliabilityForTests();
    delays.length = 0;
    reliability.setReliabilitySleeperForTests((ms) => delays.push(ms));
    let now = Date.UTC(2026, 10, 2);
    reliability.setReliabilityClockForTests(() => now);
    let fetches = 0;
    openrouter.setOpenRouterFetchForTests(async () => {
      fetches += 1;
      return jsonResponse(401, { error: { message: "unauthorized" } });
    });
    for (let i = 0; i < reliability.FAILURES_TO_OPEN; i += 1) {
      const failed = await openrouter.completeChat({ prompt: "ciao" });
      assert.equal(failed.fallback, i === reliability.FAILURES_TO_OPEN - 1 ? "circuit" : "mechanical");
    }
    assert.equal(reliability.isCircuitOpen("openrouter"), true);
    const before = fetches;
    const skipped = await openrouter.completeChat({ prompt: "ancora" });
    assert.equal(fetches, before);
    assert.equal(skipped.fallback, "circuit");
    assert.match(skipped.content, /Risposta meccanica/);

    now += reliability.COOLDOWN_MS;
    assert.equal(reliability.isCircuitOpen("openrouter"), false);
    openrouter.setOpenRouterFetchForTests(async (_url, init) => {
      fetches += 1;
      const model = JSON.parse(init.body).model;
      return jsonResponse(200, { model, choices: [{ message: { content: "di nuovo online" } }] });
    });
    const trial = await openrouter.completeChat({ prompt: "prova" });
    assert.match(trial.content, /online/);
    assert.equal(reliability.isCircuitOpen("openrouter"), false);

    reliability.noteProviderFailure("tts");
    reliability.noteProviderFailure("tts");
    reliability.noteProviderFailure("tts");
    let ttsCalls = 0;
    openrouter.setOpenRouterFetchForTests(async () => {
      ttsCalls += 1;
      return jsonResponse(200, {}, { audio: true });
    });
    const muted = await openrouter.synthesizeSpeech({ text: "ciao atlas" });
    assert.equal(ttsCalls, 0);
    assert.equal(muted.fallback, "circuit");
    assert.equal(muted.buffer, null);
    assert.match(muted.reply, /^Atlas\./);

    const saved = reliability.providerStatus();
    assert.equal(saved.circuits.find((row) => row.provider === "tts").state, "open");
    reliability.reloadReliabilityFromDisk();
    assert.equal(reliability.isCircuitOpen("tts"), true);
  });

  test("M2 TTS and STT retry then return a mechanical reply instead of hanging", async () => {
    let ttsCalls = 0;
    openrouter.setOpenRouterFetchForTests(async (url) => {
      ttsCalls += 1;
      if (String(url).includes("/audio/speech") && ttsCalls === 1) {
        return jsonResponse(503, { error: { message: "tts busy" } });
      }
      return jsonResponse(200, {}, { audio: true });
    });
    const spoken = await openrouter.synthesizeSpeech({ text: "buongiorno" });
    assert.ok(spoken.buffer.length > 0);
    assert.equal(spoken.fallback, null);
    assert.deepEqual(delays, [40]);

    reliability.resetReliabilityForTests();
    delays.length = 0;
    reliability.setReliabilitySleeperForTests((ms) => delays.push(ms));
    openrouter.setOpenRouterFetchForTests(async () => jsonResponse(503, { error: { message: "down" } }));
    const silent = await openrouter.synthesizeSpeech({ text: "buongiorno" });
    assert.equal(silent.buffer, null);
    assert.equal(silent.fallback, "mechanical");
    assert.match(silent.reply, /Voce esterna non disponibile/);

    const heardFail = await openrouter.transcribeAudio({
      buffer: Buffer.alloc(32, 7),
      mimeType: "audio/wav",
      filename: "mic.wav",
    });
    assert.equal(heardFail.text, "");
    assert.equal(heardFail.fallback, "mechanical");
    assert.match(heardFail.reply, /Ripeti la frase/);

    let sttCalls = 0;
    openrouter.setOpenRouterFetchForTests(async () => {
      sttCalls += 1;
      return jsonResponse(200, { text: "apri la mappa", model: "openai/whisper-1" });
    });
    const heard = await openrouter.transcribeAudio({
      buffer: Buffer.alloc(32, 7),
      mimeType: "audio/wav",
      filename: "mic.wav",
    });
    assert.equal(heard.text, "apri la mappa");
    assert.equal(heard.fallback, null);
    assert.ok(sttCalls >= 1);
  });

  test("M4 records why wake, hands, and news were chosen and exposes the snippet", async () => {
    const plan = await bridge.planHandActions("zoom in sul globo");
    assert.equal(plan.actions[0], "zoom-in");
    const hands = decisions.listDecisions({ limit: 3 });
    assert.equal(hands[0].source, "hands");
    assert.equal(hands[0].choices[0].action, "zoom-in");
    assert.equal(hands[0].choices[0].mode, "auto");
    assert.match(hands[0].choices[0].because, /Piano locale/);
    assert.match(decisions.decisionSnippet(), /Decisioni · hands: zoom-in AUTO \(zoom\)/);

    recall.rememberDurableNote({ title: "Budget pipeline", text: "tetto 10 euro" });
    resident.setResidentCompleterForTests(async () => ({
      content: JSON.stringify({ summary: "ok", actions: ["status"], ask: [], newsLiteracy: "" }),
      model: "resident-test",
    }));
    const wake = await resident.wakeResident({ module: "pipeline" });
    assert.match(wake.decisionLine, /wake:/);
    assert.match(wake.decisionLine, /news:/);
    const again = decisions.readDecisionLog();
    assert.ok(again.entries.some((entry) => entry.source === "news"));
    assert.ok(again.entries.some((entry) => entry.source === "hands"));
    const updates = bridge.getEntryUpdates({ limit: 5 });
    assert.match(updates.decisionSnippet, /Decisioni/);
    const status = await bridge.agentqStatus();
    assert.equal(status.memory.recall, "automatic");
    assert.equal(status.memory.search, "on-demand");
    assert.match(status.decisions.snippet, /Decisioni/);
    assert.equal(status.providers.failuresToOpen, reliability.FAILURES_TO_OPEN);

    const ui = read("public/js/agentqUi.js");
    assert.equal(ui, read("backend/public/js/agentqUi.js"));
    assert.match(ui, /recallLine/);
    assert.match(ui, /decisionLine/);
    assert.match(ui, /decisionSnippet/);
    assert.match(read("public/js/app.js"), /const BUILD_ID = "rail-37-atlas-voice"/);
    assert.match(read("backend/src/server.js"), /build:\s*"rail-37-atlas-voice"/);
    assert.equal(read("public/js/app.js"), read("backend/public/js/app.js"));
    assert.equal(read("public/index.html"), read("backend/public/index.html"));
  });

  test("X3 open circuit returns the wake without waiting on the provider", async () => {
    let fetches = 0;
    openrouter.setOpenRouterFetchForTests(() => {
      fetches += 1;
      return new Promise(() => {});
    });
    reliability.noteProviderFailure("openrouter");
    reliability.noteProviderFailure("openrouter");
    reliability.noteProviderFailure("openrouter");
    assert.equal(reliability.isCircuitOpen("openrouter"), true);
    const wake = await Promise.race([
      resident.wakeResident({ module: "map" }),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("wake hung")), 2000);
      }),
    ]);
    assert.equal(fetches, 0);
    assert.equal(wake.fallback, "circuit");
    assert.match(wake.summary, /^Atlas\./);
    assert.match(wake.summary, /Risposta meccanica/);
    assert.equal(wake.actions.length, 0);
  });
});
