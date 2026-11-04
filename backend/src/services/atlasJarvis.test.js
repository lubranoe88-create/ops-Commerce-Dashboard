import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, test } from "node:test";
import express from "express";
import { routeAtlasTurn } from "./atlasRoute.js";
import { dispatchAtlasTurn } from "./atlasSpecialists.js";
import {
  executeRun,
  listOpenRuns,
  resumeInterruptedRuns,
  runsFilePath,
  setRunsFileForTests,
  startRun,
} from "./atlasRuns.js";
import {
  performWorkflowStep,
  resumeWorkflowRun,
  runWorkflow,
  setWorkflowDepsForTests,
} from "./atlasWorkflows.js";
import { handleMcpBatch, handleMcpMessage, setMcpRegistryFileForTests } from "./atlasMcp.js";
import {
  cronMatches,
  ensureDefaultSchedule,
  nextCronAt,
  publicSchedule,
  runDueJobs,
  runScheduledJob,
  saveJob,
  setScheduleClockForTests,
  setScheduleFileForTests,
  stopScheduleForTests,
  urgencyForBundle,
} from "./atlasSchedule.js";
import { buildCockpit } from "./atlasCockpit.js";
import { buildMemoryGraph, memoryGraph as memoryGraphFromDisk } from "./atlasMemoryGraph.js";
import { listToolCalls, noteToolCall, setToolLogFileForTests } from "./atlasToolLog.js";
import { recordDecision, setDecisionFileForTests } from "./atlasDecisionLog.js";
import { setTrustFileForTests } from "./atlasAutonomyPolicy.js";
import { patchAtlasSession, setSessionFileForTests } from "./atlasSessionStore.js";
import { appendExpandableMemory, setMemoryExpandPathForTests } from "./agentqBridge.js";
import { aiRouter } from "../routes/ai.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-rail34-"));

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function calmBundle() {
  return {
    health: { status: "ok", score: 90, openErrors: 0 },
    board: { ok: 4, error: 0, unverified: 0, total: 4 },
    problemCount: 0,
    problems: [],
  };
}

function loudBundle() {
  return {
    health: { status: "error", score: 12, openErrors: 2 },
    board: { ok: 1, error: 2, unverified: 0, total: 3 },
    problemCount: 1,
    problems: [{ kind: "function-board", title: "orders", severity: "high" }],
  };
}

let stamp = "0";

function file(name) {
  return path.join(dir, `${name}-${stamp}.json`);
}

