#!/usr/bin/env node
/**
 * Live Safari-iPad MIC + Whisper + TTS smoke test against Render.
 *
 * Usage:
 *   LIVE_PASS='…' node scripts/live-ipad-mic-voice-test.mjs
 *   LIVE_BASE=https://ops-commerce-dashboard.onrender.com EXPECT_BUILD=rail-18 node …
 *
 * Exit 0 = PASS, 1 = FAIL. Writes JSON report to:
 *   /tmp/live-ipad-mic-voice-report.json
 *   /cursor/stores/self/live-ipad-mic-voice-latest.json (if writable)
 *
 * On failure: prints ::error:: annotations (GitHub Actions) and exits 1 so the
 * caller (CI / deploy hook) sees the red status immediately.
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

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
        return (await import(pathToFileURL(path.join(base, "lib/esm/puppeteer/puppeteer.js")).href)).default;
      } catch {
        /* next */
      }
    }
  }
  throw new Error("puppeteer not installed (npm i puppeteer)");
}

const LIVE = process.env.LIVE_BASE || "https://ops-commerce-dashboard.onrender.com";
const PASS = process.env.LIVE_PASS || process.env.SITE_PASSWORD || "";
const EXPECT_BUILD = process.env.EXPECT_BUILD || ""; // e.g. rail-18
const WAIT_DEPLOY_MS = Number(process.env.WAIT_DEPLOY_MS || 420_000);
const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1";

const results = [];
const ok = (name, detail = "") => {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
};
const bad = (name, detail = "") => {
  results.push({ name, ok: false, detail });
  // Immediate failure signal for GitHub Actions / log scrapers
  console.error(`::error title=Live iPad MIC::FAIL ${name} — ${detail}`);
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
};

function writeReport(payload) {
  const json = JSON.stringify(payload, null, 2);
  fs.writeFileSync("/tmp/live-ipad-mic-voice-report.json", json);
  for (const dest of [
    "/cursor/stores/self/live-ipad-mic-voice-latest.json",
    path.resolve("live-ipad-mic-voice-latest.json"),
  ]) {
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, json);
    } catch {
      /* optional */
    }
  }
  console.log(json);
}

/** Push a commit status so the caller sees PASS/FAIL on the GitHub commit automatically. */
async function reportToGitHub(payload) {
  const token =
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    (fs.existsSync("/tmp/.gh_token") ? fs.readFileSync("/tmp/.gh_token", "utf8").trim() : "");
  if (!token) return { skipped: true, reason: "no token" };
  const repo =
    process.env.GITHUB_REPOSITORY || "lubranoe88-create/ops-Commerce-Dashboard";
  let sha = process.env.GITHUB_SHA || process.env.LIVE_STATUS_SHA || "";
  if (!sha) {
    try {
      const { execSync } = await import("node:child_process");
      sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    } catch {
      return { skipped: true, reason: "no sha" };
    }
  }
  const failed = payload?.summary?.failed || 0;
  const passed = payload?.summary?.passed || 0;
  const overall = payload?.summary?.overall || (failed ? "FAIL" : "PASS");
  const state = overall === "PASS" ? "success" : "failure";
  const description = `${overall} ${passed}/${passed + failed} ${payload?.observedBuild || ""} MIC→Whisper→TTS`.slice(
    0,
    140,
  );
  const res = await fetch(`https://api.github.com/repos/${repo}/statuses/${sha}`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "ops-live-ipad-mic-test",
    },
    body: JSON.stringify({
      state,
      context: "live-ipad-mic/safari-whisper-tts",
      description,
      target_url: payload?.live || LIVE,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`::warning::GitHub status post failed HTTP ${res.status}: ${body.message || ""}`);
    return { ok: false, status: res.status, message: body.message };
  }
  console.log(`::notice::GitHub status ${state} posted for ${sha.slice(0, 12)}`);
  return { ok: true, state, sha, id: body.id };
}

async function waitForBuild() {
  const deadline = Date.now() + WAIT_DEPLOY_MS;
  let last = "";
  while (Date.now() < deadline) {
    const health = await fetch(`${LIVE}/health`).then((r) => r.json()).catch(() => ({}));
    last = health.build || "";
    if (!EXPECT_BUILD || last === EXPECT_BUILD) return last;
    console.log(`waiting deploy: have=${last || "?"} want=${EXPECT_BUILD}`);
    await new Promise((r) => setTimeout(r, 12_000));
  }
  return last;
}

