#!/usr/bin/env node
/**
 * Periodic live ops monitor for the Agent Q dashboard.
 *
 * Checks (hard fail unless noted):
 *  1. /health + build
 *  2. Authenticated page load
 *  3. /api/ai/agentq/status
 *  4. /api/ai/agentq/updates (ingress)
 *  5. /api/ai/speak → audio
 *  6. /api/ai/transcribe endpoint (tone wav → text or explicit error ≠ 404)
 *  7. Soft: Puppeteer iPad MIC tap unlocks TTS (skipped if puppeteer missing)
 *
 * Usage:
 *   LIVE_PASS='…' node scripts/live-ops-monitor.mjs
 *
 * Exit 0 PASS / 1 FAIL. Writes JSON report + optional GitHub commit status.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const LIVE = process.env.LIVE_BASE || "https://ops-commerce-dashboard.onrender.com";
const PASS = process.env.LIVE_PASS || process.env.SITE_PASSWORD || "";

const results = [];
const ok = (name, detail = "") => {
  results.push({ name, ok: true, detail });
  console.log(`PASS  ${name}${detail ? ` — ${detail}` : ""}`);
};
const bad = (name, detail = "") => {
  results.push({ name, ok: false, soft: false, detail });
  console.error(`::error::${name} — ${detail}`);
  console.error(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
};
/** Recorded, does not flip the process exit code. */
const soft = (name, detail = "") => {
  results.push({ name, ok: false, soft: true, detail });
  console.warn(`::warning::SOFT ${name} — ${detail}`);
  console.warn(`SOFT  ${name}${detail ? ` — ${detail}` : ""}`);
};

function writeReport(payload) {
  const json = JSON.stringify(payload, null, 2);
  for (const dest of [
    "/tmp/live-ops-monitor-latest.json",
    "/cursor/stores/self/live-ops-monitor-latest.json",
    path.resolve("live-ops-monitor-latest.json"),
  ]) {
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, json);
    } catch {
      /* optional */
    }
  }
  console.log(json);
  return json;
}

async function reportGitHub(payload) {
  const token =
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    (fs.existsSync("/tmp/.gh_token") ? fs.readFileSync("/tmp/.gh_token", "utf8").trim() : "");
  if (!token) return;
  let sha = process.env.GITHUB_SHA || process.env.LIVE_STATUS_SHA || "";
  if (!sha) {
    try {
      sha = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
    } catch {
      return;
    }
  }
  const repo = process.env.GITHUB_REPOSITORY || "lubranoe88-create/ops-Commerce-Dashboard";
  const failed = payload.summary?.hardFailed ?? payload.summary?.failed ?? 0;
  const passed = payload.summary?.passed || 0;
  const softN = payload.summary?.softFailed || 0;
  const state = payload.summary?.overall === "PASS" ? "success" : "failure";
  const res = await fetch(`https://api.github.com/repos/${repo}/statuses/${sha}`, {
    method: "POST",
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "ops-live-ops-monitor",
    },
    body: JSON.stringify({
      state,
      context: "live-ops-monitor",
      description: `${payload.summary?.overall} ${passed} ok / ${failed} fail / ${softN} soft build=${payload.build || "?"}`.slice(
        0,
        140,
      ),
      target_url: LIVE,
    }),
  }).catch((e) => {
    console.error(`::warning::GitHub status post error: ${e?.message || e}`);
    return null;
  });
  if (!res) return;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    console.error(`::warning::GitHub status post failed HTTP ${res.status}: ${body.message || ""}`);
    return;
  }
  console.log(`::notice::GitHub status ${state} context=live-ops-monitor sha=${sha.slice(0, 12)}`);
}

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
        return (await import(pathToFileURL(path.join(base, "lib/esm/puppeteer/puppeteer.js")).href)).default;
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
  if (!res.ok || !m) {
    throw new Error(`login HTTP ${res.status}`);
  }
  return m[0];
}

