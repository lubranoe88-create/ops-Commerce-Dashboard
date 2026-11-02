/**
 * Atlas plancia UI. Internal ids and /api/ai/agentq paths stay as-is.
 * - Aggiornamenti all'ingresso
 * - Ricerca on-demand (sandbox + API + web hint)
 * - Pop-up documenti
 * - Mani: esegue azioni plancia via runHoloAction
 */

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
      const msg = `Aggiornamenti recenti Atlas\n${lines.join("\n")}`;
      postChatUpdate?.(msg, "ok");
      showToast?.(`Atlas · ${updates.length} aggiornamenti`, "ok");
    } else {
      showToast?.("Atlas · nessun aggiornamento nuovo", "ok");
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
        `Monitoraggio Atlas · ${n} problemi da sistemare\n${lines.join("\n")}`,
        "warn",
      );
      showToast?.(`Atlas · ${n} problemi`, "warn");
    } else {
      postChatUpdate?.("Monitoraggio Atlas · nessun problema aperto.", "ok");
    }
  } catch (err) {
    console.warn("[agentq] problems", err?.message || err);
    showToast?.(`Monitoraggio non caricato: ${err?.message || err}`, "warn");
    postChatUpdate?.(`Monitoraggio ingresso fallito: ${err?.message || err}`, "warn");
  }
}

