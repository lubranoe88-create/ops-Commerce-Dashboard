/**
 * J6 operator cockpit. Live tool calls, pending ASK, decision tail, resident.
 * Polling lives here so the resident client stays free of timers.
 */
const OPEN_MS = 4000;
const WATCH_MS = 20000;

let openTimer = null;
let watchTimer = null;
let panelOpen = false;
let lastSpokenKey = "";

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function hidePanel(id) {
  const panel = document.getElementById(id);
  if (!panel || panel.hidden) return;
  const close = panel.querySelector("button[id$='Close']");
  if (close && close.id !== "cockpitClose") close.click();
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  panel.classList.remove("is-open");
}

function renderList(items, empty, map) {
  if (!items?.length) return `<p class="muted">${escapeHtml(empty)}</p>`;
  return `<ul>${items.map(map).join("")}</ul>`;
}

function renderCockpit(data) {
  const body = document.getElementById("cockpitBody");
  const summary = document.getElementById("cockpitSummary");
  if (!body) return;
  const resident = data?.resident || {};
  if (summary) {
    summary.textContent = resident.awake ? "Residente sveglio" : "Residente in attesa";
  }
  const tools = renderList(data?.toolCalls, "Nessuna chiamata tool.", (row) => {
    const flag = row.stub ? "stub" : row.mode === "ask" ? "ASK" : "AUTO";
    return `<li><span class="mono">${escapeHtml(flag)}</span> ${escapeHtml(row.name)} <span class="muted">${escapeHtml(row.detail || "")}</span></li>`;
  });
  const asks = renderList(data?.pendingAsk, "Nessuna approvazione ASK in attesa.", (row) => {
    return `<li>ASK ${escapeHtml(row.id)} <span class="muted">${escapeHtml(row.reason || "")} · ${row.count || 0}/${row.threshold || 3}</span></li>`;
  });
  const decisions = renderList(data?.decisions, "Nessuna decisione registrata.", (row) => {
    const bits = (row.choices || []).map((choice) => `${choice.action} ${String(choice.mode || "").toUpperCase()}`).join(", ");
    return `<li><span class="mono">${escapeHtml(row.source)}</span> ${escapeHtml(bits)} <span class="muted">${escapeHtml(row.because || "")}</span></li>`;
  });
  const runs = renderList(data?.runs, "Nessun run aperto.", (row) => {
    return `<li>${escapeHtml(row.title || row.id)} <span class="mono">${escapeHtml(row.status)}</span> cursore ${row.cursor ?? 0}
      <button type="button" class="pill-btn" data-resume-run="${escapeHtml(row.id)}">Riprendi</button></li>`;
  });
  const jobs = renderList(data?.schedule, "Nessun job in agenda.", (row) => {
    const last = row.lastResult;
    const state = last ? (last.quiet ? "silenzio" : "annunciato") : "mai eseguito";
    return `<li>${escapeHtml(row.title || row.id)} <span class="muted">${escapeHtml(state)} · prossimo ${escapeHtml(row.nextAt || "—")}</span></li>`;
  });
  body.innerHTML = `
    <article class="cockpit-card">
      <h3>Residente</h3>
      <p>${escapeHtml(resident.name || "Atlas")} · ${resident.awake ? "sveglio" : "non sveglio"} · ascolti ${resident.listeners ?? 0}</p>
      <p class="muted mono">Ultimo risveglio: ${escapeHtml(resident.lastWakeAt || "—")}</p>
    </article>
    <article class="cockpit-card"><h3>Chiamate tool</h3>${tools}</article>
    <article class="cockpit-card"><h3>ASK in attesa</h3>${asks}</article>
    <article class="cockpit-card"><h3>Decisioni</h3>${decisions}</article>
    <article class="cockpit-card"><h3>Run</h3>${runs}</article>
    <article class="cockpit-card"><h3>Agenda</h3>${jobs}</article>`;
  body.querySelectorAll("[data-resume-run]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-resume-run");
      try {
        const resumed = await api(`/api/ai/agentq/runs/${encodeURIComponent(id)}/resume`, { method: "POST", body: "{}" });
        const line = resumed.reply || resumed.summary;
        if (line && typeof window.__opsAtlasDigest === "function") window.__opsAtlasDigest(line);
        for (const action of resumed.actions || []) window.__opsRun?.(action);
        await refreshCockpit();
      } catch (err) {
        body.insertAdjacentHTML("afterbegin", `<p class="muted">${escapeHtml(err.message || "Ripresa non riuscita")}</p>`);
      }
    });
  });
}

export async function refreshCockpit() {
  const data = await api("/api/ai/agentq/cockpit");
  renderCockpit(data);
  return data;
}

async function watchDigests() {
  try {
    const data = await api("/api/ai/agentq/schedule");
    for (const job of data.jobs || []) {
      const last = job.lastResult;
      if (!last?.spoken || !last.summary) continue;
      const key = `${job.id}:${last.at}`;
      if (key === lastSpokenKey) continue;
      lastSpokenKey = key;
      window.__opsAtlasDigest?.(last.summary);
    }
  } catch {
    /* the plancia may still be behind the password gate */
  }
}

function startOpenPoll() {
  if (openTimer) clearInterval(openTimer);
  openTimer = setInterval(() => {
    if (!panelOpen) return;
    refreshCockpit().catch(() => {});
  }, OPEN_MS);
}

export function openCockpitPanel() {
  const panel = document.getElementById("cockpitPanel");
  if (!panel) return;
  hidePanel("functionBoardPanel");
  panel.hidden = false;
  panel.setAttribute("aria-hidden", "false");
  panel.classList.add("is-open");
  panelOpen = true;
  document.body.dataset.atlasCockpit = "1";
  startOpenPoll();
  refreshCockpit().catch((err) => {
    const body = document.getElementById("cockpitBody");
    if (body) body.innerHTML = `<p class="muted">${escapeHtml(err.message || "Cockpit non letto")}</p>`;
  });
}

export function closeCockpitPanel() {
  const panel = document.getElementById("cockpitPanel");
  if (!panel) return;
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  panel.classList.remove("is-open");
  panelOpen = false;
  document.body.dataset.atlasCockpit = "0";
  if (openTimer) clearInterval(openTimer);
  openTimer = null;
}

export function toggleCockpitPanel() {
  const panel = document.getElementById("cockpitPanel");
  if (!panel || panel.hidden) openCockpitPanel();
  else closeCockpitPanel();
}

export function wireCockpitUi() {
  const panel = document.getElementById("cockpitPanel");
  if (!panel || panel.dataset.wired === "1") return;
  panel.dataset.wired = "1";
  panel.hidden = true;
  document.getElementById("cockpitClose")?.addEventListener("click", () => closeCockpitPanel());
  document.getElementById("cockpitRefresh")?.addEventListener("click", () => {
    refreshCockpit().catch(() => {});
  });
  panel.addEventListener("click", (event) => {
    if (event.target === panel) closeCockpitPanel();
  });
  if (!watchTimer) {
    watchTimer = setInterval(() => {
      watchDigests().catch(() => {});
    }, WATCH_MS);
  }
}
