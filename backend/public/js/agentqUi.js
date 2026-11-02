/**
 * Atlas plancia UI. Internal ids and /api/ai/agentq paths stay as-is.
 * - Aggiornamenti all'ingresso
 * - Ricerca on-demand (sandbox + API + web hint)
 * - Pop-up documenti
 * - Mani: piano Atlas → runHoloAction (zoom, moduli, briefing, documenti)
 */
import { payloadFromLocalPlan, planHandsFromUtterance } from "./atlasHandsPlan.js";
import { routeAtlasTurn } from "./atlasRoute.js";

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function $(id) {
  return document.getElementById(id);
}

function ensurePopup() {
  let root = $("agentqDocPopup");
  if (root) return root;
  root = document.createElement("div");
  root.id = "agentqDocPopup";
  root.className = "agentq-doc-popup";
  root.hidden = true;
  root.innerHTML = `
    <div class="agentq-doc-panel" role="dialog" aria-modal="true" aria-labelledby="agentqDocTitle">
      <header class="agentq-doc-head">
        <h2 id="agentqDocTitle">Documento</h2>
        <button type="button" class="pill-btn" id="agentqDocClose" aria-label="Chiudi">Chiudi</button>
      </header>
      <div class="agentq-doc-body" id="agentqDocBody"></div>
    </div>`;
  document.body.appendChild(root);
  root.querySelector("#agentqDocClose")?.addEventListener("click", () => closeDocPopup());
  root.addEventListener("click", (e) => {
    if (e.target === root) closeDocPopup();
  });
  return root;
}

export function closeDocPopup() {
  const root = $("agentqDocPopup");
  if (root) root.hidden = true;
  const body = $("agentqDocBody");
  if (body) body.innerHTML = "";
}

export function openDocPopup({ title, kind, text, base64, mime, uri }) {
  const root = ensurePopup();
  root.hidden = false;
  $("agentqDocTitle").textContent = title || "Documento";
  const body = $("agentqDocBody");
  body.innerHTML = "";
  if (kind === "pdf" && base64) {
    const iframe = document.createElement("iframe");
    iframe.title = title || "PDF";
    iframe.className = "agentq-doc-frame";
    iframe.src = `data:${mime || "application/pdf"};base64,${base64}`;
    body.appendChild(iframe);
  } else if (uri && String(uri).startsWith("http")) {
    const iframe = document.createElement("iframe");
    iframe.title = title || "Live";
    iframe.className = "agentq-doc-frame";
    iframe.src = uri;
    iframe.referrerPolicy = "no-referrer";
    body.appendChild(iframe);
    const note = document.createElement("p");
    note.className = "muted mono";
    note.textContent = uri;
    body.appendChild(note);
  } else {
    const pre = document.createElement("pre");
    pre.className = "agentq-doc-text";
    pre.textContent = text || "(vuoto)";
    body.appendChild(pre);
  }
}

/** Mostra ultimi aggiornamenti + problemi aperti all'ingresso plancia. */
export async function showEntryUpdates({ postChatUpdate, showToast } = {}) {
  try {
    const data = await api("/api/ai/agentq/updates");
    const updates = data.updates || [];
    if (updates.length) {
      const lines = updates.slice(0, 5).map((u, i) => `${i + 1}. ${u.title}: ${u.detail || ""}`);
      const msg = atlasLine(`Aggiornamenti recenti\n${lines.join("\n")}`);
      postChatUpdate?.(msg, "ok", { trust: "auto", trustLine: trustLineFor("auto", "aggiornamenti") });
      showToast?.(`Atlas · ${updates.length} aggiornamenti`, "ok");
    } else {
      showToast?.("Atlas · nessun aggiornamento nuovo", "ok");
    }
    if (data.decisionSnippet) {
      postChatUpdate?.(atlasLine(data.decisionSnippet), "ok", {
        trust: "auto",
        trustLine: trustLineFor("auto", "decisioni"),
      });
    }
  } catch (err) {
    console.warn("[agentq] updates", err?.message || err);
    showToast?.(`Aggiornamenti non caricati: ${err?.message || err}`, "warn");
    postChatUpdate?.(`Aggiornamenti ingresso falliti: ${err?.message || err}`, "warn");
  }
  try {
    const probs = await api("/api/ai/agentq/problems");
    const n = probs.count || 0;
    if (n > 0) {
      const lines = (probs.problems || [])
        .slice(0, 5)
        .map((p, i) => `${i + 1}. [${p.severity}] ${p.title}: ${p.detail || ""}`);
      postChatUpdate?.(
        atlasLine(`Monitoraggio · ${n} problemi da sistemare\n${lines.join("\n")}\nChiedi «problemi» per i passi, «risolvi» per i fix AUTO.`),
        "warn",
        { trust: "auto", trustLine: trustLineFor("auto", "problemi") },
      );
      showToast?.(`Atlas · ${n} problemi`, "warn");
    } else {
      postChatUpdate?.(atlasLine("Monitoraggio · nessun problema aperto."), "ok", {
        trust: "auto",
        trustLine: trustLineFor("auto", "problemi"),
      });
    }
  } catch (err) {
    console.warn("[agentq] problems", err?.message || err);
    showToast?.(`Monitoraggio non caricato: ${err?.message || err}`, "warn");
    postChatUpdate?.(`Monitoraggio ingresso fallito: ${err?.message || err}`, "warn");
  }
}

