import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, beforeEach, describe, test } from "node:test";
import express from "express";
import {
  APPROVAL_THRESHOLD,
  THRESHOLD,
  TRUST_RELATIVE_PATH,
  classifyAction,
  defaultTrustFilePath,
  describePolicy,
  filterAutonomousActions,
  gateHandActions,
  recordAskApproval,
  setTrustFileForTests,
} from "./atlasAutonomyPolicy.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-x1-"));
const file = path.join(dir, "atlas-trust.json");
const defaultPath = defaultTrustFilePath();
const defaultExisted = fs.existsSync(defaultPath);

function approveTimes(id, n) {
  let last;
  for (let i = 0; i < n; i += 1) last = recordAskApproval(id);
  return last;
}

function reload() {
  setTrustFileForTests(file);
}

describe("Atlas X1 progressive autonomy", { concurrency: false }, () => {
  beforeEach(() => {
    fs.rmSync(file, { force: true });
    setTrustFileForTests(file);
  });

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    assert.equal(
      fs.existsSync(defaultPath),
      defaultExisted,
      "tests must not create the deployment trust file",
    );
  });

  test("starts conservative and does not create a trust file until a real ASK confirm", () => {
    assert.equal(THRESHOLD, 3);
    assert.equal(APPROVAL_THRESHOLD, 3);
    assert.equal(TRUST_RELATIVE_PATH, "backend/data/agentq-memory/atlas-trust.json");
    assert.ok(defaultPath.endsWith(path.join("data", "agentq-memory", "atlas-trust.json")));

    const policy = describePolicy();
    assert.equal(policy.startConservative, true);
    assert.equal(policy.threshold, 3);
    assert.deepEqual(policy.promoted, []);
    assert.deepEqual(policy.approvalCounts, {});
    assert.equal(policy.approvalSummary.tracked, 0);
    assert.equal(policy.store, TRUST_RELATIVE_PATH);
    assert.equal(fs.existsSync(file), false);

    assert.equal(classifyAction("zoom-in").mode, "auto");
    assert.equal(classifyAction("delete").mode, "ask");
    assert.equal(classifyAction("delete").reason, "destructive-write");
    assert.equal(classifyAction("password").reason, "credentials");
    assert.equal(classifyAction("custom-widget").reason, "unknown");
    assert.equal(classifyAction({ id: "zoom-in", pastSoftBand: true }).reason, "spend-past-soft-band");

    const skipped = recordAskApproval("zoom-in");
    assert.equal(skipped.recorded, false);
    assert.equal(skipped.justPromoted, false);
    assert.equal(fs.existsSync(file), false);
    assert.equal(classifyAction("zoom-in").reason, "zoom");
  });

  test("promotes an ASK id only on the third explicit confirm and reloads it as AUTO", () => {
    const first = recordAskApproval(" Export ");
    assert.equal(first.recorded, true);
    assert.equal(first.actionId, "export");
    assert.equal(first.count, 1);
    assert.equal(first.justPromoted, false);
    assert.equal(classifyAction("export").mode, "ask");
    assert.deepEqual(describePolicy().promoted, []);
    assert.equal(describePolicy().approvalCounts.export, 1);
    assert.equal(describePolicy().startConservative, true);

    const second = recordAskApproval({ actionId: "EXPORT" });
    assert.equal(second.count, 2);
    assert.equal(second.justPromoted, false);
    assert.equal(classifyAction("export").mode, "ask");
    assert.equal(filterAutonomousActions(["export", "zoom-in"]).length, 1);

    const third = recordAskApproval("export");
    assert.equal(third.count, 3);
    assert.equal(third.justPromoted, true);
    assert.equal(third.reason, "promoted");
    assert.deepEqual(third.promoted, ["export"]);
    assert.equal(third.approvalCounts.export, 3);
    assert.equal(classifyAction("export").mode, "auto");
    assert.equal(classifyAction("export").reason, "promoted");
    assert.equal(classifyAction({ id: "export", pastSoftBand: true }).mode, "auto");

    const raw = [{ id: "Export" }, "zoom-in", "dump"];
    const kept = filterAutonomousActions(raw);
    assert.equal(kept[0], raw[0]);
    assert.deepEqual(kept.slice(1), ["zoom-in"]);

    const gated = gateHandActions(["zoom-in", "export", "dump"]);
    assert.deepEqual(gated.actions, ["zoom-in", "export"]);
    assert.deepEqual(gated.ask.map((step) => step.id), ["dump"]);
    assert.deepEqual(
      gated.tagged.find((step) => step.id === "export"),
      { id: "export", mode: "auto", reason: "promoted" },
    );

    const disk = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(Object.keys(disk).sort(), ["approvals", "promoted", "updatedAt"]);
    assert.deepEqual(disk.approvals, { export: 3 });
    assert.deepEqual(disk.promoted, ["export"]);
    assert.equal(typeof disk.updatedAt, "string");
    assert.ok(!Number.isNaN(Date.parse(disk.updatedAt)));

    reload();
    assert.equal(classifyAction("export").reason, "promoted");
    assert.deepEqual(describePolicy().promoted, ["export"]);
    assert.equal(describePolicy().approvalCounts.export, 3);
    assert.equal(describePolicy().threshold, 3);
    assert.equal(describePolicy().startConservative, true);

    const fourth = recordAskApproval("export");
    assert.equal(fourth.count, 4);
    assert.equal(fourth.justPromoted, false);
    assert.equal(classifyAction("export").mode, "auto");
  });

  test("credentials and destructive ids promote only after their own three confirms", () => {
    approveTimes("password", 2);
    assert.equal(classifyAction("password").mode, "ask");
    assert.equal(classifyAction("token").mode, "ask");
    assert.equal(classifyAction("delete").mode, "ask");
    assert.deepEqual(describePolicy().promoted, []);

    const password = approveTimes("password", 1);
    assert.equal(password.count, 3);
    assert.equal(password.justPromoted, true);
    assert.equal(classifyAction("password").reason, "promoted");
    assert.equal(classifyAction("token").reason, "credentials");
    assert.equal(classifyAction("login").mode, "ask");
    assert.equal(classifyAction("api-key").mode, "ask");

    approveTimes("delete", 3);
    assert.equal(classifyAction("delete").reason, "promoted");
    assert.equal(classifyAction("wipe").reason, "destructive-write");
    assert.equal(classifyAction("correct").reason, "destructive-write");
    assert.equal(classifyAction("reorder-tops").mode, "ask");
    assert.equal(classifyAction("browser-use").mode, "ask");

    const policy = describePolicy();
    assert.deepEqual(policy.promoted, ["delete", "password"]);
    assert.equal(policy.approvalCounts.password, 3);
    assert.equal(policy.approvalCounts.delete, 3);
    assert.deepEqual(policy.auto, ["zoom", "module-view", "read", "status", "updates"]);
    assert.ok(policy.ask.includes("credentials"));
    assert.ok(policy.ask.includes("destructive-write"));
    assert.equal(policy.startConservative, true);
    assert.equal(policy.approvalSummary.promoted, 2);
    assert.equal(policy.approvalSummary.pending, 0);
  });

  test("confirming one id does not promote a sibling, a category, or an uncounted entry", () => {
    approveTimes("export", 3);
    for (const id of ["dump", "backup", "download", "delete", "password", "browser-use"]) {
      assert.equal(classifyAction(id).mode, "ask", id);
    }
    assert.deepEqual(describePolicy().promoted, ["export"]);

    fs.writeFileSync(
      file,
      `${JSON.stringify(
        {
          approvals: { password: 1, token: 3 },
          promoted: ["password", "token", "wipe"],
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        null,
        2,
      )}\n`,
    );
    reload();
    assert.equal(classifyAction("password").mode, "ask");
    assert.equal(classifyAction("token").reason, "promoted");
    assert.equal(classifyAction("wipe").mode, "ask");
    assert.deepEqual(describePolicy().promoted, ["token"]);

    fs.writeFileSync(file, "{not json");
    reload();
    assert.equal(classifyAction("token").mode, "ask");
    assert.deepEqual(describePolicy().promoted, []);
    const recovered = recordAskApproval("custom-widget");
    assert.equal(recovered.count, 1);
    const restored = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(restored.approvals, { "custom-widget": 1 });
    assert.deepEqual(restored.promoted, []);
  });

  test("unknown ids and spend-class ids use the same threshold", () => {
    assert.equal(classifyAction("custom-widget").mode, "ask");
    approveTimes("custom-widget", 2);
    assert.equal(gateHandActions(["custom-widget"]).actions.length, 0);
    assert.equal(gateHandActions(["custom-widget"]).ask[0].reason, "unknown");
    const promoted = approveTimes("custom-widget", 1);
    assert.equal(promoted.justPromoted, true);
    assert.deepEqual(gateHandActions("custom-widget").actions, ["custom-widget"]);

    approveTimes("escalate", 2);
    assert.equal(classifyAction("escalate").reason, "spend-past-soft-band");
    approveTimes("escalate", 1);
    assert.equal(classifyAction("escalate").reason, "promoted");
    assert.equal(classifyAction("escalate_main").mode, "ask");
    assert.equal(recordAskApproval("zoom-citta").recorded, false);
    assert.equal(classifyAction({ id: "zoom-in", pastSoftBand: true }).mode, "ask");
  });

  test("POST /api/ai/agentq/autonomy/approve records and promotes on the third confirm", async () => {
    const { aiRouter } = await import("../routes/ai.js");
    const app = express();
    app.use(express.json());
    app.use("/api/ai", aiRouter);
    const server = await new Promise((resolve) => {
      const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
    });
    try {
      const { port } = server.address();
      const post = async (body) => {
        const res = await fetch(`http://127.0.0.1:${port}/api/ai/agentq/autonomy/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body == null ? undefined : JSON.stringify(body),
        });
        return { status: res.status, data: await res.json() };
      };

      const missing = await post({});
      assert.equal(missing.status, 400);

      const blank = await post({ actionId: "   " });
      assert.equal(blank.status, 400);

      const auto = await post({ actionId: "zoom-in" });
      assert.equal(auto.status, 200);
      assert.equal(auto.data.recorded, false);
      assert.equal(auto.data.startConservative, true);
      assert.deepEqual(auto.data.promoted, []);

      let last;
      for (const actionId of ["Password", "password", "password"]) {
        last = await post({ actionId });
        assert.equal(last.status, 200);
        assert.equal(last.data.recorded, true);
        assert.equal(last.data.actionId, "password");
      }
      assert.equal(last.data.count, 3);
      assert.equal(last.data.justPromoted, true);
      assert.equal(last.data.threshold, 3);
      assert.deepEqual(last.data.promoted, ["password"]);
      assert.equal(last.data.approvalCounts.password, 3);
      assert.equal(classifyAction("password").reason, "promoted");
      assert.equal(classifyAction("token").mode, "ask");
    } finally {
      await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
  });

  test("build stamp, hands approve call, and public mirror stay on rail-34-jarvis", () => {
    const files = [
      "public/js/app.js",
      "public/index.html",
      "public/js/agentqUi.js",
      "backend/public/js/app.js",
      "backend/public/index.html",
      "backend/public/js/agentqUi.js",
      "backend/src/server.js",
    ].map((rel) => ({ rel, text: fs.readFileSync(path.join(root, rel), "utf8") }));

    for (const { rel, text } of files) {
      assert.equal(text.includes("rail-26-l3"), false, rel);
      assert.equal(text.includes("rail-27-x1"), false, rel);
      assert.equal(text.includes("rail-28-c1"), false, rel);
      assert.equal(text.includes("rail-29-resident"), false, rel);
    }
    for (const rel of ["public/js/app.js", "backend/public/js/app.js", "public/index.html", "backend/public/index.html", "backend/src/server.js"]) {
      const text = files.find((item) => item.rel === rel).text;
      assert.equal(text.includes("rail-34-jarvis"), true, rel);
    }
    assert.match(files.find((item) => item.rel === "backend/src/server.js").text, /build:\s*"rail-34-jarvis"/);
    assert.match(files.find((item) => item.rel === "public/js/app.js").text, /const BUILD_ID = "rail-34-jarvis"/);

    for (const rel of ["public/js/agentqUi.js", "backend/public/js/agentqUi.js"]) {
      const text = files.find((item) => item.rel === rel).text;
      const confirmAt = text.indexOf("window.confirm");
      const abortAt = text.indexOf("Azione non eseguita");
      const approveAt = text.indexOf("/api/ai/agentq/autonomy/approve");
      assert.ok(confirmAt > 0 && confirmAt < abortAt && abortAt < approveAt, rel);
      assert.equal(text.includes('step.reason === "promoted"'), true, rel);
    }

    assert.equal(
      fs.readFileSync(path.join(root, "public/js/agentqUi.js"), "utf8"),
      fs.readFileSync(path.join(root, "backend/public/js/agentqUi.js"), "utf8"),
    );
    assert.equal(
      fs.readFileSync(path.join(root, "backend/src/services/atlasPersonality.js"), "utf8").includes('export const ATLAS_NAME = "Atlas"'),
      true,
    );
    assert.equal(
      fs.readFileSync(path.join(root, "backend/src/routes/ai.js"), "utf8").includes('"/agentq/autonomy/approve"'),
      true,
    );
  });
});
