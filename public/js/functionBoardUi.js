/**
 * Quadro 2D funzioni plancia — griglia affiancata, poll live, alert AI.
 */
const POLL_MS = 20000;

let pollTimer = null;
let lastBoard = null;

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(opts.body ? { "Content-Type": "application/json" } : {}) },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function statusLabel(status) {
  if (status === "ok") return "funzionante";
  // Plain wording only — never ✗ / X / barrato (looks like deleted from list).
  if (status === "error") return "errore runtime";
  return "non verificata";
}

function formatErrorLine(fn) {
  const type = String(fn?.errorType || "").trim();
  const detail = String(fn?.detail || "").trim();
  if (type && detail) return `${type} · ${detail}`;
  return type || detail || "errore runtime";
}

function renderBoard(board) {
  lastBoard = board;
  const host = document.getElementById("functionBoardGrid");
  const summaryEl = document.getElementById("functionBoardSummary");
  const stampEl = document.getElementById("functionBoardStamp");
  if (!host) return;

  const list = Array.isArray(board?.functions) ? board.functions : [];
  host.replaceChildren();

  for (const fn of list) {
    const status = fn.status || "unverified";
    const cell = document.createElement("article");
    cell.className = `fn-cell fn-cell--${status}`;
    cell.dataset.fnId = fn.id;
    cell.dataset.status = status;
    cell.title = [fn.errorType, fn.detail].filter(Boolean).join(" · ");

    const head = document.createElement("div");
    head.className = "fn-cell-head";

    const mark = document.createElement("span");
    mark.className = `fn-cell-mark fn-cell-mark--${status}`;
    mark.setAttribute("aria-hidden", "true");
    // Red filled dot / amber dot / green dot — never a cross glyph.
    mark.textContent = "";

    const name = document.createElement("div");
    name.className = "fn-cell-name";
    name.textContent = fn.label || fn.id;

    head.append(mark, name);

    const st = document.createElement("div");
    st.className = "fn-cell-status";
    st.textContent = statusLabel(status);

    cell.append(head, st);

    if (status === "error") {
      const err = document.createElement("div");
      err.className = "fn-cell-error";
      err.textContent = formatErrorLine(fn);
      cell.append(err);
    } else if (fn.detail) {
      const det = document.createElement("div");
      det.className = "fn-cell-detail";
      det.textContent = fn.detail;
      cell.append(det);
    }

    host.append(cell);
  }

  if (summaryEl && board?.summary) {
    const s = board.summary;
    summaryEl.textContent = `${s.ok} ok · ${s.error} errori · ${s.unverified} n/v · ${s.total} tot`;
    summaryEl.dataset.errorCount = String(s.error || 0);
  }
  if (stampEl) {
    const t = board?.updatedAt ? new Date(board.updatedAt) : new Date();
    stampEl.textContent = t.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }
}

/** Client-side DOM probes refine UX cells. */
async function pushClientDomProbes() {
  const probes = [
    { id: "ux-stats-strip", el: "#statsStrip, #statDay" },
    { id: "ux-refresh", el: "#refreshBtn" },
    { id: "ux-tops-filter", el: "#mapFilterChips" },
    { id: "ux-prompt-chips", el: "#chatPromptChips" },
    { id: "ux-thread-export", el: "#exportChatBtn" },
    { id: "ux-toasts", el: "#toastHost" },
    { id: "ux-cost-hint", el: "#chatModelHint" },
    { id: "dock-rail", el: "#holoVoicePlancia .dock-btn" },
    { id: "globe-map", el: "#glCanvas" },
    { id: "analizza", el: "#analizzaBar, #chatInput" },
    { id: "busy-mark", el: "#aiBusyMark" },
    { id: "briefing", el: "#aiBriefingModal" },
    { id: "chat-attachments", el: "#chatAttachInput" },
    { id: "mic-voice", el: "#globalMic, #chatMic" },
  ];
  for (const p of probes) {
    const found = Boolean(document.querySelector(p.el));
    try {
      await api("/api/ai/function-board/report", {
        method: "POST",
        body: JSON.stringify({
          functionId: p.id,
          status: found ? "ok" : "error",
          errorType: found ? "" : "DOM_MISSING",
          detail: found ? "DOM presente" : `Selettore assente: ${p.el}`,
          source: "client",
        }),
      });
    } catch {
      /* ignore individual probe failures */
    }
  }
}

