import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  explainNewsForOperator,
  gateLiteracyActions,
  whatChangedForItem,
  whyItMattersForItem,
} from "./atlasNewsLiteracy.js";

const plancia = {
  module: "pipeline",
  tops: [{ title: "Northwind", score: 0.9, rank: 1 }],
  problems: [{ title: "browser-use", detail: "off", severity: "high" }],
  problemCount: 1,
};

describe("C10 news literacy", () => {
  test("empty news is an empty path", () => {
    const brief = explainNewsForOperator([], plancia);
    assert.equal(brief.text, "");
    assert.deepEqual(brief.items, []);
    assert.deepEqual(brief.auto, []);
  });

  test("a headline is summarized and contextualized for the operator", () => {
    const brief = explainNewsForOperator(
      [{ title: "Markets open", source: "bbc-world-rss", summary: "shares rise", change: "inserted" }],
      plancia,
    );
    const item = brief.items[0];
    assert.equal(item.source, "bbc-world-rss");
    assert.match(item.whatChanged, /titolo nuovo/);
    assert.match(item.whyItMatters, /pipeline/);
    assert.match(item.whyItMatters, /Northwind/);
    assert.match(item.whyItMatters, /browser-use/);
    assert.match(item.summary, /shares rise/);
    assert.match(brief.text, /Fonte: bbc-world-rss/);
    assert.match(brief.text, /Cosa è cambiato:/);
    assert.match(brief.text, /Perché conta sulla plancia:/);
    assert.match(brief.text, /In sintesi:/);
    assert.match(brief.text, /non sono fatti verificati/);
    assert.ok(brief.text.split("\n").length >= 5);
    assert.deepEqual(brief.auto, ["news"]);
    assert.deepEqual(brief.ask, []);
  });

  test("an updated headline says what changed", () => {
    const changed = whatChangedForItem({
      title: "Port strike widens",
      change: "updated",
      previousTitle: "Port strike spreads",
    });
    assert.match(changed, /cambiato da «Port strike spreads» a «Port strike widens»/);
    const why = whyItMattersForItem(
      { title: "Northwind delay", summary: "yard" },
      { module: "map", tops: [{ title: "Northwind" }], problems: [], problemCount: 0 },
    );
    assert.match(why, /Modulo aperto: map/);
    assert.match(why, /top «Northwind»/);
    assert.match(why, /pin da leggere/);
  });

  test("literacy proposals act only through the L3 gate", () => {
    const gated = gateLiteracyActions(["news", "zoom-in", "delete", "export", "password"]);
    assert.deepEqual(gated.actions, ["news", "zoom-in"]);
    assert.deepEqual(gated.ask.map((step) => step.id), ["delete", "export", "password"]);
    assert.equal(gated.ask.every((step) => step.mode === "ask"), true);
    assert.equal(gated.actions.includes("delete"), false);
    assert.deepEqual(explainNewsForOperator([{ title: "Markets", source: "bbc-world-rss" }], plancia).proposed, ["news"]);
  });
});