function formatProblemReport(probs) {
  const list = probs?.problems || [];
  if (!list.length) return atlasLine("Nessun errore o problema aperto sulla plancia.");
  const byId = new Map((probs.resolutions || []).map((row) => [row.problemId, row]));
  const lines = [atlasLine(`Problemi aperti: ${probs.count ?? list.length}.`)];
  list.forEach((problem, index) => {
    lines.push(
      `${index + 1}. [${problem.kind}/${problem.severity}] ${problem.title} — ${problem.detail || problem.status || ""}`,
    );
    const resolution = byId.get(problem.id);
    (resolution?.steps || []).forEach((step, stepIndex) => {
      lines.push(`   ${stepIndex + 1}) ${step}`);
    });
    if (resolution?.auto?.length) lines.push(`   AUTO: ${resolution.auto.join(", ")}`);
    if (resolution?.ask?.length) {
      lines.push(`   ASK: ${resolution.ask.map((step) => step.id || step).join(", ")}`);
    }
  });
  return lines.join("\n");
}

export async function showProblems({ postChatUpdate, runHoloAction, resolve = false } = {}) {
  const probs = await api("/api/ai/agentq/problems");
  const report = formatProblemReport(probs);
  const fixes = Array.isArray(probs.autoFixes) ? probs.autoFixes : [];
  const trustLine = fixes.length
    ? `Affidabilità · AUTO ${fixes.join(", ")}`
    : trustLineFor("auto", "problemi");
  postChatUpdate?.(
    resolve && fixes.length ? `${report}\nEseguo i passi AUTO: ${fixes.join(", ")}.` : report,
    probs.count ? "warn" : "ok",
    { trust: "auto", trustLine },
  );
  if (resolve && fixes.length) {
    await executeHandPlan(
      {
        actions: fixes,
        tagged: fixes.map((id) => ({ id, mode: "auto", reason: "read" })),
      },
      { postChatUpdate, runHoloAction },
      { quietIfEmpty: true },
    );
  }
  return probs;
}

/**
 * Ricerca Atlas — solo se l'utente lo chiede esplicitamente.
 * trigger phrases: "cerca", "ricerca", "search" (legacy spoken prefix still matched)
 */
export function isSearchRequest(text) {
  const t = String(text || "").trim().toLowerCase();
  return /^(cerca|ricerca|search|agent\s*q\s+cerca)\b/.test(t) || /\b(cerca|ricerca)\s+.+/i.test(t);
}

export function extractSearchQuery(text) {
  return String(text || "")
    .replace(/^(agent\s*q\s+)?(cerca|ricerca|search)\s*/i, "")
    .trim();
}

export function isMemoryWrite(text) {
  return /^(memorizza|ricorda|salva\s+in\s+memoria)\b/i.test(String(text || "").trim());
}

export function isMemoryRecall(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t) return false;
  return /^(memoria|cosa\s+ricordi|leggi\s+memoria|note\s+in\s+memoria)\b/.test(t) || /\bcerca\s+in\s+memoria\b/.test(t);
}

const IMPLICIT_SEARCH =
  /\b(sandbox|filesystem|nei\s+file|sul\s+disco|nel\s+database|memoria\s+espandibile|cerca\s+nei\s+file|ricerca\s+libera)\b/i;

export function refusesImplicitSearch(text) {
  if (isSearchRequest(text) || isMemoryWrite(text) || isMemoryRecall(text)) return false;
  return IMPLICIT_SEARCH.test(String(text || ""));
}

const STATE_BLOCKED =
  /^(cerca|ricerca|search|memorizza|ricorda|salva\s+in\s+memoria|problemi|errori|monitoraggio|risolvi|sistema|apri|vai|mostra|zoom)\b/;
const STATE_HINT =
  /\b(stato|istantanea|snapshot|salute|health|come\s+sta|quadro(?:\s+funzioni)?|function\s*board|pins?|tops?|classifica|problemi\s+aperti|quanti\s+problemi|numero\s+di\s+problemi|quanti\s+errori|errori\s+aperti|aggiornamenti|modulo\s+aperto|quale\s+modulo|che\s+modulo|modulo\s+è\s+aperto|modulo\s+e\s+aperto)\b/i;
const STATE_QUESTION =
  /[?]|(?:^|\s)(qual[ei]|quanti|quante|come|dimmi|stato|salute|riepilogo|snapshot|istantanea|tops?|pins?|quadro|aggiornamenti|classifica)\b/i;

