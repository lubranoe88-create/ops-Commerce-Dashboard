/**
 * Resolve local/portable Python used by browser-use worker.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const LOCAL_PYTHON = path.join(ROOT, ".browser-use-runtime/venv/bin/python");

/** Load env.sh written by scripts/install-browser-use-runtime.sh if present. */
export function applyBrowserUseRuntimeEnv() {
  const envFile = path.join(ROOT, ".browser-use-runtime/env.sh");
  if (!fs.existsSync(envFile)) return;
  const text = fs.readFileSync(envFile, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^export\s+([A-Z0-9_]+)="([^"]*)"/);
    if (!m) continue;
    const [, key, val] = m;
    if (!process.env[key]) process.env[key] = val;
  }
}

export function resolveBrowserUsePython() {
  applyBrowserUseRuntimeEnv();
  const fromEnv = process.env.BROWSER_USE_PYTHON?.trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;
  if (fs.existsSync(LOCAL_PYTHON)) return LOCAL_PYTHON;
  return "python3";
}

/** Env for the Python worker. Prefer the in-project Playwright browser cache. */
export function browserUseChildEnv(extra = {}) {
  applyBrowserUseRuntimeEnv();
  const env = { ...process.env };
  const browsers = path.join(ROOT, ".browser-use-runtime/ms-playwright");
  if (fs.existsSync(browsers)) env.PLAYWRIGHT_BROWSERS_PATH = browsers;
  const py = resolveBrowserUsePython();
  if (py && fs.existsSync(py)) env.BROWSER_USE_PYTHON = py;
  const chrome = resolveChromiumExecutable();
  if (chrome) env.CHROME_PATH = chrome;
  else delete env.CHROME_PATH;
  return { ...env, ...extra };
}

/**
 * Playwright's Chromium binary inside the project cache or CHROME_PATH.
 * Does not launch the browser.
 */
export function resolveChromiumExecutable() {
  applyBrowserUseRuntimeEnv();
  const fromEnv = process.env.CHROME_PATH?.trim();
  if (fromEnv && fromEnv !== "/usr/local/bin/google-chrome" && fs.existsSync(fromEnv)) {
    return fromEnv;
  }
  const configured = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim();
  const root =
    configured && fs.existsSync(configured)
      ? configured
      : path.join(ROOT, ".browser-use-runtime/ms-playwright");
  if (!fs.existsSync(root)) return null;
  const hits = [];
  const stack = [root];
  let seen = 0;
  while (stack.length && seen < 800) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      seen += 1;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (
        ent.name === "chrome" ||
        ent.name === "chromium" ||
        ent.name === "headless_shell" ||
        ent.name === "chrome-headless-shell"
      ) {
        try {
          if (fs.statSync(full).mode & 0o111) hits.push(full);
        } catch {
          /* ignore */
        }
      }
    }
  }
  hits.sort((a, b) => Number(!a.endsWith(`${path.sep}chrome`)) - Number(!b.endsWith(`${path.sep}chrome`)));
  return hits[0] || null;
}

export function probeBrowserUsePython() {
  const bin = resolveBrowserUsePython();
  try {
    const ver = spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 5000 });
    if (ver.error) {
      return {
        ok: false,
        bin,
        detail: ver.error.code === "ENOENT" ? "spawn python ENOENT" : ver.error.message,
      };
    }
    if (ver.status !== 0) {
      return { ok: false, bin, detail: (ver.stderr || ver.stdout || `exit ${ver.status}`).trim() };
    }
    const pw = spawnSync(
      bin,
      ["-c", "from playwright.sync_api import sync_playwright; print('ok')"],
      { encoding: "utf8", timeout: 15000 },
    );
    if (pw.error || pw.status !== 0) {
      return {
        ok: false,
        bin,
        detail: `python ok (${(ver.stdout || "").trim()}) but playwright missing: ${(pw.stderr || pw.stdout || pw.error?.message || "").trim()}`,
      };
    }
    return { ok: true, bin, detail: (ver.stdout || ver.stderr || "").trim() };
  } catch (err) {
    return { ok: false, bin, detail: err.message || "probe failed" };
  }
}
