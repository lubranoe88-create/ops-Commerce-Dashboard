/**
 * Quadro 2D funzioni plancia — pannello separato (non in home), poll live, fili dipendenze.
 */
const POLL_MS = 20000;

let pollTimer = null;
let lastBoard = null;
let panelOpen = false;
let resizeWired = false;

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
  if (status === "error") return "errore runtime";
  return "non verificata";
}

function formatErrorLine(fn) {
  const type = String(fn?.errorType || "").trim();
  const detail = String(fn?.detail || "").trim();
  if (type && detail) return `${type} · ${detail}`;
  return type || detail || "errore runtime";
}

function wireTone(fromStatus, toStatus) {
  if (fromStatus === "error" || toStatus === "error" || fromStatus === "unverified" || toStatus === "unverified") {
    return "bad";
  }
  return "ok";
}

function drawWires(board) {
  const svg = document.getElementById("functionBoardWires");
  const host = document.getElementById("functionBoardGrid");
  if (!svg || !host) return;
  const edges = Array.isArray(board?.edges) ? board.edges : [];
  const wrap = host.parentElement;
  const wr = wrap?.getBoundingClientRect?.() || host.getBoundingClientRect();
  svg.setAttribute("width", String(Math.max(1, Math.round(wr.width))));
  svg.setAttribute("height", String(Math.max(1, Math.round(wr.height))));
  svg.setAttribute("viewBox", `0 0 ${Math.max(1, wr.width)} ${Math.max(1, wr.height)}`);
  svg.replaceChildren();

  const byId = new Map((board?.functions || []).map((f) => [f.id, f]));
  for (const edge of edges) {
    const a = host.querySelector(`.fn-cell[data-fn-id="${CSS.escape(edge.from)}"]`);
    const b = host.querySelector(`.fn-cell[data-fn-id="${CSS.escape(edge.to)}"]`);
    if (!a || !b) continue;
    const ar = a.getBoundingClientRect();
    const br = b.getBoundingClientRect();
    const x1 = ar.left + ar.width / 2 - wr.left;
    const y1 = ar.top + ar.height / 2 - wr.top;
    const x2 = br.left + br.width / 2 - wr.left;
    const y2 = br.top + br.height / 2 - wr.top;
    const midX = (x1 + x2) / 2;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`);
    const tone = wireTone(byId.get(edge.from)?.status, byId.get(edge.to)?.status);
    path.setAttribute("class", `fn-wire fn-wire--${tone}`);
    path.setAttribute("data-label", edge.label || "");
    svg.appendChild(path);
  }
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
    cell.dataset.group = fn.group || "other";
    cell.title = [fn.errorType, fn.detail].filter(Boolean).join(" · ");

    const head = document.createElement("div");
    head.className = "fn-cell-head";

    const mark = document.createElement("span");
    mark.className = `fn-cell-mark fn-cell-mark--${status}`;
    mark.setAttribute("aria-hidden", "true");

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
    stampEl.textContent = t.toLocaleTimeString("it-IT", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  }

  requestAnimationFrame(() => drawWires(board));
}

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
      /* ignore */
    }
  }
}

function renderBoardError(message) {
  renderBoard({
    updatedAt: new Date().toISOString(),
    summary: { ok: 0, error: 1, unverified: 0, total: 1 },
    edges: [],
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
    if (!panelOpen) return;
    try {
      await refreshFunctionBoard({ withDomProbes: false });
    } catch (err) {
      console.warn("[function-board]", err?.message || err);
    }
  };
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

export function noteAiFunctionReports(actions) {
  const list = Array.isArray(actions) ? actions : [];
  const hit = list.some((a) => {
    const t = typeof a === "string" ? a : a?.type;
    return t === "report-function";
  });
  if (hit && panelOpen) {
    refreshFunctionBoard({ withDomProbes: false }).catch(() => {});
  }
}

export function openFunctionBoardPanel() {
  const panel = document.getElementById("functionBoardPanel");
  if (!panel) return;
  panel.hidden = false;
  panel.setAttribute("aria-hidden", "false");
  panel.classList.add("is-open");
  document.body.dataset.functionBoard = "1";
  panelOpen = true;
  startFunctionBoardPolling(POLL_MS);
  refreshFunctionBoard({ withDomProbes: true }).catch(() => {});
}

export function closeFunctionBoardPanel() {
  const panel = document.getElementById("functionBoardPanel");
  if (!panel) return;
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  panel.classList.remove("is-open");
  document.body.dataset.functionBoard = "0";
  panelOpen = false;
  stopFunctionBoardPolling();
}

export function toggleFunctionBoardPanel() {
  const panel = document.getElementById("functionBoardPanel");
  if (!panel || panel.hidden) openFunctionBoardPanel();
  else closeFunctionBoardPanel();
}

export function wireFunctionBoardUi() {
  const root = document.getElementById("functionBoard");
  const panel = document.getElementById("functionBoardPanel");
  if (!root || !panel) return;
  if (root.dataset.wired === "1") return;
  root.dataset.wired = "1";

  // Never remount into home bottom-dock — panel-only.
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  panelOpen = false;

  document.getElementById("funzionamentoPlanciaBtn")?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleFunctionBoardPanel();
  });
  document.getElementById("functionBoardClose")?.addEventListener("click", () => closeFunctionBoardPanel());
  document.getElementById("functionBoardRefresh")?.addEventListener("click", () => {
    refreshFunctionBoard({ withDomProbes: true }).catch((err) => {
      console.warn("[function-board] refresh", err?.message || err);
    });
  });
  panel.addEventListener("click", (e) => {
    if (e.target === panel) closeFunctionBoardPanel();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panelOpen) closeFunctionBoardPanel();
  });

  if (!resizeWired) {
    resizeWired = true;
    window.addEventListener("resize", () => {
      if (panelOpen && lastBoard) drawWires(lastBoard);
    });
  }
}
