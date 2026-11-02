/**
 * Agent Q UI — plancia OPS
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

/** Mostra ultimi aggiornamenti all'ingresso plancia (chat + toast). */
export async function showEntryUpdates({ postChatUpdate, showToast } = {}) {
  try {
    const data = await api("/api/ai/agentq/updates");
    const updates = data.updates || [];
    if (!updates.length) return;
    const lines = updates.slice(0, 5).map((u, i) => `${i + 1}. ${u.title}: ${u.detail || ""}`);
    const msg = `Aggiornamenti recenti Agent Q\n${lines.join("\n")}`;
    postChatUpdate?.(msg, "ok");
    showToast?.(`Agent Q · ${updates.length} aggiornamenti`, "ok");
  } catch (err) {
    console.warn("[agentq] updates", err?.message || err);
  }
}

/**
 * Ricerca Agent Q — solo se l'utente lo chiede esplicitamente.
 * trigger phrases: "cerca", "ricerca", "search", "agent q cerca"
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
    postChatUpdate?.("Per la ricerca Agent Q indica cosa cercare (es. «cerca budget»).", "warn");
    return null;
  }
  postChatUpdate?.(`Agent Q · ricerca on-demand: ${q}`);
  const data = await api("/api/ai/agentq/search", {
    method: "POST",
    body: JSON.stringify({ query: q, sources: ["filesystem", "api", "web_hint"] }),
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
  postChatUpdate?.(`Risultati Agent Q (${hits.length})\n${lines.join("\n")}`);

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

export async function runHands(objective, { runHoloAction, postChatUpdate, speak } = {}) {
  const data = await api("/api/ai/agentq/hands", {
    method: "POST",
    body: JSON.stringify({ objective }),
  });
  const actions = data.actions || [];
  if (data.speak) {
    postChatUpdate?.(`Agent Q: ${data.speak}`);
    speak?.(data.speak, { force: true });
  }
  for (const id of actions) {
    postChatUpdate?.(`Mani · ${id}`);
    await runHoloAction?.(id, { fromVoice: false });
  }
  if (!actions.length) {
    postChatUpdate?.("Agent Q: nessuna azione plancia proposta per questo obiettivo.", "warn");
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
        ctx.postChatUpdate?.(err?.message || "Agent Q errore", "warn");
      }
    },
    true,
  );
  void origClick;
}
