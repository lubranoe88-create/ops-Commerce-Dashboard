/**
 * Live tool-call tail for the operator cockpit.
 * MCP calls, specialist turns, and workflow steps append here.
 * The file is the source of truth so a refresh still shows the tail.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, "../../data/agentq-memory/atlas-tool-calls.json");
const MAX_CALLS = 80;

let pathOverride = "";

export function setToolLogFileForTests(filePath) {
  pathOverride = filePath ? path.resolve(filePath) : "";
}

function logPath() {
  return pathOverride || DEFAULT_PATH;
}

function readCalls() {
  try {
    const raw = JSON.parse(fs.readFileSync(logPath(), "utf8"));
    return Array.isArray(raw?.calls) ? raw.calls : [];
  } catch {
    return [];
  }
}

function writeCalls(calls) {
  const dest = logPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const body = { version: 1, calls: calls.slice(0, MAX_CALLS) };
  const tmp = path.join(path.dirname(dest), `.atlas-tool-calls.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, dest);
}

export function noteToolCall(call = {}) {
  const name = String(call.name || "").trim().slice(0, 80);
  if (!name) return null;
  const row = {
    id: `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    at: new Date().toISOString(),
    name,
    mode: call.mode === "ask" ? "ask" : "auto",
    stub: Boolean(call.stub),
    ok: call.ok !== false,
    detail: String(call.detail || "").replace(/\s+/g, " ").trim().slice(0, 240),
  };
  const calls = readCalls();
  calls.unshift(row);
  writeCalls(calls);
  return row;
}

export function listToolCalls({ limit = 12 } = {}) {
  return readCalls().slice(0, Math.max(1, Number(limit) || 12));
}
