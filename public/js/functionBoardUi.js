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
  if (status === "error") return "in errore";
  return "non verificata";
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
    const cell = document.createElement("article");
    cell.className = `fn-cell fn-cell--${fn.status || "unverified"}`;
    cell.dataset.fnId = fn.id;
    cell.title = [fn.detail, fn.errorType].filter(Boolean).join(" · ");

    const name = document.createElement("div");
    name.className = "fn-cell-name";
    name.textContent = fn.label || fn.id;

    const st = document.createElement("div");
    st.className = "fn-cell-status";
    st.textContent = statusLabel(fn.status);

    cell.append(name, st);

    if (fn.status === "error") {
      const err = document.createElement("div");
      err.className = "fn-cell-error";
      err.textContent = fn.errorType
        ? `${fn.errorType}${fn.detail ? ` — ${fn.detail}` : ""}`
        : fn.detail || "errore";
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

export function wireFunctionBoardUi() {
  const root = document.getElementById("functionBoard");
  const toggle = document.getElementById("functionBoardToggle");
  if (toggle && root) {
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
