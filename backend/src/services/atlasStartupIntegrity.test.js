import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-integrity-"));
process.env.MEMORY_DB_PATH = path.join(dir, "memory.sqlite");
process.env.BROWSER_USE_ENABLED = "false";

const store = await import("./atlasIntegrityStore.js");
const bridge = await import("./agentqBridge.js");
const { runStartupIntegrity, resetStartupIntegrityForTests, REQUIRED_HAND_IDS } = await import("./atlasStartupIntegrity.js");

store.setIntegrityReportPathForTests(path.join(dir, "integrity.json"));
bridge.setUpdatesPathForTests(path.join(dir, "updates.json"));

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

describe("M5 startup integrity", { concurrency: false }, () => {
  beforeEach(() => {
    resetStartupIntegrityForTests();
    fs.writeFileSync(path.join(dir, "updates.json"), "[]\n");
  });

  test("a healthy plancia persists an ok report", async () => {
    const report = await runStartupIntegrity({ reason: "boot", force: true });
    assert.equal(report.ok, true, JSON.stringify(report.failures));
    assert.equal(report.hardFail, false);
    assert.deepEqual(report.failures, []);
    for (const id of ["agentq-status", "updates-readable", "hands-catalog", "autonomy-policy", "resident-installable", "sandbox-path"]) {
      assert.equal(report.checks.find((check) => check.id === id)?.ok, true, id);
    }
    const saved = store.readIntegrityReport();
    assert.equal(saved.ok, true);
    assert.equal(saved.reason, "boot");
    const problems = await bridge.getAgentqProblems({ limit: 40 });
    assert.equal(problems.problems.some((problem) => problem.kind === "integrity"), false);
    const updates = JSON.parse(fs.readFileSync(path.join(dir, "updates.json"), "utf8"));
    assert.equal(updates.some((row) => row.title === "Integrità avvio"), false);
  });

  test("a hard failure is persisted, surfaced, and not announced twice", async () => {
    const failing = {
      agentqStatus: async () => ({ ok: true, integrated: true, hands: 8 }),
      getEntryUpdates: async () => ({ ok: true, updates: [] }),
      hands: REQUIRED_HAND_IDS.map((id) => ({ id })),
      describePolicy: () => ({ version: 2, auto: ["zoom"], matrix: { auto: { zoom: ["zoom-in"] } } }),
      installResident: async () => ({ ok: true, installed: true }),
      sandboxExists: () => false,
      appendUpdate: (entry) => bridge.appendEntryUpdate(entry),
    };
    const first = await runStartupIntegrity({ reason: "boot", deps: failing, force: true });
    assert.equal(first.ok, false);
    assert.equal(first.hardFail, true);
    assert.equal(first.failures[0].id, "sandbox-path");
    const saved = store.readIntegrityReport();
    assert.equal(saved.ok, false);
    const problems = await bridge.getAgentqProblems({ limit: 40 });
    const hit = problems.problems.find((problem) => problem.id === "integrity-sandbox-path");
    assert.ok(hit);
    assert.equal(hit.severity, "high");
    assert.match(hit.detail, /sandbox assente/);
    let updates = JSON.parse(fs.readFileSync(path.join(dir, "updates.json"), "utf8"));
    assert.equal(updates.filter((row) => row.title === "Integrità avvio").length, 1);
    await runStartupIntegrity({ reason: "wake", deps: failing, force: true });
    updates = JSON.parse(fs.readFileSync(path.join(dir, "updates.json"), "utf8"));
    assert.equal(updates.filter((row) => row.title === "Integrità avvio").length, 1);
  });

  test("boot calls the check before listen", () => {
    const server = read("backend/src/server.js");
    assert.match(server, /runStartupIntegrity\(\{\s*reason:\s*"boot"\s*\}\)/);
    assert.match(server, /build:\s*"rail-34-jarvis"/);
    const bootAt = server.indexOf('runStartupIntegrity({ reason: "boot" })');
    const listenAt = server.indexOf("app.listen(");
    assert.ok(bootAt > 0 && bootAt < listenAt);
    assert.match(read("backend/src/routes/ai.js"), /\/agentq\/integrity/);
    assert.match(read("backend/src/services/atlasResident.js"), /runStartupIntegrity\(\{\s*reason:\s*"wake"\s*\}\)/);
  });
});
