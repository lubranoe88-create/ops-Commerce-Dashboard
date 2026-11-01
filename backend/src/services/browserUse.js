/**
 * Spawns the Python headless Chrome worker for browser-use fallback.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { canUseBrowserAutomation, getBudgetStatus } from "./aiBudget.js";
import { isAiPaid } from "../middleware/aiPaidGate.js";
import {
  applyBrowserUseRuntimeEnv,
  browserUseChildEnv,
  probeBrowserUsePython,
  resolveBrowserUsePython,
  resolveChromiumExecutable,
} from "./browserUseRuntime.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.resolve(__dirname, "../../workers/browser_use_worker.py");

const hits = [];
applyBrowserUseRuntimeEnv();

function rateLimitOk() {
  const now = Date.now();
  while (hits.length && now - hits[0] > 60_000) hits.shift();
  if (hits.length >= config.browserUseRateLimitPerMin) return false;
  hits.push(now);
  return true;
}

export function browserUseStatus(req = null) {
  const paid = isAiPaid();
  const budgetGate = canUseBrowserAutomation();
  const workerPresent = fs.existsSync(WORKER);
  const py = probeBrowserUsePython();
  const available =
    paid &&
    config.browserUseEnabled &&
    budgetGate.ok &&
    workerPresent &&
    py.ok;
  let reason = "ok";
  if (!paid) reason = "free_tier";
  else if (!config.browserUseEnabled) reason = "disabled";
  else if (!budgetGate.ok) reason = budgetGate.reason;
  else if (!workerPresent) reason = "worker_missing";
  else if (!py.ok) reason = "python_missing";
  const allowOrigin = req
    ? // lazy import avoided — caller may pass resolved origin string via req._buOrigin
      req._buOrigin || config.browserUseAllowOrigin
    : config.browserUseAllowOrigin;
  return {
    available,
    reason,
    python: py,
    minRemainingEur: config.aiBrowserUseMinRemainingEur,
    allowOrigin,
    rateLimitPerMin: config.browserUseRateLimitPerMin,
    budget: getBudgetStatus(),
    worker: WORKER,
  };
}

function runPython(payload, timeoutMs = 70000) {
  return new Promise((resolve) => {
    const pythonBin = resolveBrowserUsePython();
    const chrome = resolveChromiumExecutable();
    const body = chrome ? { ...payload, chromePath: chrome } : { ...payload };
    const env = browserUseChildEnv({
      BROWSER_USE_ALLOW_ORIGIN: body.allowOrigin || config.browserUseAllowOrigin,
      BROWSER_USE_AUDIT_DIR:
        process.env.BROWSER_USE_AUDIT_DIR ||
        path.resolve(__dirname, "../../data/browser-use-audit"),
    });
    if (chrome) env.CHROME_PATH = chrome;
    const child = spawn(pythonBin, [WORKER], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve({
        ok: false,
        code: "TIMEOUT",
        error: "browser-use worker timed out",
        stderr: stderr.slice(0, 400),
      });
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: "SPAWN_ERROR", error: err.message });
    });
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const parsed = JSON.parse(stdout.trim() || "{}");
        resolve(parsed);
      } catch {
        resolve({
          ok: false,
          code: "BAD_WORKER_OUTPUT",
          error: "worker returned non-JSON",
          stdout: stdout.slice(0, 400),
          stderr: stderr.slice(0, 400),
        });
      }
    });
    child.stdin.write(JSON.stringify(body));
    child.stdin.end();
  });
}

export function resolveAllowOrigin(req) {
  const configured = config.browserUseAllowOrigin || "";
  // Prefer explicit public URL; otherwise derive from the live request (Render).
  if (configured && !/localhost|127\.0\.0\.1/i.test(configured)) return configured.replace(/\/$/, "");
  const xfProto = String(req?.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
  const xfHost = String(req?.headers?.["x-forwarded-host"] || "").split(",")[0].trim();
  const host = xfHost || String(req?.headers?.host || "").trim();
  const proto = xfProto || (req?.secure ? "https" : "http") || "https";
  if (host) return `${proto}://${host}`.replace(/\/$/, "");
  return (configured || "http://127.0.0.1:8787").replace(/\/$/, "");
}

export async function runBrowserUse({
  goal,
  selector,
  path: pagePath = "/",
  url = "",
  maxSteps = 1,
  cookie = "",
  allowOrigin = null,
} = {}) {
  if (!isAiPaid()) {
    const err = new Error("browser-use requires paid AI tier");
    err.status = 402;
    err.code = "AI_PAYMENT_REQUIRED";
    throw err;
  }
  if (!config.browserUseEnabled) {
    const err = new Error("browser-use disabled");
    err.status = 501;
    err.code = "BROWSER_USE_DISABLED";
    throw err;
  }
  const gate = canUseBrowserAutomation();
  if (!gate.ok) {
    const err = new Error(
      `browser-use blocked: need ≥ €${config.aiBrowserUseMinRemainingEur} remaining under cap`,
    );
    err.status = 429;
    err.code = "BROWSER_USE_BUDGET_FLOOR";
    err.budget = gate.budget;
    throw err;
  }
  if (!rateLimitOk()) {
    const err = new Error("browser-use rate limit exceeded");
    err.status = 429;
    err.code = "BROWSER_USE_RATE_LIMIT";
    throw err;
  }
  if (!fs.existsSync(WORKER)) {
    const err = new Error("browser-use worker missing");
    err.status = 501;
    err.code = "BROWSER_USE_UNAVAILABLE";
    throw err;
  }
  const py = probeBrowserUsePython();
  if (!py.ok) {
    const err = new Error(py.detail || "python runtime missing for browser-use");
    err.status = 501;
    err.code = "SPAWN_ERROR";
    throw err;
  }

  const origin = allowOrigin || config.browserUseAllowOrigin;
  const steps = Math.max(1, Math.min(3, Number(maxSteps) || 1));
  const result = await runPython({
    goal,
    selector,
    path: pagePath,
    url: String(url || "").trim().slice(0, 500),
    maxSteps: steps,
    cookie,
    allowOrigin: origin,
  });
  return {
    ...result,
    budget: getBudgetStatus(),
    status: browserUseStatus(),
  };
}
