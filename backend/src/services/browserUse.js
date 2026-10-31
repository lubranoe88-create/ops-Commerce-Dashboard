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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.resolve(__dirname, "../../workers/browser_use_worker.py");

const hits = [];

function rateLimitOk() {
  const now = Date.now();
  while (hits.length && now - hits[0] > 60_000) hits.shift();
  if (hits.length >= config.browserUseRateLimitPerMin) return false;
  hits.push(now);
  return true;
}

export function browserUseStatus() {
  const paid = isAiPaid();
  const budgetGate = canUseBrowserAutomation();
  const workerPresent = fs.existsSync(WORKER);
  const available =
    paid &&
    config.browserUseEnabled &&
    budgetGate.ok &&
    workerPresent;
  let reason = "ok";
  if (!paid) reason = "free_tier";
  else if (!config.browserUseEnabled) reason = "disabled";
  else if (!budgetGate.ok) reason = budgetGate.reason;
  else if (!workerPresent) reason = "worker_missing";
  return {
    available,
    reason,
    minRemainingEur: config.aiBrowserUseMinRemainingEur,
    allowOrigin: config.browserUseAllowOrigin,
    rateLimitPerMin: config.browserUseRateLimitPerMin,
    budget: getBudgetStatus(),
    worker: WORKER,
  };
}

function runPython(payload, timeoutMs = 55000) {
  return new Promise((resolve) => {
    const child = spawn("python3", [WORKER], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {
        ...process.env,
        BROWSER_USE_ALLOW_ORIGIN: config.browserUseAllowOrigin,
        CHROME_PATH: process.env.CHROME_PATH || "/usr/local/bin/google-chrome",
        BROWSER_USE_AUDIT_DIR:
          process.env.BROWSER_USE_AUDIT_DIR ||
          path.resolve(__dirname, "../../data/browser-use-audit"),
      },
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
    child.stdin.write(JSON.stringify(payload));
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

  const origin = allowOrigin || config.browserUseAllowOrigin;
  const result = await runPython({
    goal,
    selector,
    path: pagePath,
    cookie,
    allowOrigin: origin,
  });
  return {
    ...result,
    budget: getBudgetStatus(),
    status: browserUseStatus(),
  };
}
