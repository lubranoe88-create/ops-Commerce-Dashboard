import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../../..");

async function loadWake() {
  return import(pathToFileURL(join(root, "public/js/atlasWake.js")).href);
}

describe("Atlas wake word + desktop always-on", () => {
  test("wake word is Atlas and matches Atlas / ehi atlas", async () => {
    const { WAKE_WORD, matchesWakeWord } = await loadWake();
    assert.equal(WAKE_WORD, "Atlas");
    assert.equal(matchesWakeWord("Atlas"), true);
    assert.equal(matchesWakeWord("atlas"), true);
    assert.equal(matchesWakeWord("ehi Atlas"), true);
    assert.equal(matchesWakeWord("hey atlas"), true);
    assert.equal(matchesWakeWord("ok atlas, apri la plancia"), true);
    assert.equal(matchesWakeWord("ciao mondo"), false);
    assert.equal(matchesWakeWord("agente q"), false);
    assert.equal(matchesWakeWord("jarvis"), false);
    assert.equal(matchesWakeWord("atlante"), false);
    const { wakeCommandRemainder } = await loadWake();
    assert.equal(wakeCommandRemainder("ok atlas, apri la plancia"), "apri la plancia");
    assert.equal(wakeCommandRemainder("ehi Atlas dimmi i top"), "dimmi i top");
    assert.equal(wakeCommandRemainder("Atlas"), "");
    assert.equal(wakeCommandRemainder("ciao mondo"), "");
  });

  test("canArmAlwaysOn only on desktop + env", async () => {
    const { canArmAlwaysOn, isDesktopVoiceHost } = await loadWake();
    assert.equal(canArmAlwaysOn({ alwaysOnEnv: true, desktop: true }), true);
    assert.equal(canArmAlwaysOn({ alwaysOnEnv: true, desktop: false }), false);
    assert.equal(canArmAlwaysOn({ alwaysOnEnv: false, desktop: true }), false);
    assert.equal(isDesktopVoiceHost("Mozilla/5.0 (Windows NT 10.0)"), true);
    assert.equal(isDesktopVoiceHost("Mozilla/5.0 (iPad; CPU OS 18_0)"), false);
    assert.equal(isDesktopVoiceHost("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)"), false);
  });

  test("reduceAlwaysOn: listen → Atlas wake → open-call → in-call → listening", async () => {
    const { reduceAlwaysOn } = await loadWake();
    let s = reduceAlwaysOn({ enabled: false, phase: "off" }, "enable");
    assert.equal(s.phase, "arming");
    assert.equal(s.wakeWord, "Atlas");
    s = reduceAlwaysOn(s, "mic-ready");
    assert.equal(s.phase, "listening");
    s = reduceAlwaysOn(s, "transcript", { text: "ehi Atlas" });
    assert.equal(s.action, "open-call");
    assert.equal(s.phase, "waking");
    s = reduceAlwaysOn(s, "call-open");
    assert.equal(s.phase, "in-call");
    s = reduceAlwaysOn(s, "call-end");
    assert.equal(s.phase, "listening");
    assert.equal(s.action, "resume-listen");
  });

  test("mirrors match and public wake module exports Atlas", () => {
    const pub = readFileSync(join(root, "public/js/atlasWake.js"), "utf8");
    const mir = readFileSync(join(root, "backend/public/js/atlasWake.js"), "utf8");
    assert.equal(pub, mir);
    assert.match(pub, /WAKE_WORD = "Atlas"/);
  });

  test("wake phrases are whole words and iPadOS desktop UA is not a desktop host", async () => {
    const { matchesWakeWord, isDesktopVoiceHost, wakeCommandRemainder, WAKE_PHRASES } = await loadWake();
    assert.equal(WAKE_PHRASES.includes("atlas"), true);
    assert.equal(WAKE_PHRASES.includes("ehi atlas"), true);
    assert.equal(WAKE_PHRASES.includes("hey atlas"), true);
    assert.equal(matchesWakeWord("Ehi, Atlas!"), true);
    assert.equal(matchesWakeWord("ehì atlas"), true);
    assert.equal(matchesWakeWord("atlante"), false);
    assert.equal(matchesWakeWord("atlassian"), false);
    assert.equal(matchesWakeWord(""), false);
    assert.equal(wakeCommandRemainder("ehi atlas apri la mappa"), "apri la mappa");
    assert.equal(wakeCommandRemainder("Atlas"), "");
    assert.equal(wakeCommandRemainder("apri la mappa"), "");
    const ipadOs = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15";
    assert.equal(isDesktopVoiceHost(ipadOs, { platform: "MacIntel", maxTouchPoints: 5 }), false);
    assert.equal(isDesktopVoiceHost(ipadOs, { platform: "MacIntel", maxTouchPoints: 0 }), true);
    assert.equal(isDesktopVoiceHost("Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)"), false);
  });

  test("mic-dead rearms, a miss stays listening, and disable turns the spotter off", async () => {
    const { reduceAlwaysOn } = await loadWake();
    let state = reduceAlwaysOn({ enabled: false, phase: "off" }, "enable");
    state = reduceAlwaysOn(state, "mic-ready");
    const miss = reduceAlwaysOn(state, { type: "transcript", text: "apri la mappa" });
    assert.equal(miss.phase, "listening");
    assert.equal(miss.action, "keep");
    const dead = reduceAlwaysOn(state, "mic-dead");
    assert.equal(dead.phase, "arming");
    assert.equal(dead.enabled, true);
    assert.equal(dead.action, "rearm");
    const off = reduceAlwaysOn(state, "disable");
    assert.equal(off.phase, "off");
    assert.equal(off.enabled, false);
    const ended = reduceAlwaysOn({ phase: "in-call", enabled: false }, "call-end");
    assert.equal(ended.phase, "off");
    const during = reduceAlwaysOn({ phase: "in-call", enabled: true }, "wake");
    assert.equal(during.phase, "in-call");
    assert.notEqual(during.action, "open-call");
  });
});
