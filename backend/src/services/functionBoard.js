/**
 * Plancia function board — live probe of dashboard capabilities.
 * Status: ok | error | unverified
 * AI-reported errors overlay probes (error wins).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { config } from "../config.js";
import { isAiPaid } from "../middleware/aiPaidGate.js";
import { getBudgetStatus } from "./aiBudget.js";
import { browserUseStatus } from "./browserUse.js";
import { isTotpEnabled } from "./totp.js";
import { pollProactive } from "./proactive.js";
import {
  listFunctionReports,
  upsertFunctionReport,
  clearFunctionReport,
} from "../memory/aiStore.js";
import { searchCrossThreadMemory, listChatThreads } from "../memory/store.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.resolve(__dirname, "../../workers/browser_use_worker.py");

/** Canonical catalog shown on the 2D board (grid cells). */
export const FUNCTION_CATALOG = [
  { id: "ux-stats-strip", label: "Stats strip", group: "ux-1-10" },
  { id: "ux-refresh", label: "Refresh", group: "ux-1-10" },
  { id: "ux-tops-filter", label: "Filtro tops", group: "ux-1-10" },
  { id: "ux-csv-export", label: "CSV tops", group: "ux-1-10" },
  { id: "ux-prompt-chips", label: "Prompt chips", group: "ux-1-10" },
  { id: "ux-thread-export", label: "Export chat", group: "ux-1-10" },
  { id: "ux-toasts", label: "Toasts", group: "ux-1-10" },
  { id: "ux-shortcuts", label: "Hotkey 1–4", group: "ux-1-10" },
  { id: "ux-notes", label: "Note locali", group: "ux-1-10" },
  { id: "ux-cost-hint", label: "Cost hint", group: "ux-1-10" },
  { id: "dock-rail", label: "Rail comandi", group: "cockpit" },
  { id: "globe-map", label: "Globo / MAPPA", group: "cockpit" },
  { id: "module-pipeline", label: "PIPELINE", group: "cockpit" },
  { id: "module-memory", label: "MEMORY", group: "cockpit" },
  { id: "module-chat", label: "CHAT", group: "cockpit" },
  { id: "mic-voice", label: "MIC / voce", group: "cockpit" },
  { id: "analizza", label: "Analizza", group: "cockpit" },
  { id: "busy-mark", label: "Busy ✓", group: "paid-ai" },
  { id: "briefing", label: "Briefing Q1–Q3", group: "paid-ai" },
  { id: "news-pins", label: "News pins", group: "paid-ai" },
  { id: "actions", label: "actions[]", group: "paid-ai" },
  { id: "auth-password", label: "Login password", group: "auth" },
  { id: "auth-2fa", label: "2FA TOTP", group: "auth" },
  { id: "budget-openrouter", label: "Budget OpenRouter", group: "ai-stack" },
  { id: "auto-router", label: "Auto-router", group: "ai-stack" },
  { id: "openrouter-key", label: "OPENROUTER_API_KEY", group: "ai-stack" },
  { id: "cross-thread-memory", label: "Memoria cross-thread", group: "ai-stack" },
  { id: "chat-attachments", label: "Allegati chat", group: "ai-stack" },
  { id: "proactive-mechanical", label: "Proactive meccanico", group: "ai-stack" },
  { id: "proactive-ai", label: "Proactive AI", group: "ai-stack" },
  { id: "browser-use", label: "browser-use", group: "ai-stack" },
  { id: "paid-ai-turn", label: "Paid AI turn", group: "ai-stack" },
];

function cell(id, status, errorType = null, detail = "") {
  const meta = FUNCTION_CATALOG.find((c) => c.id === id) || {
    id,
    label: id,
    group: "other",
  };
  return {
    id,
    label: meta.label,
    group: meta.group,
    status, // ok | error | unverified
    errorType: errorType || null,
    detail: detail || "",
    source: "probe",
    updatedAt: new Date().toISOString(),
  };
}

function softOk(id, detail = "Presente in UI") {
  return cell(id, "ok", null, detail);
}

function softUnverified(id, detail = "Non verificata da probe server") {
  return cell(id, "unverified", null, detail);
}

function probeOpenRouterKey() {
  const key = config.openRouterApiKey || "";
  if (!key || /CHANGE_ME|PLACEHOLDER|your-key/i.test(key)) {
    return cell(
      "openrouter-key",
      "error",
      "NO_OPENROUTER",
      "OPENROUTER_API_KEY assente o placeholder",
    );
  }
  return cell("openrouter-key", "ok", null, "Chiave presente (server-side)");
}

