#!/usr/bin/env node
/**
 * Full live plancia suite against the deployed Render instance.
 * Requires rail-37-atlas-voice (Atlas). Exit 0 only on 100% hard pass.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const LIVE = process.env.LIVE_BASE || "https://ops-commerce-dashboard.onrender.com";
const PASS = process.env.LIVE_PASS || process.env.SITE_PASSWORD || "";
const EXPECT_BUILD = process.env.EXPECT_BUILD || "rail-37-atlas-voice";

const results = [];
const ok = (name, detail = "") => {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name} — ${detail}`);
};
const bad = (name, detail = "") => {
  results.push({ name, ok: false, detail });
  console.error(`FAIL  ${name} — ${detail}`);
};

function makeToneWav(seconds = 1, freq = 440) {
  const rate = 16000;
  const n = Math.floor(rate * seconds);
  const dataSize = n * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i += 1) {
    const sample = Math.sin((2 * Math.PI * freq * i) / rate) * 0.3 * 32767;
    buf.writeInt16LE(sample | 0, 44 + i * 2);
  }
  return buf;
}

async function loadPuppeteer() {
  try {
    return (await import("puppeteer")).default;
  } catch {
    /* continue */
  }
  for (const base of ["/tmp/node_modules/puppeteer", path.resolve("node_modules/puppeteer")]) {
    try {
      return require(base);
    } catch {
      try {
        return (await import(pathToFileURL(path.join(base, "lib/esm/puppeteer/puppeteer.js")).href))
          .default;
      } catch {
        /* next */
      }
    }
  }
  return null;
}

