import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  ATLAS_PERSONA,
  ATLAS_PERSONA_STAMP,
  sanitizeAtlasUserReply,
} from "./atlasPersonality.js";
import { SYSTEM_CARD } from "./panelCatalog.js";
import { ATLAS_TRUTH_PROMPT_BLOCK } from "./atlasPromptCanon.js";
import {
  STICKY_TAGS,
  isStickyEntry,
  rankRecall,
  recallQueryFromTurn,
} from "./atlasRecall.js";

describe("Atlas conversation heart", () => {
  test("persona drives dialogue and forbids JSON to the user", () => {
    assert.match(ATLAS_PERSONA, /heart of the OPS plancia|living intelligence/i);
    assert.match(ATLAS_PERSONA, /Drive the conversation/);
    assert.match(ATLAS_PERSONA, /Never show raw JSON/);
    assert.match(ATLAS_PERSONA, /follow-up question/);
    assert.match(ATLAS_PERSONA, /Honest:/);
    assert.equal(ATLAS_PERSONA.includes(ATLAS_PERSONA_STAMP), true);
  });

  test("persona stays lean — full truth pack is not pasted into every system card", () => {
    assert.ok(ATLAS_PERSONA.length < 1600, `persona too large: ${ATLAS_PERSONA.length}`);
    assert.ok(SYSTEM_CARD.length < 3200, `system card too large: ${SYSTEM_CARD.length}`);
    assert.equal(ATLAS_PERSONA.includes(ATLAS_TRUTH_PROMPT_BLOCK), false);
    assert.ok(ATLAS_TRUTH_PROMPT_BLOCK.length > 1000);
  });

  test("sanitizeAtlasUserReply extracts speech from leaked router JSON", () => {
    const leaked =
      '{"route":"answer_local","reply":"Vedo la mappa globale sulla plancia. Vuoi uno zoom?","actions":["map"]}';
    const clean = sanitizeAtlasUserReply(leaked);
    assert.match(clean, /mappa globale/i);
    assert.equal(clean.includes('"route"'), false);
    assert.match(clean, /^Atlas\b/i);
  });

  test("sanitizeAtlasUserReply keeps plain Atlas lines", () => {
    assert.match(sanitizeAtlasUserReply("Ciao, come stai?"), /Atlas/i);
  });

  test("sticky truth packs surface without keyword overlap", () => {
    const now = Date.parse("2026-11-03T12:00:00.000Z");
    const sticky = {
      id: "truth",
      at: "2026-11-03T12:00:00.000Z",
      title: "Atlas truth pack",
      text: "Never invent numbers that are not verified.",
      tags: ["atlas-truth-pack", "durable", "sticky"],
    };
    const unrelated = {
      id: "noise",
      at: "2026-11-03T12:00:00.000Z",
      title: "Meteo porto",
      text: "pioggia sul porto",
      tags: ["durable"],
    };
    assert.equal(isStickyEntry(sticky), true);
    assert.equal(STICKY_TAGS.has("atlas-truth-pack"), true);
    const ranked = rankRecall([sticky, unrelated], "apri la mappa cesium", { now, limit: 5 });
    assert.equal(ranked.some((row) => row.entry.id === "truth"), true);
    assert.equal(ranked.some((row) => row.entry.id === "noise"), false);
  });

  test("recallQueryFromTurn prefers message plus recent dialogue", () => {
    const q = recallQueryFromTurn({
      message: "zoom sulla mappa",
      module: "map",
      conversation: [
        { role: "user", content: "ciao" },
        { role: "assistant", content: "Atlas. Pronto." },
      ],
    });
    assert.match(q, /zoom sulla mappa/);
    assert.match(q, /map/);
    assert.match(q, /Pronto/);
  });
});
