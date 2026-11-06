import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { PROVE_DEFERRED, PROVE_ITEM_IDS, runProvePack, summarizeProve } from "./atlasProve.js";

const EXPECTED_IDS = [
  "identity",
  "personality",
  "L3",
  "X1",
  "resident-wake",
  "L2",
  "C2",
  "C3",
  "C6",
  "C9",
  "C11",
  "C12",
  "C7",
  "C8",
  "X5",
  "P2",
  "P3",
  "M1",
  "M2",
  "M3",
  "M4",
  "M5",
  "J1",
  "J2",
  "J3",
  "J5",
  "J6",
  "X2",
  "X4",
  "tts",
  "alphabet",
  "call",
  "phase-later",
  "X6",
  "build",
];

function assertPack(report) {
  const failed = report.items.filter((item) => !item.ok);
  assert.equal(
    failed.length,
    0,
    failed.map((item) => `${item.id}: ${item.detail}`).join("\n"),
  );
  assert.equal(report.passed, report.total);
  assert.equal(report.percent, 100);
  assert.equal(report.ok, true);
  assert.equal(report.build, "rail-44-memory-still");
  assert.deepEqual(report.items.map((item) => item.id), EXPECTED_IDS);
  assert.deepEqual(
    report.deferred.map((item) => item.id),
    ["ipad-always-on"],
  );
  assert.equal(report.items.some((item) => item.id === "X6"), true);
  assert.equal(report.items.some((item) => item.id === "phase-later"), true);
}

describe("Atlas prove pack", { concurrency: false }, () => {
  test("covers every done classifica id and keeps iPad always-on deferred", () => {
    assert.deepEqual([...PROVE_ITEM_IDS], EXPECTED_IDS);
    assert.deepEqual(
      PROVE_DEFERRED.map((item) => item.id),
      ["ipad-always-on"],
    );
  });

  test("runtime prove is 100% without redirecting stores", async () => {
    const report = await runProvePack({ isolate: false });
    assertPack(report);
    assert.equal(report.depth, "runtime");
    const summary = summarizeProve(report);
    assert.equal(summary.ok, true);
    assert.equal(summary.passed, summary.total);
    assert.equal(summary.percent, 100);
    assert.equal(summary.items.length, EXPECTED_IDS.length);
    assert.equal(summary.deferred[0].id, "ipad-always-on");
  });

  test("isolated prove pack is 100% including file round-trips", async () => {
    const report = await runProvePack({ isolate: true });
    assertPack(report);
    assert.equal(report.depth, "isolated");
    assert.match(report.items.find((item) => item.id === "X1").detail, /third confirm/);
    assert.match(report.items.find((item) => item.id === "C9").detail, /session file/);
    assert.match(report.items.find((item) => item.id === "J2").detail, /resumes/);
    assert.match(report.items.find((item) => item.id === "call").detail, /barge-cancel/);
    assert.match(report.items.find((item) => item.id === "phase-later").detail, /iPad stays Phase Now/);
    assert.match(report.items.find((item) => item.id === "X6").detail, /iPad always-on stays out of scope/);
  });
});