function renderBoardError(message) {
  renderBoard({
    updatedAt: new Date().toISOString(),
    summary: { ok: 0, error: 1, unverified: 0, total: 1 },
    functions: [
      {
        id: "board-fetch",
        label: "Quadro live",
        group: "meta",
        status: "error",
        errorType: "FETCH",
        detail: message || "Impossibile aggiornare il quadro",
        source: "client",
      },
    ],
  });
}

export async function refreshFunctionBoard({ withDomProbes = false } = {}) {
  try {
    if (withDomProbes) await pushClientDomProbes().catch(() => {});
    const board = await api("/api/ai/function-board");
    renderBoard(board);
    return board;
  } catch (err) {
    renderBoardError(err?.message || "fetch failed");
    throw err;
  }
}

export function startFunctionBoardPolling(intervalMs = POLL_MS) {
  stopFunctionBoardPolling();
  const tick = async () => {
    try {
      await refreshFunctionBoard({ withDomProbes: false });
    } catch (err) {
      console.warn("[function-board]", err?.message || err);
    }
  };
  tick();
  // First tick with DOM probes shortly after paint
  setTimeout(() => refreshFunctionBoard({ withDomProbes: true }).catch(() => {}), 2500);
  pollTimer = setInterval(tick, intervalMs);
  return () => stopFunctionBoardPolling();
}

export function stopFunctionBoardPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

export function getLastFunctionBoard() {
  return lastBoard;
}

/** After AI actions run — if report-function present, refresh board immediately. */
export function noteAiFunctionReports(actions) {
  const list = Array.isArray(actions) ? actions : [];
  const hit = list.some((a) => {
    const t = typeof a === "string" ? a : a?.type;
    return t === "report-function";
  });
  if (hit) {
    refreshFunctionBoard({ withDomProbes: false }).catch(() => {});
  }
}

function ensureFunctionBoardDom() {
  let root = document.getElementById("functionBoard");
  const dock = document.getElementById("bottomDock");
  const analizza = document.getElementById("analizzaBar");
  if (root && document.getElementById("functionBoardGrid")) {
    // Keep board between tools and Analizza even after older HTML deploys.
    if (dock && analizza && root.parentElement !== dock) {
      dock.insertBefore(root, analizza);
    } else if (dock && analizza && root.nextElementSibling !== analizza) {
      dock.insertBefore(root, analizza);
    }
    root.classList.remove("is-collapsed");
    return root;
  }

  root = document.createElement("section");
  root.id = "functionBoard";
  root.className = "function-board";
  root.setAttribute("aria-label", "Quadro stato funzioni plancia");
  root.innerHTML = `
    <header class="function-board-head">
      <div class="function-board-title-wrap">
        <h2 class="function-board-title">Quadro funzioni</h2>
        <span id="functionBoardSummary" class="function-board-summary mono muted">—</span>
        <span id="functionBoardStamp" class="function-board-stamp mono muted"></span>
      </div>
      <div class="function-board-actions">
        <button type="button" id="functionBoardRefresh" class="pill-btn" title="Aggiorna ora">Aggiorna</button>
        <button type="button" id="functionBoardToggle" class="pill-btn" aria-expanded="true">Comprimi quadro</button>
      </div>
    </header>
    <div id="functionBoardGrid" class="function-board-grid" role="list"></div>
  `;
  if (dock && analizza) dock.insertBefore(root, analizza);
  else if (dock) dock.appendChild(root);
  else document.querySelector(".page-shell")?.appendChild(root);
  return root;
}

export function wireFunctionBoardUi() {
  const root = ensureFunctionBoardDom();
  if (!root) return;
  root.classList.remove("is-collapsed");
  if (root.dataset.wired === "1") return;
  root.dataset.wired = "1";

  const toggle = document.getElementById("functionBoardToggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      const collapsed = root.classList.toggle("is-collapsed");
      toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      toggle.textContent = collapsed ? "Espandi quadro" : "Comprimi quadro";
    });
  }
  const refreshBtn = document.getElementById("functionBoardRefresh");
  refreshBtn?.addEventListener("click", () => {
    refreshFunctionBoard({ withDomProbes: true }).catch((err) => {
      console.warn("[function-board] refresh", err?.message || err);
    });
  });
}
