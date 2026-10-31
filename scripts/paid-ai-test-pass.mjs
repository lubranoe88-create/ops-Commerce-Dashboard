#!/usr/bin/env node
/**
 * Full paid-AI test pass (≥22 checks). Usage: node scripts/paid-ai-test-pass.mjs [passN]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE = process.env.TEST_BASE || "http://127.0.0.1:8787";
const PASS_LABEL = process.argv[2] || "pass";
const DB = "/agent/backend/data/memory.sqlite";
const results = [];

function envPass() {
  const raw = fs.readFileSync(path.join(ROOT, "backend/.env"), "utf8");
  return (raw.match(/^SITE_PASSWORD=(.*)$/m)?.[1] || "").trim();
}

function resetUsageLedger() {
  spawnSync(
    "node",
    [
      "--input-type=module",
      "-e",
      `import { DatabaseSync } from "node:sqlite"; const db=new DatabaseSync(${JSON.stringify(DB)}); try{db.exec("DELETE FROM ai_usage_events");db.exec("DELETE FROM ai_usage_daily");}catch(e){}`,
    ],
    { stdio: "ignore" },
  );
}

async function jarLogin() {
  const pass = envPass();
  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ password: pass }),
    redirect: "manual",
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  return setCookie.map((c) => c.split(";")[0]).join("; ");
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
  console.log(`${ok ? "PASS" : "FAIL"} · ${name}${detail ? ` — ${detail}` : ""}`);
}

async function runApiChecks(cookie) {
  const health = await fetch(`${BASE}/health`).then((r) => r.json());
  check("health ok", health.ok === true, `entitlement=${health.aiEntitlement}`);
  check("health models", Boolean(health.routerModel && health.grokModel));

  const st = await api(cookie, "/api/ai/status");
  check("ai status paid", st.status === 200 && st.data.paid === true, `cap=${st.data.dailyBudgetEur}`);
  check("ai budget present", Number.isFinite(st.data.budget?.capEur));
  check(
    "usage framing hard_cap",
    st.data.budget?.framing === "hard_cap_not_target" ||
      String(st.data.budget?.note || "").includes("never burn"),
  );

  const usage = await api(cookie, "/api/ai/usage");
  check(
    "usage admin remaining",
    usage.status === 200 &&
      Number.isFinite(usage.data.budget?.remainingEur) &&
      String(usage.data.message || "").includes("Remaining under cap"),
    `rem=${usage.data.budget?.remainingEur}`,
  );
  check(
    "soft/hard ratios",
    usage.data.budget?.softRatio >= 0.7 && usage.data.budget?.hardRatio >= 0.95,
  );

  const cat = await api(cookie, "/api/ai/actions/catalog");
  const actions = cat.data.actions || [];
  check(
    "actions catalog complete",
    actions.includes("map") &&
      actions.includes("focus-top") &&
      actions.includes("inspect") &&
      actions.includes("correct") &&
      actions.includes("note") &&
      actions.includes("accept-suggestion"),
    `n=${actions.length}`,
  );

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
    turn.status === 200 && typeof turn.data.reply === "string" && "route" in turn.data,
    `route=${turn.data.route} tier=${turn.data.tier}`,
  );

  const mem = await api(cookie, "/api/ai/client-memory", {
    method: "POST",
    body: JSON.stringify({
      payload: { notes: [{ note: "test-mem" }], goals: { q1: "a", q2: "b", q3: "c" } },
    }),
  });
  check("client-memory sync", mem.status === 200 && mem.data.ok === true);

  const note = await api(cookie, "/api/ai/actions/execute", {
    method: "POST",
    body: JSON.stringify({
      action: { type: "note", business_key: "biz1", text: "n" },
      confirmed: true,
    }),
  });
  check("write note", note.status === 200 && note.data.ok === true);

  const correct = await api(cookie, "/api/ai/actions/execute", {
    method: "POST",
    body: JSON.stringify({
      action: { type: "correct", business_key: "biz1", verdict: "correct" },
    }),
  });
  check("correct needs confirm", correct.status === 409 && correct.data.needsConfirm === true);

  const goals = await api(cookie, "/api/ai/actions/execute", {
    method: "POST",
    body: JSON.stringify({
      action: { type: "set-goals", q1: "A", q2: "B", q3: "C" },
      confirmed: true,
    }),
  });
  check("set-goals write", goals.status === 200 && goals.data.ok === true);

  const pro = await api(cookie, "/api/ai/proactive/poll");
  check(
    "proactive poll",
    pro.status === 200 && pro.data.tts?.mode === "opt_in" && pro.data.tts?.enabled === false,
  );

  const tts = await api(cookie, "/api/ai/proactive/tts", {
    method: "POST",
    body: JSON.stringify({ enabled: false }),
  });
  check("proactive tts opt-in endpoint", tts.status === 200 && tts.data.ok === true);

  // browser-use works when remaining >= 3 (fresh ledger)
  const bu = await api(cookie, "/api/ai/browser-use", {
    method: "POST",
    body: JSON.stringify({ goal: "apri mappa", path: "/" }),
  });
  check(
    "browser-use worker",
    bu.status === 200 && bu.data.ok === true && bu.data.clicked === true,
    `clicked=${bu.data.clicked} code=${bu.data.code || ""}`,
  );

  const softSpend = await api(cookie, "/api/ai/test/spend", {
    method: "POST",
    body: JSON.stringify({ eur: 7.6, note: "soft_band_test" }),
  });
  check(
    "soft band blocks main",
    softSpend.status === 200 &&
      softSpend.data.softBlocked === true &&
      softSpend.data.hardBlocked === false,
    `ratio=${softSpend.data.ratio}`,
  );

  const hardSpend = await api(cookie, "/api/ai/test/spend", {
    method: "POST",
    body: JSON.stringify({ eur: 2.0, note: "hard_band_test" }),
  });
  check(
    "hard band / zero remaining",
    hardSpend.status === 200 &&
      (hardSpend.data.hardBlocked === true || hardSpend.data.zeroRemaining === true),
    `rem=${hardSpend.data.remainingEur}`,
  );

  const buFloor = await api(cookie, "/api/ai/browser-use", {
    method: "POST",
    body: JSON.stringify({ goal: "mappa" }),
  });
  check(
    "browser-use budget floor",
    buFloor.status === 429 && buFloor.data.code === "BROWSER_USE_BUDGET_FLOOR",
    `status=${buFloor.status}`,
  );

  const html = await fetch(`${BASE}/`, { headers: { Cookie: cookie } }).then((r) => r.text());
  check("busy mark in HTML", html.includes('id="aiBusyMark"') && html.includes("ai-busy-check"));
  check("briefing modal in HTML", html.includes('id="aiBriefingModal"') && html.includes("aiQ1"));
  check("aiAgentUi script import path", html.includes("paid-ai-2"));

  const css = await fetch(`${BASE}/css/app.css`, { headers: { Cookie: cookie } }).then((r) =>
    r.text(),
  );
  check("busy CSS pulse", css.includes(".ai-busy-mark") && css.includes("ai-busy-pulse"));

  const js = await fetch(`${BASE}/js/aiAgentUi.js`, { headers: { Cookie: cookie } }).then((r) =>
    r.text(),
  );
  check("setAiBusy export", js.includes("export function setAiBusy") && js.includes("heartbeatTimer"));
  check("busy depth latch", js.includes("busyDepth"));
  check("client memory sync export", js.includes("syncClientMemoryToServer"));
  check("proactive polling export", js.includes("startProactivePolling"));

  const app = await fetch(`${BASE}/js/app.js`, { headers: { Cookie: cookie } }).then((r) => r.text());
  check("app wires paid AI", app.includes("initPaidAi") && app.includes("runPaidAiTurn"));
  check("app wires busy actions", app.includes("wireActionRunner") && app.includes("updateNewsPins"));
  check("mic shared controller", app.includes("globalMicControl") && app.includes("setupMic"));
  check("focus-top + inspect actions", app.includes('"focus-top"') || app.includes("case \"focus-top\""));
}

async function runUiBusyAndMic(cookie) {
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
      await page.evaluate(() => {
        const m = document.getElementById("aiBriefingModal");
        if (m) m.hidden = true;
      });
      await page.evaluate(async () => {
        const m = await import("/js/aiAgentUi.js?v=paid-ai-2");
        m.setAiBusy(true);
      });
      await new Promise((r) => setTimeout(r, 400));
      const during = await page.$eval("#aiBusyMark", (el) => ({
        hidden: el.hidden,
        on: el.classList.contains("is-on"),
        body: document.body.dataset.aiBusy,
      }));
      await page.evaluate(async () => {
        const m = await import("/js/aiAgentUi.js?v=paid-ai-2");
        m.setAiBusy(false);
      });
      await new Promise((r) => setTimeout(r, 300));
      const after = await page.$eval("#aiBusyMark", (el) => ({
        hidden: el.hidden,
        on: el.classList.contains("is-on"),
        body: document.body.dataset.aiBusy,
      }));
      const mic = await page.$eval("#globalMic", (el) => ({ present: true }));
      const dockMic = await page.$('#holoVoicePlancia [data-holo-action="mic"]');
      await page.click("#globalMic");
      await new Promise((r) => setTimeout(r, 900));
      const micLive = await page.evaluate(() => ({
        bodyLive: document.body.classList.contains("mic-live"),
        sr: Boolean(window.SpeechRecognition || window.webkitSpeechRecognition),
      }));
      console.log(JSON.stringify({ during, after, mic, dockMic: Boolean(dockMic), micLive }));
    } finally {
      await browser.close();
    }
  `;

  const scriptPath = `/tmp/busy-mic-${PASS_LABEL}.mjs`;
  fs.writeFileSync(scriptPath, runner);

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
    p.on("exit", () => resolve({ stdout, stderr }));
  });

  let payload = null;
  try {
    payload = JSON.parse(out.stdout.trim().split("\n").filter(Boolean).pop());
  } catch {
    payload = null;
  }
  check(
    "busy appears while working",
    payload && payload.during?.on === true && payload.during?.body === "1",
    payload ? JSON.stringify(payload.during) : out.stderr.slice(0, 180),
  );
  check(
    "busy disappears when idle",
    payload &&
      (payload.after?.on === false || payload.after?.hidden === true) &&
      payload.after?.body !== "1",
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
  resetUsageLedger();
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