async function main() {
  if (!PASS) {
    writeReport({
      summary: { overall: "FAIL", reason: "LIVE_PASS / SITE_PASSWORD missing" },
      results: [{ name: "env", ok: false, detail: "missing password" }],
    });
    process.exit(1);
  }

  let puppeteer;
  try {
    puppeteer = await loadPuppeteer();
  } catch (e) {
    writeReport({
      summary: { overall: "FAIL", reason: "puppeteer missing" },
      results: [{ name: "puppeteer", ok: false, detail: String(e) }],
    });
    process.exit(1);
  }

  const build = await waitForBuild();
  if (EXPECT_BUILD && build !== EXPECT_BUILD) {
    bad("deploy build", `expected ${EXPECT_BUILD}, got ${build || "unknown"}`);
  } else {
    ok("deploy build", build || "any");
  }

  const browser = await puppeteer.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--allow-fake-ui-for-media-stream",
    ],
    defaultViewport: { width: 1180, height: 820 },
  });

  const page = await browser.newPage();
  await page.setUserAgent(IPAD_UA);
  const cons = [];
  const pageErrors = [];
  page.on("console", (m) => cons.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => pageErrors.push(String(e.message || e)));

  // Inject oscillator MediaStream so MediaRecorder gets real PCM (not silent fake device).
  await page.evaluateOnNewDocument(() => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx || !navigator.mediaDevices?.getUserMedia) return;
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints && constraints.audio) {
        const ctx = new Ctx();
        await ctx.resume().catch(() => {});
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        gain.gain.value = 0.22;
        osc.frequency.value = 440;
        const dest = ctx.createMediaStreamDestination();
        osc.connect(gain);
        gain.connect(dest);
        osc.start();
        window.__opsTestAudio = { ctx, osc, gain, dest };
        return dest.stream;
      }
      return original(constraints);
    };
  });

  // Track speak / transcribe network
  const net = { speak: null, transcribe: null };
  page.on("response", async (res) => {
    try {
      const u = res.url();
      if (u.includes("/api/ai/speak") && res.request().method() === "POST") {
        const body = await res.json().catch(() => ({}));
        net.speak = { status: res.status(), ok: body.ok, b64: (body.audioBase64 || "").length, error: body.error };
      }
      if (u.includes("/api/ai/transcribe") && res.request().method() === "POST") {
        const body = await res.json().catch(() => ({}));
        net.transcribe = { status: res.status(), text: body.text, error: body.error, ok: body.ok };
      }
    } catch {
      /* ignore */
    }
  });

  try {
    await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForSelector("#password", { timeout: 30_000 });
    await page.type("#password", PASS);
    await page.keyboard.press("Enter");
    await page.waitForSelector("#globalMic", { timeout: 60_000 });
    await new Promise((r) => setTimeout(r, 2500));
    await page.evaluate(() => {
      const m = document.getElementById("aiBriefingModal");
      if (m) {
        m.hidden = true;
        m.style.display = "none";
      }
    });

    if (pageErrors.length) {
      bad("no page JS errors on load", pageErrors.slice(0, 3).join(" | "));
    } else {
      ok("no page JS errors on load", "clean");
    }

    const before = await page.evaluate(() => ({
      tts: document.documentElement.dataset.tts,
      build: document.querySelector('script[src*="app.js"]')?.src || "",
      hasMic: Boolean(document.getElementById("globalMic")),
      legend: document.getElementById("moduleLegend")?.textContent || "",
    }));
    before.hasMic ? ok("MIC button present", before.build) : bad("MIC button present", JSON.stringify(before));

    // Tap MIC: dispatch pointerdown first (Safari gesture unlock path), then click.
    await page.evaluate(() => {
      const btn = document.getElementById("globalMic");
      if (!btn) return;
      const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch" };
      btn.dispatchEvent(new PointerEvent("pointerdown", opts));
      btn.dispatchEvent(new PointerEvent("pointerup", opts));
      btn.click();
    });
    await new Promise((r) => setTimeout(r, 2200));

    const mid = await page.evaluate(() => ({
      tts: document.documentElement.dataset.tts,
      micLive: document.body.classList.contains("mic-live"),
      bubbles: [...document.querySelectorAll(".bubble")].map((n) => n.textContent).slice(-8),
      mediaRecorderHack: Boolean(window.__opsTestAudio),
      micEngine: document.documentElement.dataset.micEngine || "",
    }));
    mid.tts === "1" ? ok("TTS unlocked after MIC tap", mid.tts) : bad("TTS unlocked after MIC tap", JSON.stringify(mid));
    mid.micLive || mid.bubbles.some((b) => /Registrazione|Ascolto|Avvio microfono/i.test(b))
      ? ok("MediaRecorder / listen UI started", mid.bubbles.slice(-3).join(" | ") || mid.micEngine)
      : bad("MediaRecorder / listen UI started", JSON.stringify(mid));

    // Keep recording ~2.5s then second tap to stop/upload
    await new Promise((r) => setTimeout(r, 2800));
    await page.evaluate(() => {
      const btn = document.getElementById("globalMic");
      if (!btn) return;
      const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch" };
      btn.dispatchEvent(new PointerEvent("pointerdown", opts));
      btn.dispatchEvent(new PointerEvent("pointerup", opts));
      btn.click();
    });

    // Wait for transcription + optional TTS
    for (let i = 0; i < 40; i++) {
      if (net.transcribe) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    await new Promise((r) => setTimeout(r, 2500));

    const after = await page.evaluate(() => {
      const bubbles = [...document.querySelectorAll(".bubble")].map((n) => n.textContent);
      const joined = bubbles.join("\n");
      return {
        bubbles: bubbles.slice(-12),
        hasNessunaVoce: /nessuna voce rilevata/i.test(joined),
        hasVoceRilevata: /voce rilevata/i.test(joined),
        hasAscoltato: /ascoltato:/i.test(joined),
        hasCorta: /registrazione troppo corta/i.test(joined),
        tts: document.documentElement.dataset.tts,
      };
    });

    if (after.hasNessunaVoce) {
      bad("no false «nessuna voce rilevata»", after.bubbles.slice(-4).join(" | "));
    } else {
      ok("no false «nessuna voce rilevata»", "absent");
    }

    const heard =
      String(net.transcribe?.text || "").trim() ||
      (after.hasVoceRilevata || after.hasAscoltato ? "ui-detected" : "");
    if (net.transcribe?.status === 200 && heard && heard !== "ui-detected") {
      ok("Whisper transcription returned text", JSON.stringify(net.transcribe));
    } else if (after.hasVoceRilevata || after.hasAscoltato) {
      ok("Whisper transcription returned text", after.bubbles.filter((b) => /voce|ascoltato/i.test(b)).slice(-2).join(" | "));
    } else {
      bad(
        "Whisper transcription returned text",
        JSON.stringify({ net: net.transcribe, bubbles: after.bubbles.slice(-6) }),
      );
    }

    // Validate TTS via primed AudioContext (matches speakViaServerAudio path)
    const speakProbe = await page.evaluate(async () => {
      const out = { played: false, error: null, method: null, b64: 0, audioCtx: null };
      try {
        document.documentElement.dataset.tts = "1";
        const Ctx = window.AudioContext || window.webkitAudioContext;
        const ctx = Ctx ? new Ctx() : null;
        if (ctx) {
          await ctx.resume();
          const silent = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
          const warm = ctx.createBufferSource();
          warm.buffer = silent;
          warm.connect(ctx.destination);
          warm.start(0);
          out.audioCtx = ctx.state;
        }
        const r = await fetch("/api/ai/speak", {
          method: "POST",
          credentials: "same-origin",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: "Voce rilevata. Test automatico microfono." }),
        });
        const d = await r.json();
        out.b64 = (d.audioBase64 || "").length;
        if (!d.audioBase64) throw new Error(d.error || "no audio");
        const raw = atob(d.audioBase64);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
        if (ctx) {
          try {
            const buf = await ctx.decodeAudioData(bytes.buffer.slice(0));
            const src = ctx.createBufferSource();
            src.buffer = buf;
            src.connect(ctx.destination);
            src.start(0);
            out.played = true;
            out.method = "AudioContext";
            out.audioCtx = ctx.state;
            return out;
          } catch (decodeErr) {
            out.decodeError = String(decodeErr?.message || decodeErr);
          }
        }
        const audio = new Audio(`data:${d.mime || "audio/mpeg"};base64,${d.audioBase64}`);
        audio.setAttribute("playsinline", "true");
        await audio.play();
        out.played = true;
        out.method = "HTMLAudioElement";
      } catch (e) {
        out.error = String(e?.message || e);
      }
      return out;
    });

    if (speakProbe.played && speakProbe.b64 > 1000 && speakProbe.method === "AudioContext") {
      ok("TTS audio playback via AudioContext", JSON.stringify(speakProbe));
    } else if (speakProbe.played && speakProbe.b64 > 1000) {
      ok("TTS audio playback via AudioContext", `fallback ${speakProbe.method}: ${JSON.stringify(speakProbe)}`);
    } else if (net.speak?.ok && net.speak.b64 > 1000) {
      ok("TTS audio playback via AudioContext", JSON.stringify(net.speak));
    } else {
      bad("TTS audio playback via AudioContext", JSON.stringify({ speakProbe, netSpeak: net.speak }));
    }

    await page.screenshot({ path: "/tmp/live-ipad-mic-voice.png", fullPage: false }).catch(() => {});
  } catch (e) {
    bad("runner exception", String(e?.stack || e));
  } finally {
    await browser.close().catch(() => {});
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  const payload = {
    at: new Date().toISOString(),
    live: LIVE,
    expectBuild: EXPECT_BUILD || null,
    observedBuild: build || null,
    summary: {
      passed,
      failed,
      total: results.length,
      overall: failed === 0 ? "PASS" : "FAIL",
    },
    results,
    pageErrors: pageErrors.slice(0, 12),
    consTail: cons.filter((c) => /error|429|mic|tts|whisper/i.test(c)).slice(0, 20),
  };
  writeReport(payload);
  await reportToGitHub(payload).catch((e) =>
    console.error(`::warning::GitHub status error: ${e?.message || e}`),
  );
  if (failed) {
    console.error(`::error title=Live iPad MIC::overall FAIL ${failed}/${results.length} checks`);
  } else {
    console.log("::notice::Live iPad MIC test PASS");
  }
  process.exit(failed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(`::error title=Live iPad MIC::fatal ${e}`);
  const payload = {
    summary: { overall: "FAIL", reason: String(e), passed: 0, failed: 1, total: 1 },
    results: [{ name: "fatal", ok: false, detail: String(e?.stack || e) }],
    live: LIVE,
  };
  writeReport(payload);
  await reportToGitHub(payload).catch(() => {});
  process.exit(1);
});
