import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-resident-"));
const updatesPath = path.join(dir, "updates.json");
process.env.MEMORY_DB_PATH = path.join(dir, "memory.sqlite");
process.env.BROWSER_USE_ENABLED = "false";

const resident = await import("./atlasResident.js");
const bridge = await import("./agentqBridge.js");
const aiStore = await import("../memory/aiStore.js");
const { aiRouter } = await import("../routes/ai.js");
const { initDashboardStore } = await import("../memory/store.js");
const express = (await import("express")).default;

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function fixture(over = {}) {
  return {
    compact: true,
    module: "map",
    generatedAt: "2026-11-02T00:00:00.000Z",
    health: { status: "ok", score: 88, openErrors: 0 },
    pipelineHealth: 88,
    tops: [{ title: "Northwind", score: 0.9, rank: 1 }],
    openErrors: [],
    board: { ok: 10, error: 1, unverified: 0, total: 11 },
    updates: [{ at: "2026-11-02T00:00:00.000Z", title: "Seed", detail: "dettaglio" }],
    problems: [{ severity: "high", title: "browser-use", detail: "off", kind: "function" }],
    problemCount: 1,
    news: [{ title: "Markets open", source: "bbc-world-rss", summary: "shares" }],
    queuedIngress: [],
    ...over,
  };
}