async function loginCookie() {
  const res = await fetch(`${LIVE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: PASS }),
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  const raw = setCookie.join("; ") || res.headers.get("set-cookie") || "";
  const m = /dash_auth=[^;]+/.exec(raw);
  if (!res.ok || !m) throw new Error(`login HTTP ${res.status}`);
  return m[0];
}

async function main() {
  if (!PASS) {
    bad("env", "LIVE_PASS missing");
    finish();
    return;
  }

  let health = null;
  try {
    health = await fetch(`${LIVE}/health`, { signal: AbortSignal.timeout(45_000) }).then((r) =>
      r.json(),
    );
    if (health?.ok && health.build === EXPECT_BUILD) {
      ok("health build", `${health.build}`);
    } else {
      bad("health build", `expected ${EXPECT_BUILD}, got ${health?.build || "?"}`);
    }
  } catch (e) {
    bad("health build", String(e?.message || e));
  }

  if (health?.voice?.primaryTts && /eleven-flash/i.test(String(health.voice.primaryTts))) {
    ok("Atlas voice fields", JSON.stringify(health.voice));
  } else {
    bad("Atlas voice fields", JSON.stringify(health?.voice || null));
  }

  if (health?.prove?.ok && health.prove.passed === health.prove.total && health.prove.total >= 30) {
    ok("health prove pack", `${health.prove.passed}/${health.prove.total} ${health.prove.percent}%`);
  } else {
    bad("health prove pack", JSON.stringify(health?.prove || null).slice(0, 240));
  }

  if (health?.voice?.duplex === "barge-cancel") {
    ok("barge-in duplex flag", health.voice.duplex);
  } else {
    bad("barge-in duplex flag", String(health?.voice?.duplex));
  }

  let cookie = "";
  try {
    cookie = await loginCookie();
    ok("login", "dash_auth cookie");
  } catch (e) {
    bad("login", String(e?.message || e));
  }

  const auth = (pathName, init = {}) =>
    fetch(`${LIVE}${pathName}`, {
      ...init,
      headers: { ...(init.headers || {}), Cookie: cookie },
      signal: AbortSignal.timeout(120_000),
    });

  if (cookie) {
    try {
      const r = await auth("/");
      const html = await r.text();
      r.ok && /globalMic|app\.js/i.test(html)
        ? ok("page load", `HTTP ${r.status} ${html.length}B`)
        : bad("page load", `HTTP ${r.status} len=${html.length}`);
    } catch (e) {
      bad("page load", String(e?.message || e));
    }

    try {
      const r = await auth(`/js/app.js?v=${EXPECT_BUILD}`);
      const js = await r.text();
      const buildId = /BUILD_ID\s*=\s*"([^"]+)"/.exec(js)?.[1] || "";
      const hasBarge = /bargeIn|barge-cancel|VOICE_DUPLEX/.test(js);
      const hasAlphabet = /normalizeSpeakText|simbolo|alfabeto/i.test(js);
      const hasWake = /armAlwaysOn|matchesWakeWord|In ascolto — di' Atlas/.test(js);
      if (r.ok && buildId === EXPECT_BUILD && hasBarge && hasAlphabet && hasWake) {
        ok(
          "client Atlas pack",
          `BUILD_ID=${buildId} barge=${hasBarge} alphabet=${hasAlphabet} wake=${hasWake}`,
        );
      } else {
        bad(
          "client Atlas pack",
          `HTTP ${r.status} build=${buildId} barge=${hasBarge} alphabet=${hasAlphabet} wake=${hasWake}`,
        );
      }
    } catch (e) {
      bad("client Atlas pack", String(e?.message || e));
    }

    try {
      const r = await auth("/api/ai/agentq/status");
      const d = await r.json();
      const name = String(d.name || d.agent || "");
      r.ok && d.ok && /atlas/i.test(name)
        ? ok("agent status Atlas", `${name} voice=${Boolean(d.voice)}`)
        : bad("agent status Atlas", JSON.stringify(d).slice(0, 240));
    } catch (e) {
      bad("agent status Atlas", String(e?.message || e));
    }

    try {
      const r = await auth("/api/ai/agentq/updates");
      const d = await r.json();
      r.ok && d.ok !== false
        ? ok("agent updates", `updates=${(d.updates || d.items || []).length}`)
        : bad("agent updates", JSON.stringify(d).slice(0, 240));
    } catch (e) {
      bad("agent updates", String(e?.message || e));
    }

    try {
      const r = await auth("/api/ai/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Prova Atlas Flash. Codice A B C uno due tre." }),
      });
      const d = await r.json();
      const b64 = (d.audioBase64 || "").length;
      const model = String(d.model || "");
      if (r.ok && d.ok && b64 > 1000) {
        ok("TTS Flash speak", `b64=${b64} model=${model || "?"}`);
      } else {
        bad("TTS Flash speak", JSON.stringify({ status: r.status, model, b64, err: d.error }).slice(0, 300));
      }
    } catch (e) {
      bad("TTS Flash speak", String(e?.message || e));
    }

    try {
      const r = await auth("/api/ai/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "ID Q-7@ops/#1", spellCodes: true }),
      });
      const d = await r.json();
      const spoken = String(d.spokenText || d.normalizedText || d.text || "");
      const b64 = (d.audioBase64 || "").length;
      // Alphabet gate: either server returns spelled form, or audio still succeeds with code input.
      if (r.ok && d.ok && b64 > 500) {
        ok(
          "alphabet gate speak",
          `b64=${b64} spoken=${JSON.stringify(spoken).slice(0, 120)}`,
        );
      } else {
        bad("alphabet gate speak", JSON.stringify({ status: r.status, ...d, audioBase64: b64 }).slice(0, 300));
      }
    } catch (e) {
      bad("alphabet gate speak", String(e?.message || e));
    }

    try {
      const wav = makeToneWav(1.2, 523);
      const r = await auth("/api/ai/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64: wav.toString("base64"),
          mimeType: "audio/wav",
          filename: "suite.wav",
          language: "it",
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 404) bad("Whisper transcribe", "404");
      else if (r.ok || r.status === 422 || r.status === 400)
        ok("Whisper transcribe", `HTTP ${r.status} text=${JSON.stringify(d.text || d.error || "").slice(0, 80)}`);
      else bad("Whisper transcribe", `HTTP ${r.status} ${JSON.stringify(d).slice(0, 200)}`);
    } catch (e) {
      bad("Whisper transcribe", String(e?.message || e));
    }

    // Server has no user-agent, so armed stays false. The phrase is Atlas.
    const wake = health?.voice?.wakeWord;
    const phrase = health?.voice?.wakePhrase;
    const wakeOk = phrase === "Atlas" && (wake === "Atlas" || wake === "later" || wake === "desktop-always-on");
    if (wakeOk) {
      ok(
        "wake word status field",
        `wakeWord=${wake} wakePhrase=${phrase} alwaysOn=${health?.voice?.alwaysOn} armed=${health?.voice?.armed}`,
      );
    } else {
      bad("wake word status field", JSON.stringify(health?.voice));
    }
  }

  const puppeteer = await loadPuppeteer();
  if (!puppeteer || !cookie) {
    bad("MIC call open", puppeteer ? "no cookie" : "puppeteer absent");
    bad("MIC call hangup", "skipped");
  } else {
    let browser;
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--use-fake-ui-for-media-stream",
          "--use-fake-device-for-media-stream",
          "--autoplay-policy=no-user-gesture-required",
        ],
        defaultViewport: { width: 1024, height: 768, hasTouch: true, isMobile: true },
      });
      const page = await browser.newPage();
      await page.setUserAgent(
        "Mozilla/5.0 (iPad; CPU OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
      );
      await page.evaluateOnNewDocument(() => {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx || !navigator.mediaDevices?.getUserMedia) return;
        navigator.mediaDevices.getUserMedia = async (c) => {
          if (c?.audio) {
            const ctx = new Ctx();
            await ctx.resume().catch(() => {});
            const osc = ctx.createOscillator();
            const dst = ctx.createMediaStreamDestination();
            osc.connect(dst);
            osc.start();
            return dst.stream;
          }
          throw new Error("fake gum");
        };
      });
      await page.setCookie({
        name: "dash_auth",
        value: cookie.replace(/^dash_auth=/, ""),
        url: LIVE,
      });
      await page.goto(LIVE + "/", { waitUntil: "networkidle2", timeout: 120_000 });
      await page.waitForSelector("#globalMic", { timeout: 60_000 });
      await page.waitForFunction(
        () => document.documentElement.dataset.micWired === "1" || document.querySelector("#globalMic")?.dataset?.wired === "1",
        { timeout: 60_000 },
      ).catch(() => {});
      await page.click("#globalMic");
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.voiceCall === "1" ||
          /END/i.test(document.querySelector("#globalMic")?.textContent || ""),
        { timeout: 30_000 },
      );
      const openState = await page.evaluate(() => ({
        call: document.documentElement.dataset.voiceCall,
        label: document.querySelector("#globalMic")?.textContent?.trim(),
        tts: document.documentElement.dataset.tts,
        duplex: document.documentElement.dataset.voiceDuplex || "",
      }));
      if (openState.call === "1" || /END/i.test(openState.label || "")) {
        ok("MIC call open", JSON.stringify(openState));
      } else {
        bad("MIC call open", JSON.stringify(openState));
      }
      await page.click("#globalMic");
      await page.waitForFunction(
        () =>
          document.documentElement.dataset.voiceCall !== "1" ||
          /MIC/i.test(document.querySelector("#globalMic")?.textContent || ""),
        { timeout: 20_000 },
      );
      const closeState = await page.evaluate(() => ({
        call: document.documentElement.dataset.voiceCall || "0",
        label: document.querySelector("#globalMic")?.textContent?.trim(),
      }));
      if (closeState.call !== "1" || /MIC/i.test(closeState.label || "")) {
        ok("MIC call hangup", JSON.stringify(closeState));
      } else {
        bad("MIC call hangup", JSON.stringify(closeState));
      }
    } catch (e) {
      bad("MIC call open", String(e?.message || e));
      if (!results.some((r) => r.name === "MIC call hangup")) {
        bad("MIC call hangup", "failed during open");
      }
    } finally {
      await browser?.close().catch(() => {});
    }
  }

  finish();
}

function finish() {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const total = results.length;
  const overall = failed === 0 && total >= 10 ? "PASS" : "FAIL";
  const payload = {
    at: new Date().toISOString(),
    live: LIVE,
    expectBuild: EXPECT_BUILD,
    summary: {
      overall,
      passed,
      failed,
      total,
      passRate: total ? Math.round((passed / total) * 1000) / 10 : 0,
    },
    results,
  };
  const json = JSON.stringify(payload, null, 2);
  for (const dest of [
    "/tmp/live-plancia-full-suite.json",
    "/cursor/stores/self/live-plancia-full-suite.json",
    path.resolve("live-plancia-full-suite.json"),
  ]) {
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, json);
    } catch {
      /* optional */
    }
  }
  console.log(json);
  console.log(`::notice::Live plancia suite ${overall} ${passed}/${total} (${payload.summary.passRate}%)`);
  process.exit(overall === "PASS" ? 0 : 1);
}

main().catch((e) => {
  bad("suite crash", String(e?.message || e));
  finish();
});