/** Same gate as the server state answerer. Commands and search stay on their own paths. */
export function isPlanciaStateQuestion(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t || t.length > 500) return false;
  if (STATE_BLOCKED.test(t)) return false;
  if (!STATE_HINT.test(t)) return false;
  if (!STATE_QUESTION.test(t)) return false;
  return true;
}

export function isProblemsRequest(text) {
  return /^(problemi|errori|monitoraggio|cosa\s+da\s+sistemare|risolvi|sistema)\b/i.test(String(text || "").trim());
}

export function wantsResolution(text) {
  return /^(risolvi|sistema)\b/i.test(String(text || "").trim());
}

export const ATLAS_SEARCH_REFUSAL =
  "Atlas. Non cerco nella sandbox né in memoria finché non me lo chiedi. Dimmi «cerca …» oppure «memoria …».";

function atlasLine(text) {
  const body = String(text || "")
    .replace(/\bAgente Q\b|\bAgent Q\b|\bAgentQ\b/g, "Atlas")
    .trim();
  if (!body) return "Atlas.";
  if (/^atlas\b/i.test(body)) return body;
  return `Atlas. ${body}`;
}

function trustLineFor(mode, id) {
  const label = mode === "ask" ? "ASK" : "AUTO";
  return `Affidabilità · ${label} · ${id}`;
}

function trustLineFromPlan(plan) {
  const autos = [];
  const asks = [];
  for (const step of plan || []) {
    if (!step?.id) continue;
    if (step.mode === "ask") asks.push(step.id);
    else autos.push(step.id);
  }
  const parts = [];
  if (autos.length) parts.push(`AUTO ${autos.join(", ")}`);
  if (asks.length) parts.push(`ASK ${asks.join(", ")}`);
  return parts.length ? `Affidabilità · ${parts.join(" · ")}` : "";
}

let lastRememberedModule = "";
let sessionWritesOpen = false;

/** Wake reads the stored module before later view saves overwrite it. */
export function enableSessionWrites() {
  sessionWritesOpen = true;
}

export async function rememberOpenModule(mod) {
  if (!sessionWritesOpen) return;
  const name = String(mod || "").trim();
  if (!name || name === lastRememberedModule) return;
  lastRememberedModule = name;
  try {
    await api("/api/ai/agentq/session", {
      method: "POST",
      body: JSON.stringify({ module: name }),
    });
  } catch {
    lastRememberedModule = "";
  }
}

async function rememberPendingAsk(step, { drop = false } = {}) {
  const id = String(step?.id || "").trim();
  if (!id) return;
  try {
    await api("/api/ai/agentq/session", {
      method: "POST",
      body: JSON.stringify(
        drop
          ? { pendingAskDrop: id }
          : { pendingAskAdd: { id, reason: step.reason || "ask" } },
      ),
    });
  } catch {
    /* the confirm path still stands */
  }
}

export async function runOnDemandSearch(query, { postChatUpdate, openDoc } = {}) {
  const q = String(query || "").trim();
  if (!q) {
    postChatUpdate?.(atlasLine("Per la ricerca indica cosa cercare (es. «cerca budget»)."), "warn", {
      trust: "ask",
      trustLine: trustLineFor("ask", "ricerca"),
    });
    return null;
  }
  postChatUpdate?.(atlasLine(`Ricerca on-demand: ${q}`), "ok", {
    trust: "auto",
    trustLine: trustLineFor("auto", "ricerca"),
  });
  const data = await api("/api/ai/agentq/search", {
    method: "POST",
    body: JSON.stringify({
      query: q,
      explicit: true,
      sources: ["filesystem", "database", "memory", "api", "web_hint"],
    }),
  });
  const hits = data.hits || [];
  if (!hits.length) {
    postChatUpdate?.(
      atlasLine(`Nessun risultato.${(data.errors || []).length ? ` ${data.errors.join("; ")}` : ""}`),
      "warn",
      { trust: "auto", trustLine: trustLineFor("auto", "ricerca") },
    );
    return data;
  }
  const lines = hits.slice(0, 8).map((h, i) => {
    return `${i + 1}. [${h.source}] ${h.title} — ${h.snippet || ""}${h.uri ? ` · ${h.uri}` : ""}`;
  });
  postChatUpdate?.(atlasLine(`Risultati (${hits.length})\n${lines.join("\n")}`), "ok", {
    trust: "auto",
    trustLine: trustLineFor("auto", "ricerca"),
  });

  // Auto-open first sandbox/text or http hint in popup if requested via openDoc
  const firstDoc = hits.find((h) => String(h.uri || "").startsWith("sandbox://"));
  const firstWeb = hits.find((h) => String(h.uri || "").startsWith("http"));
  if (openDoc && firstDoc) {
    await openSandboxDoc(firstDoc.uri, { postChatUpdate });
  } else if (openDoc && firstWeb) {
    openDocPopup({ title: firstWeb.title, uri: firstWeb.uri, kind: "web" });
  }
  return data;
}

