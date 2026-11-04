import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test, before } from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-brain-"));
process.env.MEMORY_DB_PATH = path.join(dir, "memory.sqlite");
process.env.ATLAS_MEMORY_DIR = dir;

const bridge = await import("./agentqBridge.js");
const brain = await import("./atlasBrain.js");

describe("Atlas unified brain neurons", () => {
  before(() => {
    bridge.setMemoryExpandPathForTests(path.join(dir, "expandable.json"));
    brain.setBrainPathForTests(path.join(dir, "brain-neurons.json"));
  });

  test("ensureAtlasBrain always seeds Agent Q heritage", () => {
    const data = brain.ensureAtlasBrain({ force: true });
    const heritage = data.neurons.filter((n) => n.kind === "heritage");
    assert.ok(heritage.length >= 1, "heritage neurons required");
    assert.ok(
      heritage.some((n) => /Agent Q|plan before act|Heritage/i.test(`${n.title} ${n.body}`)),
      "Agent Q operating rules present",
    );
    assert.ok(data.neurons.some((n) => (n.tags || []).includes("atlas-agentq-heritage")));
  });

  test("brainLiveSnapshot is unified and includes heritage", () => {
    bridge.appendExpandableMemory({
      title: "Nota skill test",
      text: "skill body",
      tags: ["web-skill", "sticky", "durable"],
    });
    const live = brain.brainLiveSnapshot({ limit: 50 });
    assert.equal(live.ok, true);
    assert.equal(live.unified, true);
    assert.equal(live.label, "CERVELLO");
    assert.ok(live.neurons.some((n) => n.kind === "heritage"));
    assert.ok(live.neurons.some((n) => n.kind === "skill" || (n.tags || []).includes("web-skill")));
    assert.ok(live.graph?.nodes?.length >= 1);
  });

  test("dedupeNeurons collapses same body / same title", () => {
    const body =
      "when unsure, offer to verify with: state, updates, news, memory search, hands, mcp, cockpit. speech: tts elevenlabs.";
    const out = brain.dedupeNeurons([
      { id: "a", title: "Atlas tool config — verify", body, kind: "prompt", weight: 0.4, at: "2026-01-01T00:00:00Z" },
      { id: "b", title: "Atlas tool config — verify", body, kind: "prompt", weight: 1, at: "2026-02-01T00:00:00Z" },
      { id: "c", title: "STORICO · same body", body, kind: "fact", weight: 0.2, at: "2026-03-01T00:00:00Z" },
      { id: "d", title: "Unique other", body: "completely different content here for a unique neuron", kind: "fact", weight: 0.1 },
    ]);
    assert.equal(out.length, 2);
    assert.ok(out.some((n) => n.id === "b"));
    assert.ok(out.some((n) => n.id === "d"));
  });
});