function probeBudget() {
  try {
    const b = getBudgetStatus();
    if (!Number.isFinite(b?.capEur) || b.capEur <= 0) {
      return cell("budget-openrouter", "error", "BUDGET_MISCONFIG", "Cap giornaliero non valido");
    }
    if (b.hardBlocked) {
      return cell(
        "budget-openrouter",
        "error",
        "BUDGET_HARD",
        `Hard block — remaining €${Number(b.remainingEur).toFixed(2)}`,
      );
    }
    return cell(
      "budget-openrouter",
      "ok",
      null,
      `Cap €${b.capEur} · remaining €${Number(b.remainingEur).toFixed(2)}`,
    );
  } catch (err) {
    return cell("budget-openrouter", "error", "BUDGET_PROBE", err.message || "probe failed");
  }
}

function probeAutoRouter() {
  const key = probeOpenRouterKey();
  if (key.status === "error") {
    return cell(
      "auto-router",
      "error",
      key.errorType,
      "Router bloccato: chiave OpenRouter mancante",
    );
  }
  if (!config.aiRouterModel || !config.aiMainModel || !config.aiGrokModel) {
    return cell("auto-router", "error", "MODELS_MISSING", "Router/main/grok non configurati");
  }
  return cell(
    "auto-router",
    "ok",
    null,
    `${config.aiRouterModel} → ${config.aiMainModel} → ${config.aiGrokModel}`,
  );
}

function probePython3() {
  return new Promise((resolve) => {
    let out = "";
    let err = "";
    let settled = false;
    const child = spawn("python3", ["--version"], { stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      resolve({ ok: false, detail: "python3 timeout" });
    }, 3000);
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: false,
        detail: e.code === "ENOENT" ? "spawn python3 ENOENT" : e.message,
      });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        detail: (out || err || `exit ${code}`).trim(),
      });
    });
  });
}

async function probeBrowserUse() {
  if (!config.browserUseEnabled) {
    return cell("browser-use", "error", "BROWSER_USE_DISABLED", "Disabilitato da env");
  }
  if (!fs.existsSync(WORKER)) {
    return cell("browser-use", "error", "WORKER_MISSING", "browser_use_worker.py assente");
  }
  const py = await probePython3();
  if (!py.ok) {
    return cell(
      "browser-use",
      "error",
      "SPAWN_ERROR",
      py.detail || "python3 non disponibile sul runtime",
    );
  }
  if (!isAiPaid()) {
    return cell("browser-use", "error", "AI_PAYMENT_REQUIRED", "Richiede tier paid");
  }
  const st = browserUseStatus();
  if (!st.available && st.reason && !["ok", "worker_missing"].includes(st.reason)) {
    return cell("browser-use", "error", String(st.reason).toUpperCase(), `Gate: ${st.reason}`);
  }
  return cell("browser-use", "ok", null, `python3 OK (${py.detail})`);
}

function probe2fa() {
  if (isTotpEnabled()) {
    return cell("auth-2fa", "ok", null, "SITE_TOTP_SECRET attivo");
  }
  return cell(
    "auth-2fa",
    "unverified",
    "TOTP_UNSET",
    "2FA codice pronto; SITE_TOTP_SECRET non impostato",
  );
}

function probeProactiveMechanical() {
  try {
    const snap = pollProactive({ mark: false });
    return cell(
      "proactive-mechanical",
      "ok",
      null,
      `Poll OK · eventi undelivered=${snap.events?.length || 0}`,
    );
  } catch (err) {
    return cell("proactive-mechanical", "error", "PROACTIVE_POLL", err.message || "poll failed");
  }
}

function probeProactiveAi() {
  const key = probeOpenRouterKey();
  if (key.status === "error") {
    return cell("proactive-ai", "error", key.errorType, "Suggestion AI richiede OpenRouter");
  }
  if (!isAiPaid()) {
    return cell("proactive-ai", "error", "AI_PAYMENT_REQUIRED", "Tier free: suggestion AI off");
  }
  return cell("proactive-ai", "ok", null, `TTS mode=${config.aiProactiveTts}`);
}

function probeCrossThread() {
  try {
    const rows = searchCrossThreadMemory("a", { limit: 1 });
    return cell(
      "cross-thread-memory",
      "ok",
      null,
      `search OK · sample=${Array.isArray(rows) ? rows.length : 0}`,
    );
  } catch (err) {
    return cell("cross-thread-memory", "error", "MEMORY_SEARCH", err.message || "search failed");
  }
}

function probeAttachments() {
  try {
    listChatThreads();
    return cell("chat-attachments", "ok", null, "API allegati testo disponibile");
  } catch (err) {
    return cell("chat-attachments", "error", "ATTACH_SCHEMA", err.message || "db error");
  }
}

function probePaidTurn() {
  if (!isAiPaid()) {
    return cell("paid-ai-turn", "error", "AI_PAYMENT_REQUIRED", "Entitlement free");
  }
  const key = probeOpenRouterKey();
  if (key.status === "error") {
    return cell("paid-ai-turn", "error", key.errorType, "Turn AI senza chiave OpenRouter");
  }
  return cell("paid-ai-turn", "ok", null, "Paid + OpenRouter pronti");
}