export async function openSandboxDoc(uri, { postChatUpdate } = {}) {
  const rel = String(uri || "").replace(/^sandbox:\/\//, "");
  try {
    const doc = await api(`/api/ai/agentq/document?path=${encodeURIComponent(rel)}`);
    openDocPopup({
      title: doc.name,
      kind: doc.kind,
      text: doc.text,
      base64: doc.base64,
      mime: doc.mime,
      uri: doc.uri,
    });
    postChatUpdate?.(`Documento aperto: ${doc.name}`);
  } catch (err) {
    postChatUpdate?.(err?.message || "Documento non apribile", "warn");
  }
}

/**
 * Client mirror of atlasAutonomyPolicy AUTO ids (L3 + X1).
 * Dangerous classes always ask, even if a payload says mode "auto",
 * unless the server gate set reason "promoted" after repeated confirms
 * of that same action id. Unknown ids ask.
 * Keep AUTO_HANDS aligned with backend AUTO_MATRIX.
 */
const AUTO_HANDS = new Set([
  "map", "pipeline", "memory", "chat",
  "zoom-in", "zoom-out", "zoom-citta", "zoom-paese", "zoom-continente",
  "orbit", "nord", "fly", "focus-top",
  "strumenti", "inspect", "analizza", "mic",
  "confronta", "filtro-score", "filtro-reset", "coverage-next",
  "tema-cyan", "tema-amber", "tema-mint",
  "read", "search", "document", "sandbox-read", "memory-list", "memory-read", "problems",
  "web-hint", "web_hint", "wikipedia",
  "status", "agentq-status", "function-board", "budget-status", "health",
  "controlli", "funzionamento",
  "refresh", "updates", "news", "entry-updates", "updates-read",
  "briefing",
]);

function handId(item) {
  if (typeof item === "string" || typeof item === "number") return String(item).trim();
  if (item && typeof item === "object") {
    return String(item.id || item.type || item.action || item.actionId || "").trim();
  }
  return "";
}

function isAutoHand(id) {
  const s = String(id || "").toLowerCase();
  if (AUTO_HANDS.has(s)) return true;
  if (s.startsWith("zoom-") || s.startsWith("zoom_") || s.startsWith("tema-") || s.startsWith("tema_")) return true;
  if (s === "refresh" || s.startsWith("refresh-") || s.startsWith("refresh_")) return true;
  return false;
}

function approvalReason(id) {
  const s = String(id || "").toLowerCase();
  const flat = s.replace(/[_-]/g, "");
  if (flat.includes("browseruse")) return "browser-use";
  if (/(credential|password|passwd|secret|totp|api[-_]?key|apikey|2fa)/.test(s) || /^(login|otp|token|passcode)([-_]|$)/.test(s)) {
    return "credentials";
  }
  if (s.includes("export") || /^(dump|backup|download)([-_]|$)/.test(s)) return "export";
  if (/(^|[-_])(delete|wipe|destroy|purge|truncate|overwrite|drop|remove|clear)([-_]|$)/.test(s) || /^(correct|reorder-tops|accept-suggestion)$/.test(s) || s.startsWith("reorder") || s.startsWith("correct-") || s.startsWith("correct_")) {
    return "destructive-write";
  }
  if (/spend[-_]?past[-_]?soft|^spend([-_]|$)|^escalate([-_]|$)/.test(s)) return "spend-past-soft-band";
  return "unknown";
}

function stepNeedsApproval(step) {
  const id = step?.id || "";
  if (!id) return true;
  // X1: only the server gate may skip a confirm, and only after it counted
  // explicit approvals for this id. A payload that merely says mode "auto"
  // for credentials or a destructive write still asks.
  if (step.mode === "auto" && step.reason === "promoted") return false;
  if (approvalReason(id) !== "unknown") return true;
  if (step.mode === "ask" || step.fromAskList) return true;
  if (step.mode === "auto" && isAutoHand(id)) return false;
  if (isAutoHand(id) && step.mode !== "ask" && !step.fromAskList) return false;
  return true;
}

function planFromHands(data) {
  const seen = new Set();
  const out = [];
  const push = (item, fromAskList) => {
    const id = handId(item);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const mode = item && typeof item === "object" && (item.mode === "ask" || item.mode === "auto") ? item.mode : fromAskList ? "ask" : "auto";
    const reason = item && typeof item === "object" && item.reason ? String(item.reason) : approvalReason(id);
    out.push({
      id,
      mode: fromAskList || mode === "ask" ? "ask" : mode,
      reason,
      fromAskList: Boolean(fromAskList || mode === "ask"),
    });
  };
  if (Array.isArray(data?.tagged) && data.tagged.length) {
    for (const item of data.tagged) push(item, item?.mode === "ask");
    return out;
  }
  for (const item of data?.actions || []) push(item, false);
  for (const item of data?.ask || data?.pending || []) push(item, true);
  return out;
}

function voiceCallOpen() {
  return document.documentElement?.dataset?.voiceCall === "1";
}

/**
 * Run a gated hand plan. AUTO steps run. ASK steps use the confirm path.
 * Resident reactions pass respectCall so a live MIC call is not interrupted.
 */
export async function executeHandPlan(data, ctx = {}, { respectCall = false, quietIfEmpty = false } = {}) {
  const { runHoloAction, postChatUpdate } = ctx;
  const plan = planFromHands(data);
  const planTrust = trustLineFromPlan(plan) || data?.trustLine || "";
  if (!plan.length) {
    if (!quietIfEmpty) {
      postChatUpdate?.(atlasLine("Nessuna azione plancia proposta per questo obiettivo."), "warn", {
        trust: "ask",
        trustLine: planTrust || trustLineFor("ask", "mani"),
      });
    }
    return data;
  }
  if (respectCall && voiceCallOpen()) {
    const ids = plan.map((step) => step.id).join(", ");
    postChatUpdate?.(atlasLine(`Lascio in sospeso durante la chiamata: ${ids}.`), "ok", {
      trust: "ask",
      trustLine: planTrust || trustLineFor("ask", "mani"),
    });
    return data;
  }
  for (const step of plan) {
    const mode = step.mode === "ask" || stepNeedsApproval(step) ? "ask" : "auto";
    const line = trustLineFor(mode, step.id);
    if (stepNeedsApproval(step)) {
      const reason = step.reason || approvalReason(step.id);
      let ok = false;
      try {
        ok = window.confirm(`Atlas ha bisogno di approvazione per «${step.id}» (${reason}). Eseguire?`);
      } catch {
        ok = false;
      }
      if (!ok) {
        await rememberPendingAsk(step);
        postChatUpdate?.(
          atlasLine(`ASK · «${step.id}» (${reason}). Azione non eseguita.`),
          "warn",
          { trust: "ask", trustLine: line },
        );
        continue;
      }
      let trustNote = "";
      try {
        const trust = await api("/api/ai/agentq/autonomy/approve", {
          method: "POST",
          body: JSON.stringify({ actionId: step.id }),
        });
        if (trust?.justPromoted) {
          const n = trust.threshold || 3;
          trustNote = ` · autonoma dopo ${n} approvazioni`;
        }
      } catch {
        postChatUpdate?.(atlasLine(`Approvazione di «${step.id}» non registrata.`), "warn", {
          trust: "ask",
          trustLine: line,
        });
      }
      await rememberPendingAsk(step, { drop: true });
      postChatUpdate?.(atlasLine(`ASK · «${step.id}» approvata${trustNote}.`), "ok", {
        trust: "ask",
        trustLine: line,
      });
    } else {
      postChatUpdate?.(atlasLine(`AUTO · ${step.id}.`), "ok", { trust: "auto", trustLine: line });
    }
    await runHoloAction?.(step.id, {
      fromVoice: Boolean(ctx.fromVoice),
      hand: { path: data?.document || data?.path || "", briefing: Boolean(data?.briefing) },
    });
  }
  return data;
}

export async function runHands(objective, ctx = {}) {
  const data = await api("/api/ai/agentq/hands", {
    method: "POST",
    body: JSON.stringify({ objective }),
  });
  if (data.speak) {
    ctx.postChatUpdate?.(`Atlas: ${data.speak}`);
    ctx.speak?.(data.speak);
  }
  return executeHandPlan(data, ctx);
}

const seenResidentIds = new Set();
let residentStarted = false;
let residentSource = null;

function formatRestore(restored) {
  if (!restored) return "";
  const bits = [];
  if (restored.wakeSummary) {
    bits.push(`Ultima sintesi: ${String(restored.wakeSummary).replace(/\s+/g, " ").slice(0, 280)}`);
  }
  if (restored.module) bits.push(`Modulo preferito: ${restored.module}`);
  const pending = Array.isArray(restored.pendingAsk) ? restored.pendingAsk : [];
  if (pending.length) {
    bits.push(`Approvazioni in attesa: ${pending.map((item) => item.id).filter(Boolean).join(", ")}`);
  }
  if (!bits.length) return "";
  return atlasLine(`Riprendo la sessione. ${bits.join(". ")}.`);
}

function residentBubble(data) {
  const literacy = data?.literacy?.text || data?.newsLiteracy || "";
  const trust = data?.trustLine || "";
  const recall = data?.recallLine || "";
  const decision = data?.decisionLine || "";
  const focus = data?.focus?.apply ? data.focus.because : "";
  const suggestion = data?.suggestions?.text || "";
  const curiosity = data?.curiosity?.text || "";
  return [data?.summary, literacy, trust, recall, decision, focus, suggestion, curiosity]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("\n\n");
}

function withoutMic(data) {
  const drop = (list) =>
    (Array.isArray(list) ? list : []).filter((item) => handId(item).toLowerCase() !== "mic");
  return {
    ...data,
    actions: drop(data?.actions),
    ask: drop(data?.ask),
    tagged: drop(data?.tagged),
  };
}

async function presentResident(data, ctx) {
  if (!data) return;
  const key = data.id || data.seq || residentBubble(data);
  if (!key || seenResidentIds.has(key)) return;
  seenResidentIds.add(key);
  if (data?.urgency?.quiet === true) {
    const note = String(data?.curiosity?.text || "").trim();
    if (note) {
      ctx.postChatUpdate?.(note, "ok", {
        trust: "auto",
        trustLine: trustLineFor("auto", "curiosità"),
      });
      ctx.speak?.(note, { ifUnlocked: true, yieldToCall: true });
    }
    return;
  }
  if (data.shot === "once" || data.kind === "wake") {
    const restored = formatRestore(data.restored);
    if (restored) {
      ctx.postChatUpdate?.(restored, "ok", {
        trust: "auto",
        trustLine: trustLineFor("auto", "sessione"),
      });
    }
    if (data.restored?.applyModule && data.restored.module && typeof ctx.applyModule === "function") {
      try {
        await ctx.applyModule(data.restored.module);
      } catch (err) {
        ctx.postChatUpdate?.(atlasLine(err?.message || "Modulo preferito non ripristinato."), "warn");
      }
    }
    if (data.budgetLine) {
      ctx.postChatUpdate?.(data.budgetLine, "ok", {
        trust: "auto",
        trustLine: trustLineFor("auto", "spesa"),
      });
    }
    if (data.focus?.apply && data.focus.mode === "auto" && data.focus.module && typeof ctx.applyModule === "function") {
      try {
        await ctx.applyModule(data.focus.module);
      } catch (err) {
        ctx.postChatUpdate?.(atlasLine(err?.message || "Sezione abituale non aperta."), "warn");
      }
    }
  }
  const line = residentBubble(data);
  const mode = (data.ask || []).length ? "ask" : "auto";
  if (line) ctx.postChatUpdate?.(line, "ok", { trust: mode, trustLine: data.trustLine || "" });
  const spoken = [data.summary, data.curiosity?.text].map((part) => String(part || "").trim()).filter(Boolean).join(" ");
  if (spoken) ctx.speak?.(spoken, { ifUnlocked: true, yieldToCall: true });
  await executeHandPlan(withoutMic(data), ctx, { respectCall: true, quietIfEmpty: true });
  const gated = data.integrity?.wakeGated === true;
  if (!gated && data.suggestions && data.suggestions.held !== true) {
    const planned = new Set(planFromHands(data).map((step) => step.id));
    const auto = (data.suggestions.auto || []).filter((id) => id && !planned.has(id));
    const ask = (data.suggestions.ask || []).filter((step) => step?.id && !planned.has(step.id));
    if (auto.length || ask.length) {
      await executeHandPlan(
        {
          actions: auto,
          ask,
          tagged: (data.suggestions.tagged || []).filter((step) => step?.id && !planned.has(step.id)),
        },
        ctx,
        { respectCall: true, quietIfEmpty: true },
      );
    }
  }
  if (!gated && data.focus?.command && data.focus.commandMode === "auto" && data.focus.command !== data.focus.module) {
    await executeHandPlan(
      {
        actions: [data.focus.command],
        tagged: [{ id: data.focus.command, mode: "auto", reason: "habit" }],
      },
      ctx,
      { respectCall: true, quietIfEmpty: true },
    );
  }
}

function openResidentEvents(ctx, afterSeq) {
  if (residentSource || typeof EventSource !== "function") return;
  const after = Number(afterSeq) || 0;
  const es = new EventSource(`/api/ai/agentq/resident/events?after=${after}`);
  residentSource = es;
  es.onmessage = (ev) => {
    let data = null;
    try {
      data = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (!data || data.kind === "ping") return;
    presentResident(data, ctx).catch((err) => {
      console.warn("[atlas-resident]", err?.message || err);
    });
  };
}

/**
 * L1: one wake per plancia load. L2: EventSource receives hook pushes.
 * No setInterval. Speak only when voice is already unlocked, and never during a call.
 */
export async function startAtlasResident(ctx = {}) {
  if (residentStarted) return null;
  residentStarted = true;
  const moduleName = typeof ctx.module === "function" ? ctx.module() : ctx.module || "map";
  document.documentElement.dataset.atlasResident = "1";
  let data;
  try {
    const body = ctx.restoreModule
      ? { module: "", preferStored: true, prepareHabits: true }
      : { module: moduleName || "map", prepareHabits: true };
    data = await api("/api/ai/agentq/resident/wake", {
      method: "POST",
      body: JSON.stringify(body),
    });
  } catch (err) {
    document.documentElement.dataset.atlasResident = "0";
    enableSessionWrites();
    throw err;
  }
  await presentResident(data, ctx);
  openResidentEvents(ctx, data?.seq || 0);
  enableSessionWrites();
  return data;
}

export function isHandsRequest(text) {
  return planHandsFromUtterance(text).matched || /^(?:agent\s*q|mani)\b/i.test(String(text || "").trim());
}

async function fetchHandPlan(objective) {
  return api("/api/ai/agentq/hands", {
    method: "POST",
    body: JSON.stringify({ objective }),
  });
}

/**
 * Chat and voice commands. A matched plan (zoom, module, document, briefing)
 * runs through the server Atlas plan when it answers, and through the same
 * local plan into runHoloAction when it does not.
 */
async function answerStateCommand(text, ctx) {
  const moduleName = typeof ctx.module === "function" ? ctx.module() : ctx.module || "";
  const residentOn =
    typeof document !== "undefined" && document.documentElement?.dataset?.atlasResident === "1";
  const via = ctx.via || (residentOn ? "resident" : "chat");
  try {
    const data = await api("/api/ai/agentq/state", {
      method: "POST",
      body: JSON.stringify({ question: text, module: moduleName, via }),
    });
    if (!data?.answered) {
      ctx.postChatUpdate?.(data?.reply || atlasLine("Non ho una lettura di stato per questa domanda."), "warn");
      return;
    }
    ctx.postChatUpdate?.(data.reply, "ok", { trust: data.trust?.mode || "auto", trustLine: data.trustLine });
  } catch (err) {
    ctx.postChatUpdate?.(atlasLine(err?.message || "Stato plancia non letto."), "warn");
  }
}

async function recallMemory(text, ctx) {
  const q = String(text || "")
    .replace(/^(memoria|cosa\s+ricordi|leggi\s+memoria|note\s+in\s+memoria)\s*/i, "")
    .replace(/^cerca\s+in\s+memoria\s*/i, "")
    .trim();
  const data = await api(`/api/ai/agentq/memory?limit=8&q=${encodeURIComponent(q)}`);
  const entries = data.entries || [];
  if (!entries.length) {
    ctx.postChatUpdate?.(atlasLine(q ? `Nessuna nota in memoria per «${q}».` : "La memoria non ha ancora note."), "ok", {
      trust: "auto",
      trustLine: trustLineFor("auto", "memoria"),
    });
    return;
  }
  const lines = entries.slice(0, 6).map((entry, index) => {
    return `${index + 1}. ${entry.title || "Nota"} — ${String(entry.text || "").replace(/\s+/g, " ").slice(0, 160)}`;
  });
  ctx.postChatUpdate?.(atlasLine(`Memoria (${data.count ?? entries.length})\n${lines.join("\n")}`), "ok", {
    trust: "auto",
    trustLine: trustLineFor("auto", "memoria"),
  });
}

async function presentAtlasPayload(data, ctx, trustId) {
  const line = data?.reply || data?.summary || "";
  if (line) {
    const mode = data?.ask?.length ? "ask" : "auto";
    ctx.postChatUpdate?.(line, "ok", {
      trust: mode,
      trustLine: data?.trustLine || trustLineFor(mode, trustId),
    });
    ctx.speak?.(String(line).replace(/\s+/g, " ").slice(0, 420), { ifUnlocked: true, yieldToCall: true });
  }
  if (data?.actions?.length || data?.ask?.length || data?.tagged?.length) {
    await executeHandPlan(data, ctx, { quietIfEmpty: true });
  }
}

export async function handleAtlasCommand(raw, ctx = {}) {
  const text = String(raw || "").trim();
  if (!text) return false;
  const route = routeAtlasTurn(text);
  if (route.workflowId) {
    try {
      const data = await api("/api/ai/agentq/workflows/run", {
        method: "POST",
        body: JSON.stringify({ id: route.workflowId }),
      });
      await presentAtlasPayload(data, ctx, "workflow");
    } catch (err) {
      ctx.postChatUpdate?.(atlasLine(err?.message || "Playbook non eseguito."), "warn");
    }
    return true;
  }
  if (!route.specialist) return false;
  if (route.specialist === "state" && route.intent === "problems") {
    try {
      await showProblems({
        postChatUpdate: ctx.postChatUpdate,
        runHoloAction: ctx.runHoloAction,
        resolve: route.resolve === true,
      });
    } catch (err) {
      ctx.postChatUpdate?.(atlasLine(err?.message || "Monitoraggio non disponibile"), "warn");
    }
    return true;
  }
  if (route.specialist === "state") {
    await answerStateCommand(text, ctx);
    return true;
  }
  if (route.specialist === "news") {
    try {
      const data = await api("/api/ai/agentq/route", {
        method: "POST",
        body: JSON.stringify({ message: text, module: typeof ctx.module === "function" ? ctx.module() : ctx.module || "" }),
      });
      await presentAtlasPayload(data, ctx, "news");
    } catch (err) {
      ctx.postChatUpdate?.(atlasLine(err?.message || "News non lette."), "warn");
    }
    return true;
  }
  if (route.specialist === "research" && route.intent === "refused") {
    ctx.postChatUpdate?.(ATLAS_SEARCH_REFUSAL, "warn", {
      trust: "ask",
      trustLine: trustLineFor("ask", "ricerca"),
    });
    return true;
  }
  if (route.specialist === "research" && route.intent === "memory-recall") {
    try {
      await recallMemory(text, ctx);
    } catch (err) {
      ctx.postChatUpdate?.(atlasLine(err?.message || "Memoria non letta"), "warn");
    }
    return true;
  }
  if (route.specialist === "research" && route.intent === "memory-write") {
    const note = text.replace(/^(memorizza|ricorda|salva\s+in\s+memoria)\s*/i, "").trim();
    if (!note) {
      ctx.postChatUpdate?.(atlasLine("Per espandere la memoria indica cosa salvare (es. «memorizza budget Q4»)."), "warn", {
        trust: "ask",
        trustLine: trustLineFor("ask", "memoria"),
      });
      return true;
    }
    try {
      const data = await api("/api/ai/agentq/memory", {
        method: "POST",
        body: JSON.stringify({ title: note.slice(0, 80), text: note, tags: ["voice"] }),
      });
      ctx.postChatUpdate?.(
        atlasLine(`Memoria aggiornata (${data.count} note). Id: ${data.entry?.id || "—"}.`),
        "ok",
        { trust: "auto", trustLine: trustLineFor("auto", "memoria") },
      );
      ctx.speak?.(`Memoria aggiornata. Ora ho ${data.count} note.`);
    } catch (err) {
      ctx.postChatUpdate?.(atlasLine(err?.message || "Memoria non aggiornata"), "warn");
    }
    return true;
  }
  if (route.specialist === "research") {
    const q = extractSearchQuery(text);
    await runOnDemandSearch(q, {
      postChatUpdate: ctx.postChatUpdate,
      openDoc: true,
    });
    return true;
  }
  if (route.specialist !== "hands") return false;

  const local = planHandsFromUtterance(text);
  const handsPrefix = /^(?:agent\s*q|mani)\b/i.test(text);
  if (!local.matched && !handsPrefix) return false;

  let data = null;
  try {
    data = ctx.resolveHands ? await ctx.resolveHands(text, local) : await fetchHandPlan(text);
  } catch (err) {
    data = null;
    if (local.matched) {
      ctx.postChatUpdate?.(atlasLine(`Mani in locale: ${err?.message || "piano server non raggiunto"}.`), "warn");
    } else {
      ctx.postChatUpdate?.(atlasLine(err?.message || "Piano mani non disponibile."), "warn");
      return true;
    }
  }
  if (data && local.document && !data.document) data = { ...data, document: local.document };
  if (data && local.briefing) data = { ...data, briefing: true };
  const hasSteps = data && (data.actions?.length || data.ask?.length || data.tagged?.length);
  if (!hasSteps) {
    if (local.matched) data = payloadFromLocalPlan(local);
    else {
      ctx.postChatUpdate?.(atlasLine("Nessuna azione plancia per questo comando."), "warn", {
        trust: "ask",
        trustLine: trustLineFor("ask", "mani"),
      });
      return true;
    }
  }
  if (data.speak) {
    ctx.postChatUpdate?.(`Atlas: ${data.speak}`);
    ctx.speak?.(data.speak);
  }
  await executeHandPlan(data, ctx, { quietIfEmpty: true });
  return true;
}

export async function wireAgentqUi(ctx) {
  ensurePopup();
  const handleAgentqCommand = (raw, opts = {}) => handleAtlasCommand(raw, { ...ctx, ...opts });
  window.__opsOpenDoc = (rel) => openSandboxDoc(rel, ctx);
  window.__opsAgentqHandle = handleAgentqCommand;
  // Resident wake once per boot. Raw ingress dump only if that one shot fails.
  try {
    await startAtlasResident(ctx);
  } catch (err) {
    console.warn("[atlas-resident] wake", err?.message || err);
    await showEntryUpdates(ctx);
  }

  // Comandi dalla barra Analizza e dal microfono: stesso piano mani.
  const input = $("chatInput");
  const send = $("sendChat");
  if (!input || input.dataset.agentqWired) return;
  input.dataset.agentqWired = "1";

  const origClick = send?.onclick;
  send?.addEventListener(
    "click",
    async (e) => {
      const text = input.value.trim();
      if (!text) return;
      try {
        const handled = await handleAgentqCommand(text);
        if (handled) {
          e.preventDefault();
          e.stopImmediatePropagation();
          input.value = "";
        }
      } catch (err) {
        ctx.postChatUpdate?.(err?.message || "Atlas errore", "warn");
      }
    },
    true,
  );
  void origClick;
}
