import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atlas-actuate-"));
process.env.MEMORY_DB_PATH = path.join(dir, "memory.sqlite");
process.env.BROWSER_USE_ENABLED = "false";

const { planHandActions, readSandboxDocument } = await import("./agentqBridge.js");
const { planHandsFromUtterance, voiceDefersToAtlasHands } = await import("./atlasHandsPlan.js");
const {
  dispatchAtlasHand,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
  ZOOM_COUNTRY_HEIGHT,
  ZOOM_CONTINENT_HEIGHT,
  ZOOM_WORLD_HEIGHT,
} = await import("../../../public/js/atlasHoloDispatch.js");
const { handleAtlasCommand } = await import("../../../public/js/agentqUi.js");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function same(a, b) {
  assert.equal(read(a), read(b), `${a} !== ${b}`);
}

describe("actuation pack", () => {
  test("public mirrors and the hand plan stay in sync", () => {
    same("public/js/atlasHandsPlan.js", "backend/public/js/atlasHandsPlan.js");
    same("public/js/atlasHandsPlan.js", "backend/src/services/atlasHandsPlan.js");
    same("public/js/atlasHoloDispatch.js", "backend/public/js/atlasHoloDispatch.js");
    same("public/js/agentqUi.js", "backend/public/js/agentqUi.js");
    same("public/js/app.js", "backend/public/js/app.js");
    same("public/index.html", "backend/public/index.html");
    same("public/css/app.css", "backend/public/css/app.css");
    const app = read("public/js/app.js");
    assert.match(app, /dispatchAtlasHand\(/);
    assert.match(app, /voiceDefersToAtlasHands\(text\)/);
    assert.match(app, /fromVoice: true/);
    assert.match(app, /openBriefingModal/);
    assert.match(app, /openSandboxDoc/);
    assert.equal(app.includes('const BUILD_ID = "rail-37-atlas-voice"'), true);
  });

  test("zoom utterances become globe hands and call the camera", async () => {
    const plan = await planHandActions("zoom in sul globo");
    assert.equal(plan.engine, "atlas-hands-plan");
    assert.equal(plan.model, null);
    assert.deepEqual(plan.actions, ["zoom-in"]);
    const calls = [];
    const zoomIn = await dispatchAtlasHand(plan.actions[0], {
      showModule: async (mod) => calls.push(["module", mod]),
      zoomByFactor: (factor) => {
        calls.push(["zoom", factor]);
        return 4200;
      },
      showToast() {},
    }, { fromVoice: true });
    assert.equal(zoomIn.ran, "zoom-in");
    assert.equal(zoomIn.height, 4200);
    assert.deepEqual(calls, [["module", "map"], ["zoom", ZOOM_IN_FACTOR]]);

    const world = await planHandActions("zoom mondo");
    assert.deepEqual(world.actions, ["zoom-world"]);
    const flown = [];
    const worldRun = await dispatchAtlasHand("zoom-world", {
      showModule: async () => {},
      zoomToHeight: () => null,
      flyToTop: (lon, lat, height) => flown.push({ lon, lat, height }),
      showToast() {},
      lon: 12.5,
      lat: 42,
    });
    assert.equal(worldRun.ran, "zoom-world");
    assert.equal(flown[0].height, ZOOM_WORLD_HEIGHT);

    const country = await dispatchAtlasHand("zoom-paese", {
      showModule: async () => {},
      flyToTop: (lon, lat, height) => flown.push(height),
      lon: 1,
      lat: 2,
    });
    assert.equal(country.height, ZOOM_COUNTRY_HEIGHT);
    const continent = await dispatchAtlasHand("zoom-continente", {
      showModule: async () => {},
      flyToTop: (_lon, _lat, height) => flown.push(height),
      lon: 1,
      lat: 2,
    });
    assert.equal(continent.height, ZOOM_CONTINENT_HEIGHT);
    const zoomOut = await dispatchAtlasHand("zoom-out", {
      showModule: async () => {},
      zoomByFactor: (factor) => factor,
    });
    assert.equal(zoomOut.height, ZOOM_OUT_FACTOR);
  });

  test("chat and voice commands run module, document, and briefing hands", async () => {
    const ran = [];
    const ctx = {
      postChatUpdate() {},
      speak() {},
      runHoloAction(id, opts) {
        ran.push({ id, fromVoice: opts.fromVoice, path: opts.hand?.path || "" });
      },
      resolveHands: (text) => planHandActions(text),
    };
    assert.equal(await handleAtlasCommand("zoom out", { ...ctx, fromVoice: true }), true);
    assert.equal(await handleAtlasCommand("apri pipeline", ctx), true);
    assert.equal(await handleAtlasCommand("vai alla memory", ctx), true);
    assert.equal(await handleAtlasCommand("mostra chat", ctx), true);
    assert.equal(await handleAtlasCommand("mappa", ctx), true);
    assert.equal(await handleAtlasCommand("apri il briefing", ctx), true);
    assert.equal(await handleAtlasCommand("apri documento README.txt", ctx), true);
    assert.deepEqual(ran.map((step) => step.id), [
      "zoom-out",
      "pipeline",
      "memory",
      "chat",
      "map",
      "briefing",
      "document",
    ]);
    assert.equal(ran[0].fromVoice, true);
    assert.equal(ran[1].fromVoice, false);
    assert.equal(ran.at(-1).path, "README.txt");

    const offline = [];
    assert.equal(await handleAtlasCommand("controlla modulo pipeline", {
      postChatUpdate() {},
      runHoloAction(id) { offline.push(id); },
      resolveHands: async () => {
        throw new Error("down");
      },
    }), true);
    assert.deepEqual(offline, ["pipeline"]);

    const opened = [];
    const popped = [];
    await dispatchAtlasHand("document", {
      openDocument: (rel) => opened.push(rel),
    }, { hand: { path: "README.txt" } });
    await dispatchAtlasHand("briefing", {
      openBriefingModal: () => popped.push("briefing"),
    });
    assert.deepEqual(opened, ["README.txt"]);
    assert.deepEqual(popped, ["briefing"]);
  });

  test("document hand reads a sandbox file and refuses traversal", async () => {
    const sandbox = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data/agentq-sandbox");
    fs.mkdirSync(sandbox, { recursive: true });
    fs.writeFileSync(path.join(sandbox, "README.txt"), "nota plancia\n", "utf8");
    const plan = await planHandActions("apri documento README.txt");
    assert.deepEqual(plan.actions, ["document"]);
    assert.equal(plan.document, "README.txt");
    const doc = readSandboxDocument(plan.document);
    assert.equal(doc.kind, "text");
    assert.match(doc.text, /nota plancia/);
    const blocked = planHandsFromUtterance("apri documento ../etc/passwd");
    assert.equal(blocked.matched, true);
    assert.deepEqual(blocked.actions, []);
    assert.match(blocked.speak, /non consentito/);
    assert.equal(planHandsFromUtterance("cancella il database").matched, false);
    assert.equal(planHandsFromUtterance("fammi un riassunto della pipeline di oggi").matched, false);
    assert.equal(voiceDefersToAtlasHands("zoom world"), true);
    assert.equal(voiceDefersToAtlasHands("briefing"), true);
  });
});
