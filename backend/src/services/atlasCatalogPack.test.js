import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test, before } from "node:test";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-catalog-"));
process.env.MEMORY_DB_PATH = path.join(dir, "memory.sqlite");

const bridge = await import("./agentqBridge.js");
const pack = await import("./atlasCatalogPack.js");

describe("Atlas plancia control + world geo packs", () => {
  before(() => {
    bridge.setMemoryExpandPathForTests(path.join(dir, "expandable.json"));
  });

  test("ensureAtlasCatalogMemory seeds sticky control and geo notes", () => {
    const first = pack.ensureAtlasCatalogMemory();
    const again = pack.ensureAtlasCatalogMemory();
    assert.equal(first.ok, true);
    assert.equal(again.control, first.control);
    assert.equal(again.geo, first.geo);
    const listed = bridge.listExpandableMemory({ limit: 20 });
    const tags = listed.entries.flatMap((e) => e.tags || []);
    assert.equal(tags.includes("atlas-plancia-control"), true);
    assert.equal(tags.includes("atlas-world-geo"), true);
    assert.equal(tags.includes("sticky"), true);
    assert.match(listed.entries.find((e) => (e.tags || []).includes("atlas-world-geo")).text, /Tokyo/);
    assert.match(listed.entries.find((e) => (e.tags || []).includes("atlas-plancia-control")).text, /MAPPA/);
  });
});
