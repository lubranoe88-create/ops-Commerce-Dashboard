/**
 * C9 session continuity.
 * The JSON file is the source of truth. One expandable-memory note
 * tagged atlas-session mirrors it so a later «memoria» recall can read it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { upsertTaggedMemory } from "./agentqBridge.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, "../../data/agentq-memory/atlas-session.json");

let pathOverride = "";
let mirrorEnabled = true;

export function defaultSessionPath() {
  return DEFAULT_PATH;
}

export function setSessionFileForTests(filePath, { mirror = false } = {}) {
  pathOverride = filePath ? path.resolve(filePath) : "";
  mirrorEnabled = filePath ? Boolean(mirror) : true;
}

function sessionPath() {
  return pathOverride || DEFAULT_PATH;
}

function clip(value, max) {
  const text = String(value ?? "").trim();
  if (text.length <= max) return text;
  return text.slice(0, max);
}

function normId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-");
}

export function emptyAtlasSession() {
  return {
    version: 1,
    wakeSummary: "",
    wakeAt: null,
    module: "",
    pendingAsk: [],
    updatedAt: null,
  };
}

function normalizePending(list) {
  const out = [];
  const seen = new Set();
  for (const item of Array.isArray(list) ? list : []) {
    const id = normId(typeof item === "string" ? item : item?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      reason: clip(item?.reason || "ask", 80) || "ask",
      at: item?.at || new Date().toISOString(),
    });
  }
  return out.slice(0, 24);
}

function sanitize(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return emptyAtlasSession();
  return {
    version: 1,
    wakeSummary: clip(raw.wakeSummary || "", 800),
    wakeAt: raw.wakeAt || null,
    module: clip(raw.module || "", 40),
    pendingAsk: normalizePending(raw.pendingAsk),
    updatedAt: raw.updatedAt || null,
  };
}

export function readAtlasSession() {
  try {
    return sanitize(JSON.parse(fs.readFileSync(sessionPath(), "utf8")));
  } catch {
    return emptyAtlasSession();
  }
}

function persist(session) {
  const clean = sanitize(session);
  const dest = sessionPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = path.join(path.dirname(dest), `.atlas-session.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(clean, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, dest);
  mirrorSession(clean);
  return clean;
}

function mirrorSession(session) {
  if (!mirrorEnabled) return;
  try {
    const lines = [];
    if (session.wakeSummary) lines.push(`Ultima sintesi: ${session.wakeSummary}`);
    if (session.module) lines.push(`Modulo preferito: ${session.module}`);
    if (session.pendingAsk.length) {
      lines.push(
        `Approvazioni ASK in attesa: ${session.pendingAsk.map((item) => `${item.id} (${item.reason})`).join(", ")}`,
      );
    } else {
      lines.push("Nessuna approvazione ASK in attesa.");
    }
    upsertTaggedMemory({
      tag: "atlas-session",
      title: "Sessione Atlas",
      text: lines.join("\n"),
    });
  } catch {
    /* the session file remains the source of truth */
  }
}

export function rememberWake({ wakeSummary = "", module = "", pendingAsk = [] } = {}) {
  const prev = readAtlasSession();
  return persist({
    version: 1,
    wakeSummary: clip(wakeSummary || prev.wakeSummary, 800),
    wakeAt: new Date().toISOString(),
    module: clip(module || prev.module, 40),
    pendingAsk: normalizePending([...(prev.pendingAsk || []), ...(pendingAsk || [])]),
    updatedAt: new Date().toISOString(),
  });
}

export function patchAtlasSession({ module, pendingAskAdd, pendingAskDrop } = {}) {
  const prev = readAtlasSession();
  let pending = [...prev.pendingAsk];
  const dropId = normId(pendingAskDrop);
  if (dropId) pending = pending.filter((item) => item.id !== dropId);
  const addId = normId(pendingAskAdd?.id);
  if (addId) {
    pending = pending.filter((item) => item.id !== addId);
    pending.push({
      id: addId,
      reason: clip(pendingAskAdd.reason || "ask", 80) || "ask",
      at: new Date().toISOString(),
    });
  }
  const nextModule = module != null && String(module).trim() ? clip(module, 40) : prev.module;
  return persist({
    ...prev,
    module: nextModule,
    pendingAsk: pending,
    updatedAt: new Date().toISOString(),
  });
}

export function publicAtlasSession(session = emptyAtlasSession()) {
  return {
    ok: true,
    name: "Atlas",
    wakeSummary: session.wakeSummary || "",
    wakeAt: session.wakeAt || null,
    module: session.module || "",
    pendingAsk: session.pendingAsk || [],
    updatedAt: session.updatedAt || null,
  };
}

export function restoredFrom(previous, { applyModule = false } = {}) {
  const session = previous || emptyAtlasSession();
  const has =
    Boolean(session.wakeSummary) || Boolean(session.module) || (session.pendingAsk || []).length > 0;
  if (!has) return null;
  return {
    wakeSummary: session.wakeSummary || "",
    wakeAt: session.wakeAt || null,
    module: session.module || "",
    pendingAsk: session.pendingAsk || [],
    applyModule: Boolean(applyModule && session.module),
  };
}