describe("Atlas resident, L1 wake, L2 ingress", { concurrency: false }, () => {
  beforeEach(async () => {
    await resident.residentIdle();
    resident.resetResidentForTests();
    bridge.setUpdatesPathForTests(updatesPath);
    fs.writeFileSync(updatesPath, "[]\n");
    resident.setResidentCompleterForTests(async () => ({
      content: JSON.stringify({
        summary: "Stato plancia stabile.",
        actions: [],
        ask: [],
        newsLiteracy: "",
      }),
      model: "test-model",
    }));
    resident.setResidentCollectorForTests(async (input) => fixture({ module: input?.module || "map" }));
    resident.setResidentNewsLoaderForTests(async () => []);
  });

  test("wake is one Atlas request and gates AUTO versus ASK", async () => {
    let prompts = [];
    resident.setResidentCompleterForTests(async ({ system, prompt }) => {
      prompts.push({ system, prompt });
      return {
        content: JSON.stringify({
          summary: "Tutto calmo sul modulo.",
          actions: ["zoom-in", "mic", "delete"],
          ask: ["export"],
          newsLiteracy: "Fonte bbc, non è un fatto della plancia.",
        }),
        model: "resident-test",
      };
    });
    const wake = await resident.wakeResident({ module: "pipeline" });
    assert.equal(prompts.length, 1);
    assert.match(prompts[0].system, /You are Atlas/);
    assert.match(prompts[0].system, /stay recognizably Atlas/);
    assert.match(prompts[0].system, /newsLiteracy/);
    const payload = JSON.parse(prompts[0].prompt);
    assert.equal(payload.kind, "wake");
    assert.equal(payload.bundle.module, "pipeline");
    assert.equal(payload.bundle.news[0].title, "Markets open");
    assert.equal(wake.ok, true);
    assert.equal(wake.resident, true);
    assert.equal(wake.shot, "once");
    assert.equal(wake.kind, "wake");
    assert.match(wake.summary, /^Atlas\./);
    assert.equal(wake.model, "resident-test");
    assert.deepEqual(wake.actions, ["zoom-in"]);
    assert.equal(wake.actions.includes("mic"), false);
    assert.equal(wake.actions.includes("delete"), false);
    assert.ok(wake.ask.some((step) => step.id === "delete" && step.mode === "ask"));
    assert.ok(wake.ask.some((step) => step.id === "export" && step.mode === "ask"));
    assert.match(wake.newsLiteracy, /non sono fatti verificati/);
    assert.match(wake.newsLiteracy, /bbc-world-rss/);
    assert.match(wake.newsLiteracy, /Cosa è cambiato/);
    assert.match(wake.newsLiteracy, /Perché conta sulla plancia/);
    assert.match(wake.newsLiteracy, /In sintesi/);
    assert.match(wake.newsLiteracy, /Markets open/);
    assert.notEqual(wake.newsLiteracy, "Fonte bbc, non è un fatto della plancia.");
    assert.equal(wake.literacy.items[0].source, "bbc-world-rss");
    assert.match(wake.literacy.items[0].whyItMatters, /pipeline/);
    assert.match(wake.literacy.items[0].whyItMatters, /Northwind/);
    assert.match(wake.literacy.items[0].whyItMatters, /browser-use/);
    assert.match(wake.literacy.items[0].summary, /shares/);
    assert.deepEqual(wake.literacy.auto, ["news"]);
    assert.equal(wake.actions.includes("news"), false);
    assert.equal(wake.integrity.wakeGated, false);
    assert.equal(wake.state.module, "pipeline");
  });

  test("a second wake joins the in-flight request", async () => {
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    resident.setResidentCompleterForTests(async () => {
      calls += 1;
      await gate;
      return {
        content: JSON.stringify({ summary: "uno", actions: [], ask: [], newsLiteracy: "" }),
        model: "test-model",
      };
    });
    const first = resident.wakeResident({ module: "map" });
    const second = resident.wakeResident({ module: "pipeline" });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(calls, 1);
    release();
    const [a, b] = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.equal(a.id, b.id);
    assert.equal(a.summary, b.summary);
  });

  test("free tier and model failure still surface a mechanical Atlas summary", async () => {
    resident.setResidentPaidCheckForTests(() => false);
    resident.setResidentCompleterForTests(async () => {
      throw new Error("model should not run");
    });
    const free = await resident.wakeResident({ module: "memory" });
    assert.equal(free.fallback, "free");
    assert.match(free.summary, /^Atlas\./);
    assert.match(free.summary, /memory/);
    assert.match(free.summary, /problemi aperti 1/);
    assert.deepEqual(free.actions, []);
    assert.match(free.newsLiteracy, /Markets open/);

    resident.resetResidentForTests();
    resident.setResidentCollectorForTests(async () => fixture({ module: "chat", news: [] }));
    resident.setResidentPaidCheckForTests(() => true);
    resident.setResidentCompleterForTests(async () => {
      throw Object.assign(new Error("upstream"), { code: "NO_OPENROUTER" });
    });
    const failed = await resident.wakeResident({ module: "chat" });
    assert.equal(failed.fallback, "NO_OPENROUTER");
    assert.match(failed.summary, /^Atlas\./);
    assert.match(failed.summary, /chat/);
    assert.equal(failed.newsLiteracy, "");
  });

  test("ingress before wake is folded into the one shot and not reacted twice", async () => {
    let calls = 0;
    resident.setResidentCompleterForTests(async ({ prompt }) => {
      calls += 1;
      return {
        content: JSON.stringify({
          summary: prompt.includes("Coda L1") ? "Ho visto la coda." : "Altro",
          actions: ["refresh"],
          ask: [],
          newsLiteracy: "",
        }),
        model: "test-model",
      };
    });
    bridge.appendEntryUpdate({ title: "Coda L1", detail: "prima del boot" });
    assert.equal(calls, 0);
    assert.equal(resident.residentStatus().pending, 1);
    const wake = await resident.wakeResident({ module: "map" });
    await resident.residentIdle();
    assert.equal(calls, 1);
    assert.match(wake.summary, /Ho visto la coda/);
    assert.deepEqual(wake.actions, ["refresh"]);
    assert.equal(resident.residentStatus().pending, 0);
    assert.equal(resident.residentStatus().awake, true);
  });

  test("L2 news reaction explains the item and acts only under L3", async () => {
    resident.setResidentAwakeForTests(true);
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
      { after: 0 },
    );
    resident.setResidentCompleterForTests(async () => ({
      content: JSON.stringify({
        summary: "Titolo esterno.",
        actions: ["zoom-in", "delete"],
        ask: ["export"],
        newsLiteracy: "Fonte bbc, non è un fatto della plancia.",
      }),
      model: "test-model",
    }));
    const item = {
      external_id: "rss:literacy-path",
      title: "Port strike spreads",
      summary: "ships wait outside",
      url: "https://example.test/port",
      source: "bbc-world-rss",
      lat: 51.5,
      lon: -0.1,
    };
    aiStore.upsertNewsItems([item]);
    await resident.residentIdle();
    aiStore.upsertNewsItems([{ ...item, title: "Port strike widens" }]);
    await resident.residentIdle();
    assert.match(body, /Fonte: bbc-world-rss/);
    assert.match(body, /Cosa è cambiato/);
    assert.match(body, /Perché conta sulla plancia/);
    assert.match(body, /In sintesi/);
    assert.match(body, /ships wait outside/);
    assert.match(body, /non sono fatti verificati/);
    assert.match(body, /cambiato da «Port strike spreads» a «Port strike widens»/);
    const rows = [...body.matchAll(/^data: (\{.*\})$/gm)].map((match) => JSON.parse(match[1]));
    const last = rows[rows.length - 1];
    assert.equal(last.kind, "ingress");
    assert.ok(last.actions.includes("news"));
    assert.ok(last.actions.includes("zoom-in"));
    assert.equal(last.actions.includes("delete"), false);
    assert.ok(last.ask.some((step) => step.id === "delete" && step.mode === "ask"));
    assert.equal(last.ask.some((step) => step.id === "export" && step.mode === "ask"), true);
    assert.equal(last.newsLiteracy.includes("non è un fatto della plancia"), false);
  });

  test("a hard integrity failure gates the wake and runs no hands", async () => {
    let calls = 0;
    resident.setResidentCompleterForTests(async () => {
      calls += 1;
      return {
        content: JSON.stringify({ summary: "non devo partire", actions: ["zoom-in"], ask: [], newsLiteracy: "" }),
        model: "should-not-run",
      };
    });
    resident.setResidentIntegrityCheckForTests(async () => ({
      ok: false,
      hardFail: true,
      at: "2026-11-02T00:00:00.000Z",
      failures: [{ id: "sandbox-path", detail: "sandbox assente" }],
    }));
    const wake = await resident.wakeResident({ module: "map" });
    assert.equal(calls, 0);
    assert.equal(wake.fallback, "integrity");
    assert.equal(wake.integrity.wakeGated, true);
    assert.equal(wake.integrity.ok, false);
    assert.deepEqual(wake.actions, []);
    assert.deepEqual(wake.ask, []);
    assert.match(wake.summary, /Integrità di avvio non superata/);
    assert.match(wake.summary, /sandbox-path/);
    assert.match(wake.newsLiteracy, /Markets open/);
    assert.match(wake.newsLiteracy, /Perché conta sulla plancia/);
  });

  test("awake resident forwards a new update when the plancia stream is open", async () => {
    let prompts = [];
    resident.setResidentAwakeForTests(true);
    resident.setResidentCompleterForTests(async ({ prompt, kind }) => {
      prompts.push({ prompt, kind });
      return {
        content: JSON.stringify({
          summary: "Aggiornamento ricevuto.",
          actions: ["status"],
          ask: ["wipe-db"],
          newsLiteracy: "",
        }),
        model: "test-model",
      };
    });
    bridge.appendEntryUpdate({ title: "Ingresso vivo", detail: "subito" });
    await resident.residentIdle();
    assert.equal(prompts.length, 0);
    assert.equal(resident.residentStatus().pending, 1);
    const res = {
      write() { return true; },
      on() {},
      setTimeout() {},
      writeHead() {},
    };
    resident.subscribeResidentStream({ setTimeout() {}, on() {} }, res, { after: 0 });
    await resident.residentIdle();
    assert.equal(prompts.length, 1);
    assert.equal(prompts[0].kind, "ingress");
    assert.match(prompts[0].prompt, /Ingresso vivo/);
    const reaction = JSON.parse(prompts[0].prompt);
    assert.equal(reaction.kind, "ingress");
    assert.equal(reaction.events[0].kind, "updates");
    const gated = resident.gateResidentProposal(["status"], ["wipe-db"]);
    assert.deepEqual(gated.actions, ["status"]);
    assert.equal(gated.ask[0].id, "wipe-db");
    assert.equal(gated.ask[0].mode, "ask");
  });

  test("news upsert emits only when the headline changes", async () => {
    let calls = 0;
    resident.setResidentAwakeForTests(true);
    resident.subscribeResidentStream(
      { setTimeout() {}, on() {} },
      { write() { return true; }, on() {}, setTimeout() {}, writeHead() {} },
      { after: 0 },
    );
    resident.setResidentCompleterForTests(async () => {
      calls += 1;
      return {
        content: JSON.stringify({
          summary: "News letta come titolo esterno.",
          actions: [],
          ask: [],
          newsLiteracy: "Fonte bbc, non è un fatto della plancia.",
        }),
        model: "test-model",
      };
    });
    const item = {
      external_id: "rss:resident-test",
      title: "Port strike",
      summary: "ships wait",
      url: "https://example.test/port",
      source: "bbc-world-rss",
      lat: 51.5,
      lon: -0.1,
    };
    aiStore.upsertNewsItems([item]);
    await resident.residentIdle();
    assert.equal(calls, 1);
    aiStore.upsertNewsItems([item]);
    await resident.residentIdle();
    assert.equal(calls, 1);
    aiStore.upsertNewsItems([{ ...item, title: "Port strike spreads" }]);
    await resident.residentIdle();
    assert.equal(calls, 2);
  });

  test("proactive writes forward to Atlas without a client poll", async () => {
    let seen = "";
    resident.setResidentAwakeForTests(true);
    resident.subscribeResidentStream(
      { setTimeout() {}, on() {} },
      { write() { return true; }, on() {}, setTimeout() {}, writeHead() {} },
      { after: 0 },
    );
    resident.setResidentCompleterForTests(async ({ prompt }) => {
      seen = prompt;
      return {
        content: JSON.stringify({ summary: "Segnale visto.", actions: [], ask: [], newsLiteracy: "" }),
        model: "test-model",
      };
    });
    aiStore.pushProactiveEvent("2026-11-02", "news_pins", {
      toast: "3 news pin aggiornati",
      titles: ["Port strike"],
    });
    await resident.residentIdle();
    assert.match(seen, /3 news pin aggiornati/);
    assert.match(seen, /news_pins/);
  });

  test("SSE pushes the hooked update and does not poll", async () => {
    resident.setResidentAwakeForTests(true);
    resident.setResidentCompleterForTests(async ({ prompt }) => ({
      content: JSON.stringify({
        summary: prompt,
        actions: [],
        ask: [],
        newsLiteracy: "",
      }),
      model: "test-model",
    }));
    const app = express();
    app.use(express.json());
    app.use("/api/ai", aiRouter);
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const port = server.address().port;
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("SSE event missing")), 4000);
        const req = http.get(`http://127.0.0.1:${port}/api/ai/agentq/resident/events`, (res) => {
          assert.equal(res.statusCode, 200);
          assert.match(String(res.headers["content-type"]), /text\/event-stream/);
          let buf = "";
          res.on("data", (chunk) => {
            buf += chunk.toString();
            if (!buf.includes("Ingresso SSE")) return;
            clearTimeout(timer);
            assert.match(buf, /"kind":"ingress"/);
            res.destroy();
            resolve();
          });
        });
        req.on("error", (err) => {
          if (err.code === "ECONNRESET") return;
          clearTimeout(timer);
          reject(err);
        });
        setTimeout(() => {
          bridge.appendEntryUpdate({ title: "Ingresso SSE", detail: "push" });
        }, 40);
      });

      const wakeRes = await fetch(`http://127.0.0.1:${port}/api/ai/agentq/resident/wake`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ module: "map" }),
      });
      const wake = await wakeRes.json();
      assert.equal(wakeRes.status, 200);
      assert.equal(wake.resident, true);
      assert.equal(wake.kind, "wake");
      assert.match(wake.summary, /^Atlas\./);
      const status = await fetch(`http://127.0.0.1:${port}/api/ai/agentq/resident`);
      const body = await status.json();
      assert.equal(body.resident, true);
      assert.equal(body.installed, true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("event cursor starts after the wake the page already showed", async () => {
    resident.setResidentCompleterForTests(async ({ prompt }) => ({
      content: JSON.stringify({
        summary: prompt.slice(0, 240),
        actions: [],
        ask: [],
        newsLiteracy: "",
      }),
      model: "test-model",
    }));
    const wake = await resident.wakeResident({ module: "map" });
    let body = "";
    const res = {
      writeHead() {},
      setTimeout() {},
      write(chunk) {
        body += chunk;
        return true;
      },
      on() {},
    };
    resident.subscribeResidentStream({ setTimeout() {}, on() {} }, res, { after: wake.seq });
    assert.equal(body.includes(wake.id), false);
    bridge.appendEntryUpdate({ title: "Dopo il cursore", detail: "solo nuovi" });
    await resident.residentIdle();
    assert.match(body, /Dopo il cursore/);
    assert.equal(body.includes(wake.id), false);
  });

  test("live collect reads snapshot, board, updates, and news", async () => {
    initDashboardStore();
    fs.writeFileSync(
      updatesPath,
      JSON.stringify([{ at: "2026-11-02T00:00:00.000Z", title: "Live update", detail: "board" }]),
    );
    resident.setResidentNewsLoaderForTests(async () => [
      { title: "Live fixture", source: "bbc-world-rss", summary: "solo test" },
    ]);
    const bundle = await resident.collectWakeBundleLive({ module: "pipeline" });
    assert.equal(bundle.module, "pipeline");
    assert.equal(typeof bundle.health.score, "number");
    assert.ok(bundle.board.total > 0);
    assert.equal(bundle.updates[0].title, "Live update");
    assert.equal(bundle.news[0].title, "Live fixture");
    assert.equal(typeof bundle.problemCount, "number");
    assert.ok(bundle.tops.length > 0);
  });

  test("gate drops mic and keeps L3 ask flags", () => {
    const gated = resident.gateResidentProposal(["refresh", "mic", "password"], ["export"]);
    assert.deepEqual(gated.actions, ["refresh"]);
    assert.deepEqual(
      gated.ask.map((step) => step.id),
      ["password", "export"],
    );
    assert.equal(gated.tagged.some((step) => step.id === "mic"), false);
    assert.equal(gated.ask.every((step) => step.mode === "ask"), true);
  });

  test("hooks, client stream, MIC yield, and build are wired without a new poll", () => {
    const service = read("backend/src/services/atlasResident.js");
    const bus = read("backend/src/services/atlasResidentBus.js");
    const bridgeSrc = read("backend/src/services/agentqBridge.js");
    const storeSrc = read("backend/src/memory/aiStore.js");
    const routes = read("backend/src/routes/ai.js");
    const appJs = read("public/js/app.js");
    const ui = read("public/js/agentqUi.js");
    const uiMirror = read("backend/public/js/agentqUi.js");

    assert.equal(service.includes("setInterval("), false);
    assert.equal(/\bsetTimeout\s*\(/.test(service), false);
    assert.equal(bus.includes("setInterval("), false);
    assert.equal(ui.includes("setInterval("), false);
    assert.equal(ui, uiMirror);
    assert.equal(bridgeSrc.includes("noteResidentIngress"), true);
    assert.equal(storeSrc.includes('kind: "news"'), true);
    assert.equal(storeSrc.includes('kind: "proactive"'), true);
    assert.equal(routes.includes('"/agentq/resident/wake"'), true);
    assert.equal(routes.includes('"/agentq/resident/events"'), true);
    assert.equal(service.includes("Not a full literacy module"), false);
    assert.equal(service.includes("explainNewsForOperator"), true);
    assert.equal(service.includes('"c10": "done"'), false);
    assert.equal(read("backend/src/services/atlasNewsLiteracy.js").includes("Cosa è cambiato"), true);
    assert.equal(read("backend/src/services/atlasNewsLiteracy.js").includes("Perché conta sulla plancia"), true);

    assert.equal(ui.includes("new EventSource"), true);
    assert.equal(ui.includes("/api/ai/agentq/resident/events?after="), true);
    assert.equal(ui.includes("startAtlasResident"), true);
    assert.equal(ui.includes("getUserMedia"), false);
    assert.equal(ui.includes("yieldToCall: true"), true);
    assert.equal(ui.includes("ifUnlocked: true"), true);
    assert.equal(ui.includes("respectCall: true"), true);
    const wire = ui.slice(ui.indexOf("export async function wireAgentqUi"));
    assert.ok(wire.indexOf("startAtlasResident") < wire.indexOf("showEntryUpdates"));
    assert.equal(ui.includes("residentStarted"), true);

    const speakAt = appJs.indexOf("function speak(text, opts = {})");
    const yieldAt = appJs.indexOf("opts.yieldToCall", speakAt);
    const unlockAt = appJs.indexOf("opts.ifUnlocked", speakAt);
    const releaseAt = appJs.indexOf("releaseForTts", speakAt);
    assert.ok(speakAt > 0 && yieldAt > speakAt && unlockAt > yieldAt && releaseAt > unlockAt);
    assert.equal(appJs.includes('const BUILD_ID = "rail-30-actuate"'), true);
    assert.equal(appJs.includes("module: () => state.module"), true);
    assert.equal(read("backend/src/server.js").includes('build: "rail-30-actuate"'), true);
    assert.equal(read("public/index.html").includes("rail-28-c1"), false);
    assert.equal(read("public/index.html").includes("rail-29-resident"), false);
    assert.equal(read("backend/public/index.html").includes("rail-30-actuate"), true);
    assert.match(read("public/css/app.css"), /data-atlas-resident/);
  });
});