async function main() {
  if (!PASS) {
    const payload = {
      summary: { overall: "FAIL", reason: "LIVE_PASS missing", passed: 0, failed: 1, total: 1 },
      results: [{ name: "env", ok: false, detail: "missing password" }],
    };
    writeReport(payload);
    process.exit(1);
  }

  let build = "";
  try {
    const health = await fetch(`${LIVE}/health`, { signal: AbortSignal.timeout(20_000) }).then((r) =>
      r.json(),
    );
    build = health.build || "";
    health.ok ? ok("health", build) : bad("health", JSON.stringify(health));
  } catch (e) {
    bad("health", String(e?.message || e));
  }

  let cookie = "";
  try {
    cookie = await loginCookie();
    ok("login", "dash_auth");
  } catch (e) {
    bad("login", String(e?.message || e));
  }

  const auth = (pathName, init = {}) =>
    fetch(`${LIVE}${pathName}`, {
      ...init,
      headers: {
        ...(init.headers || {}),
        Cookie: cookie,
      },
      signal: AbortSignal.timeout(90_000),
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
      const r = await auth("/api/ai/agentq/status");
      const d = await r.json();
      r.ok && d.ok && d.integrated
        ? ok("agentq/status", `${d.name} voice=${Boolean(d.voice)}`)
        : bad("agentq/status", JSON.stringify(d).slice(0, 240));
    } catch (e) {
      bad("agentq/status", String(e?.message || e));
    }

    try {
      const r = await auth("/api/ai/agentq/updates");
      const d = await r.json();
      r.ok && d.ok !== false
        ? ok("agentq/updates", `updates=${(d.updates || d.items || []).length}`)
        : bad("agentq/updates", JSON.stringify(d).slice(0, 240));
    } catch (e) {
      bad("agentq/updates", String(e?.message || e));
    }

    try {
      const r = await auth("/api/ai/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Monitoraggio automatico. Voce di prova." }),
      });
      const d = await r.json();
      const b64 = (d.audioBase64 || "").length;
      r.ok && d.ok && b64 > 1000
        ? ok("TTS /api/ai/speak", `b64=${b64} model=${d.model || "?"}`)
        : bad("TTS /api/ai/speak", JSON.stringify({ status: r.status, ...d, audioBase64: b64 }).slice(0, 300));
    } catch (e) {
      bad("TTS /api/ai/speak", String(e?.message || e));
    }

    try {
      const wav = makeToneWav(1.2, 523);
      const r = await auth("/api/ai/transcribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audioBase64: wav.toString("base64"),
          mimeType: "audio/wav",
          filename: "monitor.wav",
          language: "it",
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.status === 404) bad("Whisper /api/ai/transcribe", "404 endpoint missing");
      else if (r.ok && String(d.text || "").trim())
        ok("Whisper /api/ai/transcribe", JSON.stringify({ text: d.text, model: d.model }).slice(0, 160));
      else if (r.ok || r.status === 422 || r.status === 400)
        ok(
          "Whisper /api/ai/transcribe",
          `endpoint alive HTTP ${r.status} text=${JSON.stringify(d.text || d.error || "").slice(0, 80)}`,
        );
      else bad("Whisper /api/ai/transcribe", `HTTP ${r.status} ${JSON.stringify(d).slice(0, 200)}`);
    } catch (e) {
      bad("Whisper /api/ai/transcribe", String(e?.message || e));
    }
  }

  // Optional iPad MIC. Missing puppeteer, or a browser miss, is a soft fail:
  // exit stays 0 when every hard check passed. Wait until boot() has wired the
  // button — #globalMic exists in HTML before setupMic(), and an early tap
  // leaves data-tts at "0".
  const puppeteer = await loadPuppeteer();
  if (!puppeteer) {
    soft("MIC call session (soft)", "puppeteer absent — skipped");
  } else if (!cookie) {
    soft("MIC call session (soft)", "skipped — login failed");
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
            const gain = ctx.createGain();
            gain.gain.value = 0.2;
            osc.frequency.value = 440;
            const dest = ctx.createMediaStreamDestination();
            osc.connect(gain);
            gain.connect(dest);
            osc.start();
            return dest.stream;
          }
          throw new Error("only audio");
        };
      });
      await page.goto(LIVE, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForSelector("#password", { timeout: 20_000 });
      await page.type("#password", PASS);
      await page.keyboard.press("Enter");
      await page.waitForSelector("#globalMic[data-mic-wired='1']", { timeout: 45_000 });
      await page.evaluate(() => {
        const m = document.getElementById("aiBriefingModal");
        if (m) {
          m.hidden = true;
          m.style.display = "none";
        }
      });
      const tapMic = async () => {
        await page.evaluate(() => {
          const btn = document.getElementById("globalMic");
          const opts = { bubbles: true, cancelable: true, pointerId: 1, pointerType: "touch", button: 0 };
          btn.dispatchEvent(new PointerEvent("pointerdown", opts));
          btn.dispatchEvent(new PointerEvent("pointerup", opts));
          btn.click();
        });
      };
      await tapMic();
      await new Promise((r) => setTimeout(r, 2800));
      const mid = await page.evaluate(() => {
        const btn = document.getElementById("globalMic");
        const span = btn?.querySelector("span");
        return {
          tts: document.documentElement.dataset.tts || "",
          call: document.documentElement.dataset.voiceCall || "",
          phase: document.documentElement.dataset.voicePhase || "",
          micLive: document.body.classList.contains("mic-live"),
          engine: document.documentElement.dataset.micEngine || "",
          label: (span?.textContent || btn?.textContent || "").trim().slice(0, 12),
          wired: btn?.dataset.micWired || "",
          pressed: btn?.getAttribute("aria-pressed") || "",
          bubbles: [...document.querySelectorAll(".bubble, .toast")]
            .map((n) => (n.textContent || "").trim())
            .filter(Boolean)
            .slice(-4),
        };
      });
      // rail-24 continuous call: first tap must open voiceCall + media-recorder-call.
      const callOpen =
        mid.call === "1" &&
        /call/i.test(mid.engine) &&
        mid.tts === "1" &&
        (/END/i.test(mid.label) ||
          (mid.bubbles || []).some((b) => /Chiamata aperta/i.test(b)));
      const detail = JSON.stringify(mid).slice(0, 420);
      if (callOpen) {
        ok("MIC call session (soft)", detail);
        // Hang up and confirm END → MIC.
        await tapMic();
        await new Promise((r) => setTimeout(r, 1000));
        const ended = await page.evaluate(() => ({
          call: document.documentElement.dataset.voiceCall || "",
          label: (
            document.getElementById("globalMic")?.querySelector("span")?.textContent ||
            document.getElementById("globalMic")?.textContent ||
            ""
          )
            .trim()
            .slice(0, 12),
        }));
        if (ended.call === "0") ok("MIC call hangup (soft)", JSON.stringify(ended));
        else soft("MIC call hangup (soft)", JSON.stringify(ended));
      } else if (process.env.MONITOR_STRICT_MIC === "1") {
        bad("MIC call session (soft)", detail);
      } else {
        soft("MIC call session (soft)", detail);
      }
    } catch (e) {
      const detail = String(e?.message || e);
      if (process.env.MONITOR_STRICT_MIC === "1") bad("MIC call session (soft)", detail);
      else soft("MIC call session (soft)", detail);
    } finally {
      if (browser) await browser.close().catch(() => {});
    }
  }

  const passed = results.filter((r) => r.ok).length;
  const hardFailed = results.filter((r) => !r.ok && !r.soft).length;
  const softFailed = results.filter((r) => r.soft && !r.ok).length;
  const payload = {
    at: new Date().toISOString(),
    live: LIVE,
    build: build || null,
    summary: {
      passed,
      failed: hardFailed,
      hardFailed,
      softFailed,
      total: results.length,
      overall: hardFailed === 0 ? "PASS" : "FAIL",
    },
    results,
  };
  writeReport(payload);
  await reportGitHub(payload);
  if (hardFailed) {
    console.error(`::error::overall FAIL ${hardFailed} hard / ${softFailed} soft / ${results.length} checks`);
  } else {
    console.log(`::notice::Live ops monitor PASS (${softFailed} soft)`);
  }
  process.exit(hardFailed ? 1 : 0);
}

main().catch(async (e) => {
  console.error(`::error::fatal ${e?.message || e}`);
  const payload = {
    summary: { overall: "FAIL", reason: String(e), passed: 0, failed: 1, hardFailed: 1, softFailed: 0, total: 1 },
    results: [{ name: "fatal", ok: false, detail: String(e?.stack || e) }],
    live: LIVE,
  };
  writeReport(payload);
  await reportGitHub(payload).catch(() => {});
  process.exit(1);
});
