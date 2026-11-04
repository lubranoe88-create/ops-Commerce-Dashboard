import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test, before } from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-memory-live-"));
process.env.MEMORY_DB_PATH = path.join(dir, "memory.sqlite");
process.env.ATLAS_MEMORY_DIR = dir;

const bridge = await import("./agentqBridge.js");
const brain = await import("./atlasBrain.js");
const graph = await import("./atlasMemoryGraph.js");

describe("Atlas live MEMORY snapshot", () => {
  before(() => {
    bridge.setMemoryExpandPathForTests(path.join(dir, "expandable.json"));
    brain.setBrainPathForTests(path.join(dir, "brain-neurons.json"));
  });

  test("memoryLiveSnapshot is unified cervello with Agent Q heritage", () => {
    bridge.appendExpandableMemory({
      title: "Live note",
      text: "Nuova nota sulla plancia",
      tags: ["durable", "live-test"],
    });
    const live = graph.memoryLiveSnapshot({ limit: 40 });
    assert.equal(live.ok, true);
    assert.equal(live.unified, true);
    assert.equal(live.label, "CERVELLO");
    assert.ok(live.revision);
    assert.ok(live.neurons.some((n) => n.kind === "heritage"));
    assert.ok(live.expandable.count >= 1);
    assert.equal(live.expandable.entries.some((e) => e.title === "Live note"), true);
    assert.ok(live.graph?.nodes?.length >= 1);
  });

  test("revision changes when a note is appended", () => {
    const a = graph.memoryLiveSnapshot({ limit: 20 });
    bridge.appendExpandableMemory({
      title: "Seconda live",
      text: "Ancora una nota",
      tags: ["durable"],
    });
    const b = graph.memoryLiveSnapshot({ limit: 20 });
    assert.notEqual(a.revision, b.revision);
  });
});