export async function showProblems({ postChatUpdate } = {}) {
  const probs = await api("/api/ai/agentq/problems");
  const list = probs.problems || [];
  if (!list.length) {
    postChatUpdate?.("Nessun errore o problema aperto sulla plancia.", "ok");
    return probs;
  }
  const lines = list.map(
    (p, i) => `${i + 1}. [${p.kind}/${p.severity}] ${p.title} — ${p.detail || p.status}`,
  );
  postChatUpdate?.(`Problemi plancia (${list.length})\n${lines.join("\n")}`, "warn");
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

export async function runOnDemandSearch(query, { postChatUpdate, openDoc } = {}) {
  const q = String(query || "").trim();
  if (!q) {
    postChatUpdate?.("Per la ricerca Atlas indica cosa cercare (es. «cerca budget»).", "warn");
    return null;
  }
  postChatUpdate?.(`Atlas · ricerca on-demand: ${q}`);
  const data = await api("/api/ai/agentq/search", {
    method: "POST",
    body: JSON.stringify({
      query: q,
      sources: ["filesystem", "database", "memory", "api", "web_hint"],
    }),
  });
  const hits = data.hits || [];
  if (!hits.length) {
    postChatUpdate?.(
      `Nessun risultato.${(data.errors || []).length ? " " + data.errors.join("; ") : ""}`,
      "warn",
    );
    return data;
  }
  const lines = hits.slice(0, 8).map((h, i) => {
    return `${i + 1}. [${h.source}] ${h.title} — ${h.snippet || ""}${h.uri ? ` · ${h.uri}` : ""}`;
  });
  postChatUpdate?.(`Risultati Atlas (${hits.length})\n${lines.join("\n")}`);

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
 * Client mirror of atlasAutonomyPolicy AUTO ids (L3).
 * Dangerous classes always ask, even if a payload says mode "auto".
 * Unknown ids ask. Keep this set aligned with backend AUTO_MATRIX.
 */
const AUTO_HANDS = new Set([
  "map",
  "pipeline",
  "memory",
  "chat",
  "zoom-in",
  "zoom-out",
  "zoom-citta",
  "zoom-paese",
  "zoom-continente",
  "orbit",
  "nord",
  "fly",
  "focus-top",
  "strumenti",
  "inspect",
  "analizza",
  "mic",
  "confronta",
  "filtro-score",
  "filtro-reset",
  "coverage-next",
  "tema-cyan",
  "tema-amber",
  "tema-mint",
  "read",
  "search",
  "document",
  "sandbox-read",
  "memory-list",
  "memory-read",
  "problems",
  "web-hint",
  "web_hint",
  "wikipedia",
  "status",
  "agentq-status",
  "function-board",
  "budget-status",
  "health",
  "controlli",
  "funzionamento",
  "refresh",
  "updates",
  "news",
  "entry-updates",
  "updates-read",
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
  if (s.startsWith("zoom-") || s.startsWith("zoom_") || s.startsWith("tema-") || s.startsWith("tema_")) {
    return true;
  }
  if (s === "refresh" || s.startsWith("refresh-") || s.startsWith("refresh_")) return true;
  return false;
}

/** Reason token for ASK classes. "unknown" means not in a dangerous class. */
function approvalReason(id) {
  const s = String(id || "").toLowerCase();
  const flat = s.replace(/[_-]/g, "");
  if (flat.includes("browseruse")) return "browser-use";
  if (
    /(credential|password|passwd|secret|totp|api[-_]?key|apikey|2fa)/.test(s) ||
    /^(login|otp|token|passcode)([-_]|$)/.test(s)
  ) {
    return "credentials";
  }
  if (s.includes("export") || /^(dump|backup|download)([-_]|$)/.test(s)) return "export";
  if (
    /(^|[-_])(delete|wipe|destroy|purge|truncate|overwrite|drop|remove|clear)([-_]|$)/.test(s) ||
    /^(correct|reorder-tops|accept-suggestion)$/.test(s) ||
    s.startsWith("reorder") ||
    s.startsWith("correct-") ||
    s.startsWith("correct_")
  ) {
    return "destructive-write";
  }
  if (/spend[-_]?past[-_]?soft|^spend([-_]|$)|^escalate([-_]|$)/.test(s)) return "spend-past-soft-band";
  return "unknown";
}

function stepNeedsApproval(step) {
  const id = step?.id || "";
  if (!id) return true;
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
    const mode =
      item && typeof item === "object" && (item.mode === "ask" || item.mode === "auto")
        ? item.mode
        : fromAskList
          ? "ask"
          : "auto";
    const reason =
      item && typeof item === "object" && item.reason ? String(item.reason) : approvalReason(id);
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

export async function runHands(objective, { runHoloAction, postChatUpdate, speak } = {}) {
  const data = await api("/api/ai/agentq/hands", {
    method: "POST",
    body: JSON.stringify({ objective }),
  });
  if (data.speak) {
    postChatUpdate?.(`Atlas: ${data.speak}`);
    speak?.(data.speak);
  }
  const plan = planFromHands(data);
  if (!plan.length) {
    postChatUpdate?.("Atlas: nessuna azione plancia proposta per questo obiettivo.", "warn");
    return data;
  }
  for (const step of plan) {
    if (stepNeedsApproval(step)) {
      const reason = step.reason || approvalReason(step.id);
      let ok = false;
      try {
        ok = window.confirm(
          `Atlas ha bisogno di approvazione per «${step.id}» (${reason}). Eseguire?`,
        );
      } catch {
        ok = false;
      }
      if (!ok) {
        postChatUpdate?.(
          `Atlas ha bisogno di approvazione per «${step.id}» (${reason}). Azione non eseguita.`,
          "warn",
        );
        continue;
      }
      postChatUpdate?.(`Mani · ${step.id} · approvata`);
    } else {
      postChatUpdate?.(`Mani · ${step.id}`);
    }
    await runHoloAction?.(step.id, { fromVoice: false });
  }
  return data;
}

export function isHandsRequest(text) {
  const t = String(text || "").toLowerCase();
  return /\b(apri|vai|mostra|zoom|mani|controlla modulo|agent\s*q)\b/.test(t);
}

export async function wireAgentqUi(ctx) {
  ensurePopup();
  // Aggiornamenti all'ingresso (una volta per boot)
  await showEntryUpdates(ctx);

  // Comandi dalla barra Analizza: intercept search / hands before normal chat when prefixed
  const input = $("chatInput");
  const send = $("sendChat");
  if (!input || input.dataset.agentqWired) return;
  input.dataset.agentqWired = "1";

  const handleAgentqCommand = async (raw) => {
    const text = String(raw || "").trim();
    if (!text) return false;
    if (isSearchRequest(text)) {
      const q = extractSearchQuery(text);
      await runOnDemandSearch(q, {
        postChatUpdate: ctx.postChatUpdate,
        openDoc: true,
      });
      return true;
    }
    if (/^(problemi|errori|monitoraggio|cosa\s+da\s+sistemare)\b/i.test(text)) {
      try {
        await showProblems({ postChatUpdate: ctx.postChatUpdate });
      } catch (err) {
        ctx.postChatUpdate?.(err?.message || "Monitoraggio non disponibile", "warn");
      }
      return true;
    }
    if (/^(memorizza|ricorda|salva\s+in\s+memoria)\b/i.test(text)) {
      const note = text.replace(/^(memorizza|ricorda|salva\s+in\s+memoria)\s*/i, "").trim();
      if (!note) {
        ctx.postChatUpdate?.("Per espandere la memoria indica cosa salvare (es. «memorizza budget Q4»).", "warn");
        return true;
      }
      try {
        const data = await api("/api/ai/agentq/memory", {
          method: "POST",
          body: JSON.stringify({ title: note.slice(0, 80), text: note, tags: ["voice"] }),
        });
        ctx.postChatUpdate?.(
          `Memoria Atlas aggiornata (${data.count} note). Id: ${data.entry?.id || "—"}`,
          "ok",
        );
        ctx.speak?.(`Memoria aggiornata. Ora ho ${data.count} note.`);
      } catch (err) {
        ctx.postChatUpdate?.(err?.message || "Memoria non aggiornata", "warn");
      }
      return true;
    }
    if (/^apri\s+documento\s+/i.test(text)) {
      const rel = text.replace(/^apri\s+documento\s+/i, "").trim();
      await openSandboxDoc(rel.startsWith("sandbox://") ? rel : `sandbox://${rel}`, ctx);
      return true;
    }
    if (/^(agent\s*q|mani)\b/i.test(text) || /^(apri|zoom)\s+(mappa|pipeline|memory|chat|globo)/i.test(text)) {
      await runHands(text, ctx);
      return true;
    }
    return false;
  };

  // Expose for mic/voice path
  window.__opsAgentqHandle = handleAgentqCommand;

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