export async function buildFunctionBoard() {
  const probed = [];

  for (const id of [
    "ux-stats-strip",
    "ux-refresh",
    "ux-tops-filter",
    "ux-csv-export",
    "ux-prompt-chips",
    "ux-thread-export",
    "ux-toasts",
    "ux-shortcuts",
    "ux-notes",
    "ux-cost-hint",
  ]) {
    probed.push(softOk(id, "Feature su main · conferma DOM client"));
  }

  probed.push(softOk("dock-rail", "Left rail comandi"));
  probed.push(softOk("globe-map", "Cesium globe host"));
  probed.push(softOk("module-pipeline", "Modulo pipeline"));
  probed.push(softOk("module-memory", "Modulo memory"));
  probed.push(softOk("module-chat", "Modulo chat"));
  probed.push(softUnverified("mic-voice", "Richiede gesto utente / device mic"));
  probed.push(softOk("analizza", "Barra Analizza"));
  probed.push(softOk("busy-mark", "Indicatore busy AI"));
  probed.push(softOk("briefing", "Modal briefing Q1–Q3"));
  probed.push(softOk("news-pins", "News meccaniche su globo"));
  probed.push(softOk("actions", "Catalogo actions[]"));

  probed.push(
    cell(
      "auth-password",
      config.sitePassword && !config.sitePassword.includes("CHANGE_ME") ? "ok" : "error",
      config.sitePassword?.includes("CHANGE_ME") ? "SITE_PASSWORD_PLACEHOLDER" : null,
      config.sitePassword?.includes("CHANGE_ME")
        ? "SITE_PASSWORD ancora placeholder"
        : "Password gate attivo",
    ),
  );
  probed.push(probe2fa());
  probed.push(probeBudget());
  probed.push(probeAutoRouter());
  probed.push(probeOpenRouterKey());
  probed.push(probeCrossThread());
  probed.push(probeAttachments());
  probed.push(probeProactiveMechanical());
  probed.push(probeProactiveAi());
  probed.push(await probeBrowserUse());
  probed.push(probePaidTurn());

  const byId = new Map(probed.map((c) => [c.id, c]));

  for (const r of listFunctionReports(80)) {
    const prev = byId.get(r.functionId) || {
      id: r.functionId,
      label: r.functionId,
      group: "reported",
      status: "unverified",
      errorType: null,
      detail: "",
    };
    if (r.status === "error") {
      byId.set(r.functionId, {
        ...prev,
        status: "error",
        errorType: r.errorType || "AI_REPORT",
        detail: r.detail || prev.detail,
        source: r.source || "ai",
        updatedAt: r.updatedAt || new Date().toISOString(),
      });
    } else if (r.status === "ok" && r.source === "ai") {
      byId.set(r.functionId, {
        ...prev,
        status: "ok",
        errorType: null,
        detail: r.detail || prev.detail,
        source: "ai",
        updatedAt: r.updatedAt || new Date().toISOString(),
      });
    } else if (r.status === "unverified") {
      byId.set(r.functionId, {
        ...prev,
        status: "unverified",
        errorType: r.errorType || null,
        detail: r.detail || prev.detail,
        source: r.source || "client",
        updatedAt: r.updatedAt || new Date().toISOString(),
      });
    }
  }

  const ordered = [];
  const seen = new Set();
  for (const meta of FUNCTION_CATALOG) {
    const c = byId.get(meta.id);
    if (c) {
      ordered.push(c);
      seen.add(meta.id);
    }
  }
  for (const [id, c] of byId) {
    if (!seen.has(id)) ordered.push(c);
  }

  return {
    updatedAt: new Date().toISOString(),
    summary: {
      ok: ordered.filter((c) => c.status === "ok").length,
      error: ordered.filter((c) => c.status === "error").length,
      unverified: ordered.filter((c) => c.status === "unverified").length,
      total: ordered.length,
    },
    functions: ordered,
  };
}

export function reportFunctionStatus({
  functionId,
  status,
  errorType = "",
  detail = "",
  source = "ai",
} = {}) {
  const id = String(functionId || "").trim().slice(0, 80);
  if (!id) {
    const err = new Error("functionId required");
    err.status = 400;
    throw err;
  }
  const st = String(status || "").toLowerCase();
  if (!["ok", "error", "unverified"].includes(st)) {
    const err = new Error("status must be ok|error|unverified");
    err.status = 400;
    throw err;
  }
  if (st === "ok" && source === "ai") {
    clearFunctionReport(id);
  }
  upsertFunctionReport({
    functionId: id,
    status: st,
    errorType: String(errorType || "").slice(0, 80),
    detail: String(detail || "").slice(0, 500),
    source: String(source || "ai").slice(0, 40),
  });
  return { ok: true, functionId: id, status: st };
}
