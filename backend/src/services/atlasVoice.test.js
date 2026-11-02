import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, test } from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || "sk-test-atlas-voice";
process.env.OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4.1-flash";

const { config } = await import("../config.js");
const openrouter = await import("./openrouter.js");
const reliability = await import("./atlasReliability.js");
const speak = await import("../../public/js/atlasSpeak.js");
const call = await import("../../public/js/atlasCall.js");

function read(rel) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

function jsonResponse(status, body, { audio = false } = {}) {
  const bytes = Uint8Array.from([1, 2, 3, 4]);
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => (audio ? bytes.buffer : new ArrayBuffer(0)),
  };
}

describe("Atlas rail-35 voice", { concurrency: false }, () => {
  beforeEach(() => {
    reliability.resetReliabilityForTests();
    reliability.setReliabilitySleeperForTests(() => {});
    config.elevenLabsApiKey = "";
    config.cartesiaApiKey = "";
    config.voiceAlwaysOn = false;
  });

  test("alphabet pack spells A–Z, digits, and symbols before a voice can lock", () => {
    const expected = {
      A: "a", B: "bi", C: "ci", D: "di", E: "e", F: "effe", G: "gi", H: "acca",
      I: "i", J: "i lunga", K: "kappa", L: "elle", M: "emme", N: "enne", O: "o",
      P: "pi", Q: "cu", R: "erre", S: "esse", T: "ti", U: "u", V: "vu", W: "doppia vu",
      X: "ics", Y: "ipsilon", Z: "zeta",
      0: "zero", 1: "uno", 2: "due", 3: "tre", 4: "quattro", 5: "cinque",
      6: "sei", 7: "sette", 8: "otto", 9: "nove",
      "@": "chiocciola", ".": "punto", "-": "trattino", "/": "barra",
      "#": "cancelletto", "%": "percento", "+": "più",
    };
    assert.equal(speak.ALPHABET_PACK, "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@.-/#%+");
    for (const ch of speak.ALPHABET_PACK) {
      assert.equal(speak.spellCharacter(ch), expected[ch], ch);
    }
    const gate = speak.lockVoiceForInformationalRead();
    assert.equal(gate.locked, true);
    assert.deepEqual(gate.missing, []);
    assert.equal(gate.fallback, null);
    const spoken = speak.normalizeSpeakText(speak.ALPHABET_PACK);
    assert.equal(spoken.voiceLocked, true);
    assert.equal(spoken.spelled, true);
    assert.equal(spoken.text, gate.text);
    assert.match(spoken.text, /chiocciola/);
    assert.match(spoken.text, /cancelletto/);
    assert.match(spoken.text, /più/);
    const again = speak.normalizeSpeakText(spoken.text);
    assert.equal(again.text, spoken.text);
  });

  test("codes and emails are spelled, prose stays prose, unknown symbols fail soft", () => {
    assert.equal(
      speak.normalizeSpeakText("Il codice è AB-12").text,
      "Il codice è a, bi, trattino, uno, due",
    );
    assert.equal(
      speak.normalizeSpeakText("Scrivi a ada@ops.it").text,
      "Scrivi a a, di, a, chiocciola, o, pi, esse, punto, i, ti",
    );
    assert.equal(speak.normalizeSpeakText("sconto 100%").text, "sconto uno, zero, zero, percento");
    assert.equal(speak.normalizeSpeakText("ticket #441").text, "ticket cancelletto, quattro, quattro, uno");
    assert.equal(speak.normalizeSpeakText("Apri la mappa").text, "Apri la mappa");
    assert.equal(speak.normalizeSpeakText("Apri la mappa").spelled, false);

    const broken = speak.normalizeSpeakText("codice A€1");
    assert.equal(broken.voiceLocked, false);
    assert.equal(broken.fallback, "spelled");
    assert.match(broken.text, /simbolo/);
    assert.equal(speak.spellToken("A€B").text, "a, simbolo, bi");
    assert.equal(speak.normalizeSpeakText(broken.text).text, broken.text);

    const missing = speak.lockVoiceForInformationalRead("A€");
    assert.equal(missing.locked, false);
    assert.deepEqual(missing.missing, ["€"]);
    assert.equal(missing.fallback, "spelled");
  });

  test("TTS chain is ElevenLabs Flash, then Cartesia, Deepgram Aura, and MAI voice", async () => {
    const plain = openrouter.buildSpeechChain();
    assert.deepEqual(plain.map((step) => `${step.transport}:${step.model}`), [
      "openrouter:elevenlabs/eleven-flash-v2.5",
      "openrouter:deepgram/aura-2",
      "openrouter:microsoft/mai-voice-2.1-flash",
    ]);
    assert.equal(plain[0].voice, "sarah");
    assert.equal(plain[1].voice, "aura-2-cinzia-it");
    assert.equal(plain[2].voice, "it-IT-Rosa:MAI-Voice-2.1-Flash");

    config.elevenLabsApiKey = "sk-eleven-test";
    config.cartesiaApiKey = "sk-cartesia-test";
    const full = openrouter.buildSpeechChain();
    assert.deepEqual(full.map((step) => step.transport), [
      "elevenlabs",
      "openrouter",
      "cartesia",
      "openrouter",
      "openrouter",
    ]);
    assert.equal(full[0].model, "eleven_flash_v2_5");
    assert.equal(full[2].model, "sonic-3.6");

    const calls = [];
    openrouter.setOpenRouterFetchForTests(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      if (String(url).includes("api.elevenlabs.io")) return jsonResponse(404, { detail: { message: "voice" } });
      if (String(url).includes("openrouter.ai") && JSON.parse(init.body).model?.includes("eleven")) {
        return jsonResponse(503, { error: { message: "flash busy" } });
      }
      if (String(url).includes("api.cartesia.ai")) return jsonResponse(200, {}, { audio: true });
      return jsonResponse(500, { error: { message: "should not reach" } });
    });
    const spoken = await openrouter.synthesizeSpeech({ text: "codice AB-12" });
    assert.equal(spoken.model, "sonic-3.6");
    assert.equal(spoken.transport, "cartesia");
    assert.equal(spoken.spokenText, "codice a, bi, trattino, uno, due");
    assert.equal(spoken.voiceLocked, true);
    assert.equal(calls[0].url.includes("api.elevenlabs.io"), true);
    assert.equal(calls[0].body.model_id, "eleven_flash_v2_5");
    assert.equal(calls.at(-1).url, "https://api.cartesia.ai/tts/bytes");
    assert.equal(calls.at(-1).body.model_id, "sonic-3.6");
    assert.equal(calls.at(-1).body.language, "it");
    assert.equal(calls.at(-1).body.transcript, "codice a, bi, trattino, uno, due");
    assert.equal(calls.some((call) => String(call.body.model || "").includes("deepgram")), false);

    calls.length = 0;
    config.elevenLabsApiKey = "";
    openrouter.setOpenRouterFetchForTests(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      const model = JSON.parse(init.body).model;
      if (String(model).includes("eleven")) return jsonResponse(401, { error: { message: "bad key" } });
      if (String(url).includes("cartesia")) return jsonResponse(200, {}, { audio: true });
      return jsonResponse(500, { error: { message: model } });
    });
    const viaCartesia = await openrouter.synthesizeSpeech({ text: "buongiorno" });
    assert.equal(viaCartesia.transport, "cartesia");
    assert.equal(calls.some((row) => String(row.body.model || "").includes("deepgram")), false);
    assert.equal(calls.some((row) => String(row.body.model || "").includes("mai-voice")), false);
  });

  test("continuous call opens once, keeps the segment loop, and barges in during TTS", () => {
    assert.deepEqual(call.reduceCall({ open: false, phase: "idle" }, "tap"), {
      action: "open",
      open: true,
      phase: "listen",
      label: "END",
      cancelAudio: false,
      duplex: "barge-cancel",
    });
    const listening = call.reduceCall({ open: true, phase: "listen" }, "tap");
    assert.equal(listening.action, "hangup");
    assert.equal(listening.open, false);
    assert.equal(listening.label, "MIC");
    assert.equal(listening.phase, "idle");

    const bargeTap = call.reduceCall({ open: true, phase: "tts" }, "tap");
    const bargeSpeech = call.reduceCall({ open: true, phase: "tts" }, "speech");
    assert.equal(bargeTap.action, "barge");
    assert.equal(bargeSpeech.action, "barge");
    assert.equal(bargeTap.cancelAudio, true);
    assert.equal(bargeTap.open, true);
    assert.equal(bargeTap.phase, "listen");
    assert.equal(bargeTap.label, "END");

    const silent = call.reduceCall({ open: true, phase: "listen" }, "segment-silence");
    const heard = call.reduceCall({ open: true, phase: "listen" }, "segment-heard");
    const back = call.reduceCall({ open: true, phase: "tts" }, "tts-end");
    assert.equal(silent.action, "listen");
    assert.equal(silent.open, true);
    assert.equal(heard.action, "reply");
    assert.equal(heard.open, true);
    assert.equal(heard.label, "END");
    assert.equal(back.action, "listen");
    assert.equal(back.open, true);
    assert.equal(call.reduceCall({ open: true, phase: "listen" }, "speech").action, "keep");
    assert.equal(call.shouldYieldToCall({ yieldToCall: true, callOpen: true }), true);
    assert.equal(call.shouldYieldToCall({ yieldToCall: true, callOpen: false }), false);
    assert.equal(call.reduceCall({ open: true, phase: "listen" }, "mic-dead").open, false);

    const wake = call.wakeWordStatus(true);
    assert.equal(wake.env, true);
    assert.equal(wake.armed, false);
    assert.equal(wake.phase, "later");
    assert.match(wake.note, /deferred/);
    assert.match(call.VOICE_DUPLEX_NOTE, /WebRTC/);
    assert.match(call.VOICE_DUPLEX_NOTE, /AudioContext/);
    assert.equal(call.VOICE_DUPLEX, "barge-cancel");
  });

  test("rail-35-voice is stamped, mirrors match, and the speak path keeps the iPad audio route", () => {
    for (const rel of [
      "js/app.js",
      "js/atlasSpeak.js",
      "js/atlasCall.js",
      "index.html",
    ]) {
      assert.equal(read(`public/${rel}`), read(`backend/public/${rel}`), rel);
    }
    const app = read("public/js/app.js");
    const server = read("backend/src/server.js");
    const route = read("backend/src/routes/ai.js");
    assert.match(app, /const BUILD_ID = "rail-35-voice"/);
    assert.match(server, /build:\s*"rail-35-voice"/);
    assert.match(read("public/index.html"), /src="\/js\/app\.js\?v=rail-35-voice"/);
    assert.match(app, /normalizeSpeakText/);
    assert.match(app, /speakViaServerAudio/);
    assert.match(app, /getPrimedAudioContext/);
    assert.match(app, /decodeAudioData/);
    assert.match(app, /playsinline/);
    assert.match(app, /cancelPlayback/);
    assert.match(app, /bargeIn/);
    assert.match(app, /runCallLoop/);
    assert.match(app, /open \? "END" : "MIC"/);
    assert.match(app, /shouldYieldToCall/);
    assert.match(app, /yieldToCall: opts\.yieldToCall/);
    assert.match(app, /X6 wake-word stays deferred/);
    assert.equal(app.includes("new RTCPeerConnection"), false);
    assert.match(app, /dataset\.voiceDuplex = VOICE_DUPLEX/);
    assert.match(read("public/js/agentqUi.js"), /yieldToCall: true/);
    assert.match(read("backend/src/services/openrouter.js"), /eleven-flash/);
    assert.equal(config.openRouterTtsModel, "elevenlabs/eleven-flash-v2.5");
    assert.match(read("backend/src/services/openrouter.js"), /api\.cartesia\.ai\/tts\/bytes/);
    assert.match(read("backend/src/services/openrouter.js"), /deepgram\/aura-2/);
    assert.match(read("backend/src/services/openrouter.js"), /microsoft\/mai-voice-2\.1-flash/);
    assert.match(route, /spokenText/);
    assert.match(server, /wakeWord: "deferred"/);
    assert.match(read("backend/src/services/agentqBridge.js"), /wakeWordStatus/);
    assert.match(read("public/index.html"), /<span>MIC<\/span>/);
  });
});