describe("Atlas rail-34 jarvis", { concurrency: false }, () => {
  beforeEach(() => {
    stamp = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setRunsFileForTests(file("runs"));
    setScheduleFileForTests(file("schedule"));
    setScheduleClockForTests(() => Date.parse("2026-11-02T10:00:00.000Z"));
    stopScheduleForTests();
    setMcpRegistryFileForTests(file("mcp"));
    setToolLogFileForTests(file("tools"));
    setDecisionFileForTests(file("decisions"));
    setTrustFileForTests(file("trust"));
    setSessionFileForTests(file("session"), { mirror: false });
    setMemoryExpandPathForTests(file("memory"));
    setWorkflowDepsForTests({});
  });

  test("J1 routes one specialist and keeps the speaker Atlas", async () => {
    const state = routeAtlasTurn("qual è lo stato della plancia?");
    const news = routeAtlasTurn("ultime notizie");
    const hands = routeAtlasTurn("zoom in sul globo");
    const research = routeAtlasTurn("cerca porto di genova");
    const both = routeAtlasTurn("zoom in e cerca porto");
    const chat = routeAtlasTurn("ciao atlas");
    const memory = routeAtlasTurn("cerca in memoria budget");

    for (const route of [state, news, hands, research, both]) {
      assert.equal(route.name, "Atlas");
      assert.equal(route.speaker, "Atlas");
      assert.equal(route.fanout, false);
      assert.equal(route.selected.length, 1);
    }
    assert.equal(state.specialist, "state");
    assert.equal(news.specialist, "news");
    assert.equal(hands.specialist, "hands");
    assert.equal(research.specialist, "research");
    assert.equal(both.specialist, "research");
    assert.equal(both.considered.length > 1, true);
    assert.equal(chat.specialist, null);
    assert.deepEqual(chat.selected, []);
    assert.equal(memory.intent, "memory-recall");
    assert.equal(memory.specialist, "research");

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
    assert.deepEqual(calls, ["hands"]);
    assert.equal(turn.name, "Atlas");
    assert.equal(turn.fanout, false);
    assert.equal(turn.handled, true);
    assert.match(turn.reply, /^Atlas/);

    const local = await dispatchAtlasTurn("zoom in sul globo");
    assert.equal(local.specialist, "hands");
    assert.deepEqual(local.actions, ["zoom-in"]);
    assert.match(local.reply, /^Atlas/);
    assert.equal(local.model, null);

    const refused = await dispatchAtlasTurn("guarda nei file della sandbox");
    assert.equal(refused.specialist, "research");
    assert.equal(refused.searched, false);
    assert.match(refused.reply, /Non cerco/);
    assert.match(refused.reply, /^Atlas/);
  });

  test("J2 checkpoints a run and resumes the unfinished step after restart", async () => {
    const run = startRun({
      kind: "workflow",
      title: "morning-open",
      workflowId: "morning-open",
      steps: [
        { id: "wake", kind: "wake" },
        { id: "module", kind: "module", module: "map" },
        { id: "problems", kind: "problems" },
      ],
    });
    const calls = [];
    await assert.rejects(
      () =>
        executeRun(run.id, async (step) => {
          calls.push(step.id);
          const saved = JSON.parse(fs.readFileSync(runsFilePath(), "utf8")).runs.find((row) => row.id === run.id);
          assert.equal(saved.phase, "started");
          assert.equal(saved.steps.find((item) => item.id === step.id).status, "started");
          if (step.id === "module") throw new Error("restart");
          return { ok: true, summary: step.id };
        }),
      /restart/,
    );
    assert.deepEqual(calls, ["wake", "module"]);
    const disk = JSON.parse(fs.readFileSync(runsFilePath(), "utf8"));
    const mid = disk.runs.find((row) => row.id === run.id);
    assert.equal(mid.status, "running");
    assert.equal(mid.cursor, 1);
    assert.equal(mid.steps[0].status, "done");

    calls.length = 0;
    const resumed = await resumeInterruptedRuns(async (step) => {
      calls.push(step.id);
      return { ok: true, summary: step.id, actions: step.kind === "module" ? ["map"] : [] };
    });
    assert.deepEqual(calls, ["module", "problems"]);
    assert.equal(resumed[0].status, "done");
    assert.equal(resumed[0].cursor, 3);
    assert.equal(JSON.parse(fs.readFileSync(runsFilePath(), "utf8")).runs[0].status, "done");
  });

  test("J2 pauses on ASK and does not run the following step", async () => {
    const run = startRun({
      kind: "workflow",
      title: "export-check",
      workflowId: "export-check",
      steps: [
        { id: "map", kind: "hand", action: "map" },
        { id: "export", kind: "hand", action: "export" },
        { id: "problems", kind: "problems" },
      ],
    });
    const paused = await executeRun(run.id, (step) => performWorkflowStep(step, {}));
    assert.equal(paused.status, "paused");
    assert.equal(paused.cursor, 1);
    assert.equal(paused.steps[0].status, "done");
    assert.equal(paused.steps[2].status, "pending");
    assert.equal(paused.pendingAsk.some((item) => item.id === "export"), true);
    const again = await executeRun(run.id, (step) => performWorkflowStep(step, {}), { resumePaused: true });
    assert.equal(again.status, "paused");
    assert.equal(again.steps[2].status, "pending");
    const view = await resumeWorkflowRun(run.id);
    assert.equal(view.name, "Atlas");
    assert.equal(view.actions.includes("export"), false);
    assert.equal(view.actions.includes("map"), true);
    assert.equal(view.run.status, "paused");
  });

  test("J3 exposes a JSON-RPC tool bus over Atlas hands and external stubs", async () => {
    const init = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "initialize" });
    assert.equal(init.result.serverInfo.name, "Atlas");
    assert.equal(init.result.protocolVersion, "2024-11-05");

    const listed = await handleMcpMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const names = listed.result.tools.map((tool) => tool.name);
    assert.equal(names.includes("zoom-in"), true);
    assert.equal(names.includes("workflow.morning-open"), true);

    const zoom = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "zoom-in", arguments: {} },
    });
    assert.match(zoom.result.content[0].text, /^Atlas/);
    assert.equal(zoom.result.structuredContent.stub, false);
    assert.equal(zoom.result.structuredContent.mode, "auto");
    assert.equal(zoom.result.structuredContent.executed, true);
    assert.deepEqual(zoom.result.structuredContent.actions, ["zoom-in"]);

    const ask = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "export", arguments: {} },
    });
    assert.equal(ask.result.structuredContent.mode, "ask");
    assert.equal(ask.result.structuredContent.executed, false);
    assert.equal(ask.result.structuredContent.stub, false);
    assert.match(ask.result.content[0].text, /ASK/);

    const registered = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 5,
      method: "tools/register",
      params: { name: "crm.lookup", description: "CRM esterno non collegato", inputSchema: { type: "object" } },
    });
    assert.equal(registered.result.tool.wired, false);
    const stub = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "crm.lookup", arguments: { q: "northwind" } },
    });
    assert.equal(stub.result.structuredContent.stub, true);
    assert.equal(stub.result.structuredContent.executed, false);
    assert.match(stub.result.content[0].text, /^Atlas/);
    assert.match(stub.result.content[0].text, /stub/);

    const conflict = await handleMcpMessage({
      jsonrpc: "2.0",
      id: 7,
      method: "tools/register",
      params: { name: "zoom-in", description: "no" },
    });
    assert.equal(conflict.error.code, -32602);
    const missing = await handleMcpMessage({ jsonrpc: "2.0", id: 8, method: "nope" });
    assert.equal(missing.error.code, -32601);
    const invalid = await handleMcpMessage({ id: 9, method: "tools/list" });
    assert.equal(invalid.error.code, -32600);
    assert.equal(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" }), null);

    const batch = await handleMcpBatch([
      { jsonrpc: "2.0", id: "p", method: "ping" },
      { jsonrpc: "2.0", method: "notifications/initialized" },
    ]);
    assert.equal(batch.length, 1);
    assert.deepEqual(batch[0].result, {});
    assert.equal(listToolCalls({ limit: 5 }).some((row) => row.name === "zoom-in"), true);
    assert.equal(listToolCalls({ limit: 8 }).some((row) => row.stub === true), true);
  });

  test("J5 persists an hourly digest and respects X5 and L3", async () => {
    const seeded = ensureDefaultSchedule();
    const hourly = seeded.jobs.find((job) => job.id === "hourly-status");
    assert.ok(hourly);
    assert.equal(hourly.everyMs, 60 * 60 * 1000);
    assert.equal(hourly.enabled, true);
    assert.equal(Date.parse(hourly.nextAt) > Date.parse("2026-11-02T10:00:00.000Z"), true);
    assert.equal(await runDueJobs({ collect: async () => calmBundle() }).then((rows) => rows.length), 0);

    assert.equal(urgencyForBundle(calmBundle()).quiet, true);
    assert.equal(urgencyForBundle(loudBundle()).speak, true);
    assert.equal(urgencyForBundle(loudBundle()).score >= 60, true);

    const published = [];
    saveJob({
      id: "hourly-status",
      everyMs: 60 * 60 * 1000,
      nextAt: "2026-11-02T09:00:00.000Z",
      enabled: true,
    });
    const quiet = await runScheduledJob("hourly-status", {
      collect: async () => calmBundle(),
      propose: ["refresh", "export"],
      publish: (event) => published.push(event),
    });
    assert.equal(quiet.name, "Atlas");
    assert.equal(quiet.spoken, false);
    assert.equal(quiet.quiet, true);
    assert.deepEqual(quiet.executed, []);
    assert.equal(quiet.ask.some((item) => item.id === "export"), true);
    assert.equal(published.length, 0);
    assert.match(quiet.summary, /^Atlas/);
    const stored = JSON.parse(fs.readFileSync(file("schedule"), "utf8"));
    assert.equal(stored.jobs.find((job) => job.id === "hourly-status").lastResult.quiet, true);
    assert.equal(await runDueJobs({ collect: async () => calmBundle() }).then((rows) => rows.length), 0);

    saveJob({
      id: "hourly-status",
      everyMs: 60 * 60 * 1000,
      nextAt: "2026-11-02T09:00:00.000Z",
      enabled: true,
    });
    const loud = await runDueJobs({
      collect: async () => loudBundle(),
      propose: ["refresh", "export"],
      publish: (event) => published.push(event),
    });
    assert.equal(loud.length, 1);
    assert.deepEqual(loud[0].executed, ["refresh"]);
    assert.equal(loud[0].executed.includes("export"), false);
    assert.equal(loud[0].ask.some((item) => item.id === "export"), true);
    assert.equal(loud[0].spoken, true);
    assert.equal(published.length, 1);
    assert.equal(published[0].kind, "proactive");

    assert.equal(cronMatches("0 * * * *", new Date("2026-11-02T10:00:00.000Z")), true);
    assert.equal(cronMatches("0 * * * *", new Date("2026-11-02T10:05:00.000Z")), false);
    assert.equal(cronMatches("*/15 * * * *", new Date("2026-11-02T10:15:00.000Z")), true);
    assert.equal(nextCronAt("0 * * * *", Date.parse("2026-11-02T10:05:00.000Z")), "2026-11-02T11:00:00.000Z");
    saveJob({ id: "cron-digest", title: "Cron", kind: "status-digest", everyMs: 0, cron: "0 * * * *", enabled: false });
    assert.equal((await runDueJobs({ collect: async () => loudBundle() })).length, 0);
    const schedule = publicSchedule();
    assert.equal(schedule.jobs.some((job) => job.id === "hourly-status"), true);
    assert.equal(schedule.jobs.some((job) => job.id === "cron-digest" && job.enabled === false), true);
  });

  test("J6 cockpit shows resident, tools, ASK, and the decision tail", () => {
    noteToolCall({ name: "zoom-in", mode: "auto", stub: false, detail: "mano accettata" });
    recordDecision({
      source: "route",
      choices: [{ action: "hands", mode: "auto", reason: "hands", because: "Un solo specialista." }],
    });
    patchAtlasSession({ pendingAskAdd: { id: "export", reason: "export" } });
    assert.equal(recordDecision({ source: "nope", choices: [{ action: "x", mode: "auto", reason: "t", because: "y" }] }), null);
    const cockpit = buildCockpit();
    assert.equal(cockpit.name, "Atlas");
    assert.equal(cockpit.resident.name, "Atlas");
    assert.equal(cockpit.resident.resident, true);
    assert.equal(cockpit.toolCalls.some((row) => row.name === "zoom-in"), true);
    assert.equal(cockpit.pendingAsk.some((row) => row.id === "export"), true);
    assert.equal(cockpit.decisions.some((row) => row.source === "route"), true);
    assert.ok(Array.isArray(cockpit.runs));
    assert.ok(Array.isArray(cockpit.schedule));
  });

  test("X2 morning-open runs wake, module, and problems as Atlas", async () => {
    setWorkflowDepsForTests({
      wake: async () => ({ summary: "Sveglio." }),
      problems: async () => ({ count: 1, problems: [{ title: "orders" }] }),
    });
    const result = await runWorkflow("morning-open");
    assert.equal(result.name, "Atlas");
    assert.equal(result.speaker, "Atlas");
    assert.equal(result.workflow, "morning-open");
    assert.equal(result.run.status, "done");
    assert.equal(result.run.cursor, 3);
    assert.match(result.reply, /^Atlas/);
    assert.match(result.reply, /Sveglio/);
    assert.match(result.reply, /modulo map/);
    assert.match(result.reply, /Problemi aperti: 1/);
    assert.deepEqual(result.actions, ["map"]);
    assert.equal(result.actions.includes("export"), false);
    const disk = JSON.parse(fs.readFileSync(runsFilePath(), "utf8"));
    assert.equal(disk.runs[0].status, "done");
    assert.equal(disk.runs[0].steps.map((step) => step.status).every((status) => status === "done"), true);
    await assert.rejects(
      () => runWorkflow("missing-playbook"),
      (err) => {
        assert.equal(err.status, 404);
        return true;
      },
    );
  });

  test("X4 links expandable notes by tag and recall token", () => {
    const lone = buildMemoryGraph([
      { id: "a", title: "Alfa uno", text: "prima", tags: ["atlas"] },
      { id: "b", title: "Beta due", text: "seconda", tags: ["atlas"] },
    ]);
    assert.equal(lone.edges.length, 0);
    appendExpandableMemory({ title: "Porto di Genova", text: "Navi in attesa", tags: ["porto", "atlas"] });
    appendExpandableMemory({ title: "Sciopero al porto", text: "Banchina ferma", tags: ["porto"] });
    const graph = memoryGraphFromDisk({ limit: 10 });
    assert.equal(graph.name, "Atlas");
    assert.equal(graph.nodes.length >= 2, true);
    assert.equal(graph.edges.some((edge) => edge.reason === "tag:porto"), true);
    assert.equal(graph.edges.some((edge) => edge.reason === "recall:porto"), true);
  });

  test("HTTP route, MCP, cockpit, schedule, and workflow stay on Atlas", async () => {
    setWorkflowDepsForTests({
      wake: async () => ({ summary: "Sveglio." }),
      problems: async () => ({ count: 0, problems: [] }),
    });
    const app = express();
    app.use(express.json());
    app.use("/api/ai", aiRouter);
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}/api/ai`;
    try {
      const mcp = await fetch(`${base}/agentq/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      const tools = await mcp.json();
      assert.equal(tools.result.tools.some((tool) => tool.name === "map"), true);

      const noted = await fetch(`${base}/agentq/mcp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      });
      assert.equal(noted.status, 202);

      const routed = await fetch(`${base}/agentq/route`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "zoom in sul globo" }),
      });
      const zoom = await routed.json();
      assert.equal(routed.status, 200);
      assert.equal(zoom.name, "Atlas");
      assert.equal(zoom.specialist, "hands");
      assert.equal(zoom.fanout, false);
      assert.deepEqual(zoom.actions, ["zoom-in"]);

      const opened = await fetch(`${base}/agentq/workflows/run`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "morning-open" }),
      });
      const workflow = await opened.json();
      assert.equal(opened.status, 200);
      assert.equal(workflow.workflow, "morning-open");
      assert.equal(workflow.run.status, "done");
      assert.match(workflow.reply, /^Atlas/);

      const cockpitRes = await fetch(`${base}/agentq/cockpit`);
      const cockpit = await cockpitRes.json();
      assert.equal(cockpit.name, "Atlas");
      assert.equal(cockpit.resident.name, "Atlas");
      assert.equal(listOpenRuns().every((run) => run.status !== "running" || run.workflowId), true);

      const scheduleRes = await fetch(`${base}/agentq/schedule`);
      const schedule = await scheduleRes.json();
      assert.equal(schedule.jobs.some((job) => job.id === "hourly-status"), true);

      const graphRes = await fetch(`${base}/agentq/memory/graph`);
      const graph = await graphRes.json();
      assert.equal(graph.name, "Atlas");
      assert.ok(Array.isArray(graph.nodes));
      assert.ok(Array.isArray(graph.edges));
    } finally {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  test("rail-40-mic-clone is stamped and the cockpit mirrors match", () => {
    assert.equal(read("backend/src/services/atlasRoute.js"), read("public/js/atlasRoute.js"));
    assert.equal(read("public/js/atlasRoute.js"), read("backend/public/js/atlasRoute.js"));
    assert.equal(read("public/js/atlasCockpitUi.js"), read("backend/public/js/atlasCockpitUi.js"));
    assert.equal(read("public/js/atlasMemoryGraphUi.js"), read("backend/public/js/atlasMemoryGraphUi.js"));
    assert.equal(read("public/js/agentqUi.js"), read("backend/public/js/agentqUi.js"));
    assert.equal(read("public/js/app.js"), read("backend/public/js/app.js"));
    assert.equal(read("public/index.html"), read("backend/public/index.html"));
    assert.equal(read("public/css/app.css"), read("backend/public/css/app.css"));

    assert.match(read("public/js/app.js"), /const BUILD_ID = "rail-40-mic-clone"/);
    assert.match(read("backend/src/server.js"), /build:\s*"rail-40-mic-clone"/);
    assert.match(read("public/index.html"), /src="\/js\/app\.js\?v=rail-40-mic-clone"/);
    assert.match(read("public/index.html"), /id="cockpitPanel"/);
    assert.match(read("public/index.html"), /id="memoryBottom"/);
    assert.match(read("public/index.html"), /data-holo-action="cockpit"/);
    assert.match(read("public/index.html"), /data-holo-action="memory"/);
    assert.equal(read("public/index.html").includes('data-holo-action="memory-graph"'), false);
    assert.equal(read("public/index.html").includes(">LIVE<"), false);
    assert.match(read("public/js/app.js"), /case "cockpit"/);
    assert.match(read("public/js/app.js"), /cervello olografico/);
    assert.match(read("public/js/atlasMemoryGraphUi.js"), /memory\/live/);
    assert.match(read("backend/src/routes/ai.js"), /\/agentq\/memory\/live/);
    assert.match(read("public/js/agentqUi.js"), /routeAtlasTurn/);
    assert.equal(read("public/js/agentqUi.js").includes("setInterval("), false);
    assert.equal(read("backend/src/services/atlasResident.js").includes("setInterval("), false);
    assert.match(read("public/js/atlasCockpitUi.js"), /pendingAsk/);
    assert.match(read("public/js/atlasCockpitUi.js"), /toolCalls/);
    assert.match(read("public/js/atlasMemoryGraphUi.js"), /memory-edge--recall/);
    assert.match(read("backend/src/routes/ai.js"), /\/agentq\/mcp/);
    assert.match(read("backend/src/routes/ai.js"), /\/agentq\/schedule/);
    assert.match(read("backend/src/routes/ai.js"), /\/agentq\/workflows\/run/);
    assert.match(read("backend/src/routes/ai.js"), /\/agentq\/runs\/:id\/resume/);
    assert.match(read("public/css/app.css"), /\.cockpit-body/);
    assert.match(read("public/css/app.css"), /\.memory-graph-svg/);
    assert.match(read("public/css/app.css"), /\.memory-bottom/);
  });
});
