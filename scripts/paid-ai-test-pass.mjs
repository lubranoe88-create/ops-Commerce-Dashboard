#!/usr/bin/env node
/**
 * One full paid-AI test pass: API + busy mark + mic wiring.
 * Exit 0 on pass. Usage: node scripts/paid-ai-test-pass.mjs [passN]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE = process.env.TEST_BASE || "http://127.0.0.1:8787";
const PASS_LABEL = process.argv[2] || "pass";
const results = [];

function envPass() {
  const envPath = path.join(ROOT, "backend/.env");
  const raw = fs.readFileSync(envPath, "utf8");
  const m = raw.match(/^SITE_PASSWORD=(.*)$/m);
  return (m?.[1] || "").trim();
}

async function jarLogin() {
  const jar = `/tmp/ops-test-${PASS_LABEL}.cj`;
  fs.writeFileSync(jar, "");
  const pass = envPass();
  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: pass }),
    redirect: "manual",
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  if (!cookie && res.status !== 302 && res.status !== 200) {
    throw new Error(`login failed ${res.status}`);
  }
  fs.writeFileSync(jar, cookie);
  return cookie;
}

async function api(cookie, pathName, opts = {}) {
  const res = await fetch(`${BASE}${pathName}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie,
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail: String(detail || "") });
  const mark = ok ? "PASS" : "FAIL";
  console.log(`${mark} · ${name}${detail ? ` — ${detail}` : ""}`);
}

async function runApiChecks(cookie) {
  const health = await fetch(`${BASE}/health`).then((r) => r.json());
  check("health ok", health.ok === true, `entitlement=${health.aiEntitlement}`);
  check("health models", Boolean(health.routerModel && health.grokModel));

  const st = await api(cookie, "/api/ai/status");
  check("ai status paid", st.status === 200 && st.data.paid === true, `cap=${st.data.dailyBudgetEur}`);
  check("ai budget present", Number.isFinite(st.data.budget?.capEur));

  const cat = await api(cookie, "/api/ai/actions/catalog");
  check("actions catalog", Array.isArray(cat.data.actions) && cat.data.actions.includes("map"));

  const news = await api(cookie, "/api/ai/news");
  check(
    "mechanical news",
    news.status === 200 && Array.isArray(news.data.news) && news.data.news.length > 0,
    `n=${news.data.news?.length || 0}`,
  );

  const briefBad = await api(cookie, "/api/ai/briefing", {
    method: "POST",
    body: JSON.stringify({}),
  });
  check("briefing requires Q1–Q3", briefBad.status === 400 && briefBad.data.needQuestions === true);

  const turn = await api(cookie, "/api/ai/turn", {
    method: "POST",
    body: JSON.stringify({
      message: "ciao",
      q1: "monitor",
      q2: "mappa",
      q3: "coverage",
    }),
  });
  check(
    "ai turn responds",
    turn.status === 200 && typeof turn.data.reply === "string",
    `tier=${turn.data.tier} blocked=${Boolean(turn.data.blocked)}`,
  );

  const browser = await api(cookie, "/api/ai/browser-use", {
    method: "POST",
    body: JSON.stringify({ goal: "click map" }),
  });
  check("browser-use scaffold 501", browser.status === 501);
}

async function runUiBusyAndMic(cookie) {
  const html = await fetch(`${BASE}/`, { headers: { Cookie: cookie } }).then((r) => r.text());
  check("busy mark in HTML", html.includes('id="aiBusyMark"') && html.includes("ai-busy-check"));
  check("briefing modal in HTML", html.includes('id="aiBriefingModal"') && html.includes("aiQ1"));
  check("aiAgentUi script import path", html.includes("paid-ai-1"));

  const css = await fetch(`${BASE}/css/app.css`, { headers: { Cookie: cookie } }).then((r) => r.text());
  check("busy CSS pulse", css.includes(".ai-busy-mark") && css.includes("ai-busy-pulse"));

  const js = await fetch(`${BASE}/js/aiAgentUi.js`, { headers: { Cookie: cookie } }).then((r) => r.text());
  check("setAiBusy export", js.includes("export function setAiBusy") && js.includes("heartbeatTimer"));
  check("busy depth latch", js.includes("busyDepth"));

  const app = await fetch(`${BASE}/js/app.js`, { headers: { Cookie: cookie } }).then((r) => r.text());
  check("app wires paid AI", app.includes("initPaidAi") && app.includes("runPaidAiTurn"));
  check("app wires busy actions", app.includes("wireActionRunner") && app.includes("updateNewsPins"));
  check("mic shared controller", app.includes("globalMicControl") && app.includes("setupMic"));

  // Headless Chrome: busy mark toggle + mic button presence (no real speech in CI)
  const chrome = "/usr/local/bin/google-chrome";
  if (!fs.existsSync(chrome)) {
    check("chrome mic e2e", false, "google-chrome missing");
    return;
  }

  const runner = `
    const puppeteer = await import("puppeteer-core");
    const browser = await puppeteer.default.launch({
      executablePath: ${JSON.stringify(chrome)},
      headless: "new",
      args: ["--no-sandbox", "--disable-gpu", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    });
    try {
      const page = await browser.newPage();
      await page.setCookie(...${JSON.stringify(
        cookie
          .split(";")
          .map((p) => p.trim())
          .filter(Boolean)
          .map((pair) => {
            const i = pair.indexOf("=");
            return {
              name: pair.slice(0, i),
              value: pair.slice(i + 1),
              domain: "127.0.0.1",
              path: "/",
            };
          }),
      )});
      await page.goto(${JSON.stringify(BASE + "/")}, { waitUntil: "networkidle2", timeout: 60000 });
      await page.waitForSelector("#aiBusyMark", { timeout: 20000 });
      const before = await page.$eval("#aiBusyMark", (el) => ({
        hidden: el.hidden,
        on: el.classList.contains("is-on"),
      }));
      await page.evaluate(async () => {
        const m = await import("/js/aiAgentUi.js?v=paid-ai-1");
        m.setAiBusy(true);
      });
      await new Promise((r) => setTimeout(r, 400));
      const during = await page.$eval("#aiBusyMark", (el) => ({
        hidden: el.hidden,
        on: el.classList.contains("is-on"),
        body: document.body.dataset.aiBusy,
      }));
      await page.evaluate(async () => {
        const m = await import("/js/aiAgentUi.js?v=paid-ai-1");
        m.setAiBusy(false);
      });
      await new Promise((r) => setTimeout(r, 300));
      const after = await page.$eval("#aiBusyMark", (el) => ({
        hidden: el.hidden,
        on: el.classList.contains("is-on"),
        body: document.body.dataset.aiBusy,
      }));
      const mic = await page.$eval("#globalMic", (el) => ({
        present: true,
        pressed: el.getAttribute("aria-pressed"),
      }));
      const dockMic = await page.$('#holoVoicePlancia [data-holo-action="mic"]');
      // Fake media stream: click MIC and confirm live UI attempts (may end quickly headless)
      await page.click("#globalMic");
      await new Promise((r) => setTimeout(r, 900));
      const micLive = await page.evaluate(() => ({
        bodyLive: document.body.classList.contains("mic-live"),
        aria: document.getElementById("globalMic")?.getAttribute("aria-pressed"),
        sr: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
      }));
      console.log(JSON.stringify({ before, during, after, mic, dockMic: Boolean(dockMic), micLive }));
    } finally {
      await browser.close();
    }
  `;

  const scriptPath = `/tmp/busy-mic-${PASS_LABEL}.mjs`;
  fs.writeFileSync(scriptPath, runner);

  // Ensure puppeteer-core
  await new Promise((resolve, reject) => {
    const p = spawn("npm", ["install", "--no-save", "puppeteer-core@23"], {
      cwd: "/tmp",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let err = "";
    p.stderr.on("data", (d) => {
      err += d;
    });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(err || "npm fail"))));
  }).catch((e) => {
    check("puppeteer-core install", false, e.message);
  });

  const out = await new Promise((resolve) => {
    const p = spawn("node", [scriptPath], {
      cwd: "/tmp",
      env: { ...process.env, NODE_PATH: "/tmp/node_modules" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (d) => {
      stdout += d;
    });
    p.stderr.on("data", (d) => {
      stderr += d;
    });
    p.on("exit", (code) => resolve({ code, stdout, stderr }));
  });

  let payload = null;
  try {
    const line = out.stdout.trim().split("\n").filter(Boolean).pop();
    payload = JSON.parse(line);
  } catch {
    payload = null;
  }
  check(
    "busy appears while working",
    payload && payload.during?.on === true && payload.during?.body === "1" && payload.during?.hidden === false,
    payload ? JSON.stringify(payload.during) : out.stderr.slice(0, 180),
  );
  check(
    "busy disappears when idle",
    payload && (payload.after?.on === false || payload.after?.hidden === true) && payload.after?.body !== "1",
    payload ? JSON.stringify(payload.after) : "",
  );
  check("mic button present", payload?.mic?.present === true && payload?.dockMic === true);
  check(
    "mic e2e recognition path",
    payload?.micLive?.sr === true,
    payload ? `sr=${payload.micLive.sr} live=${payload.micLive.bodyLive}` : out.stderr.slice(0, 120),
  );
}

async function main() {
  console.log(`\n=== ${PASS_LABEL} @ ${BASE} ===`);
  const cookie = await jarLogin();
  await runApiChecks(cookie);
  await runUiBusyAndMic(cookie);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${PASS_LABEL} summary: ${results.length - failed.length}/${results.length} passed`);
  if (failed.length) {
    console.error("Failures:", failed.map((f) => f.name).join(", "));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
