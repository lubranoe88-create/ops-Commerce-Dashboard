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
