/**
 * Live MEMORY panel on the plancia.
 * Shows expandable.json notes (+ SQLite concepts) and polls while open so new
 * writes appear without a manual refresh. X4 graph rendering stays available.
 */
const POLL_MS = 2500;
let selectedId = "";
let pollTimer = null;
let lastRevision = "";
let panelOpen = false;

async function api(path) {
  const res = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
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

function hideOthers() {
  for (const id of ["functionBoardClose", "cockpitClose"]) {
    document.getElementById(id)?.click();
  }
}

function layout(nodes) {
  const points = new Map();
  const count = Math.max(nodes.length, 1);
  nodes.forEach((node, index) => {
    const angle = -Math.PI / 2 + (index / count) * Math.PI * 2;
    points.set(node.id, {
      x: 260 + Math.cos(angle) * 180,
      y: 210 + Math.sin(angle) * 140,
    });
  });
  return points;
}

function renderLive(live) {
  const list = document.getElementById("memoryGraphList");
  const svg = document.getElementById("memoryGraphSvg");
  const summary = document.getElementById("memoryGraphSummary");
  if (!list || !svg) return;

  const entries = live?.expandable?.entries || [];
  const concepts = live?.sqlite?.concepts || [];
  const graph = live?.graph || { nodes: [], edges: [] };
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];

  if (summary) {
    summary.textContent = [
      `${live?.expandable?.count ?? entries.length} note`,
      `${live?.sqlite?.conceptCount ?? concepts.length} concetti`,
      "live",
    ].join(" · ");
  }

  const noteItems = entries.length
    ? `<h3>MEMORY · expandable</h3><ul>${entries
        .map((entry) => {
          const on = entry.id === selectedId ? " is-selected" : "";
          return `<li class="memory-graph-item${on}" data-memory-id="${escapeHtml(entry.id)}">
            <strong>${escapeHtml(entry.title)}</strong>
            <div class="muted">${escapeHtml((entry.tags || []).join(" · ") || "senza tag")}${
              entry.at ? ` · ${escapeHtml(String(entry.at).replace("T", " ").slice(0, 19))}` : ""
            }</div>
            <div>${escapeHtml(String(entry.text || "").slice(0, 160))}</div>
          </li>`;
        })
        .join("")}</ul>`
    : `<h3>MEMORY · expandable</h3><p class="muted">Nessuna nota in expandable.json.</p>`;

  const conceptItems = concepts.length
    ? `<h3>MEMORY · sqlite</h3><ul>${concepts
        .map(
          (c) => `<li class="memory-graph-item">
            <strong>${escapeHtml(c.label || c.id)}</strong>
            <div class="muted">dim ${escapeHtml(c.dimension ?? "—")} · i${Number(c.importance || 0).toFixed(2)}</div>
          </li>`,
        )
        .join("")}</ul>`
    : `<h3>MEMORY · sqlite</h3><p class="muted">Nessun concetto in memory.sqlite.</p>`;

  list.innerHTML = `${noteItems}${conceptItems}`;
  list.querySelectorAll("[data-memory-id]").forEach((item) => {
    item.addEventListener("click", () => {
      const id = item.getAttribute("data-memory-id");
      selectedId = selectedId === id ? "" : id;
      renderLive(live);
    });
  });

  svg.setAttribute("viewBox", "0 0 520 420");
  svg.replaceChildren();
  if (!nodes.length) return;
  const points = layout(nodes);
  for (const edge of edges) {
    const a = points.get(edge.from);
    const b = points.get(edge.to);
    if (!a || !b) continue;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(a.x));
    line.setAttribute("y1", String(a.y));
    line.setAttribute("x2", String(b.x));
    line.setAttribute("y2", String(b.y));
    line.setAttribute(
      "class",
      edge.reason?.startsWith("recall:") ? "memory-edge memory-edge--recall" : "memory-edge",
    );
    svg.appendChild(line);
  }
  for (const node of nodes) {
    const point = points.get(node.id);
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.setAttribute("class", node.id === selectedId ? "memory-node is-selected" : "memory-node");
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("cx", String(point.x));
    circle.setAttribute("cy", String(point.y));
    circle.setAttribute("r", node.id === selectedId ? "16" : "11");
    group.appendChild(circle);
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", String(point.x + 14));
    text.setAttribute("y", String(point.y + 4));
    text.textContent = String(node.title || "").slice(0, 22);
    group.appendChild(text);
    group.addEventListener("click", () => {
      selectedId = selectedId === node.id ? "" : node.id;
      renderLive(live);
    });
    svg.appendChild(group);
  }
}

export async function refreshMemoryGraph({ force = false } = {}) {
  const live = await api("/api/ai/agentq/memory/live?limit=40");
  if (!force && live.revision && live.revision === lastRevision) return live;
  lastRevision = live.revision || "";
  renderLive(live);
  return live;
}

export function startMemoryLivePolling(intervalMs = POLL_MS) {
  stopMemoryLivePolling();
  pollTimer = setInterval(() => {
    if (!panelOpen) return;
    refreshMemoryGraph().catch((err) => {
      console.warn("[memory-live]", err?.message || err);
    });
  }, intervalMs);
}

export function stopMemoryLivePolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

export function openMemoryGraphPanel() {
  const panel = document.getElementById("memoryGraphPanel");
  if (!panel) return;
  hideOthers();
  panel.hidden = false;
  panel.setAttribute("aria-hidden", "false");
  panel.classList.add("is-open");
  document.body.dataset.atlasMemoryGraph = "1";
  panelOpen = true;
  lastRevision = "";
  refreshMemoryGraph({ force: true }).catch((err) => {
    const list = document.getElementById("memoryGraphList");
    if (list) list.innerHTML = `<p class="muted">${escapeHtml(err.message || "MEMORY non letta")}</p>`;
  });
  startMemoryLivePolling();
}

export function closeMemoryGraphPanel() {
  const panel = document.getElementById("memoryGraphPanel");
  if (!panel) return;
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  panel.classList.remove("is-open");
  document.body.dataset.atlasMemoryGraph = "0";
  panelOpen = false;
  stopMemoryLivePolling();
}

export function toggleMemoryGraphPanel() {
  const panel = document.getElementById("memoryGraphPanel");
  if (!panel || panel.hidden) openMemoryGraphPanel();
  else closeMemoryGraphPanel();
}

/** Other UI (voice memorizza, chat write) bumps the live panel immediately. */
export function notifyMemoryChanged() {
  window.dispatchEvent(new CustomEvent("atlas:memory-changed"));
  if (panelOpen) {
    lastRevision = "";
    refreshMemoryGraph({ force: true }).catch(() => {});
  }
}

export function wireMemoryGraphUi() {
  const panel = document.getElementById("memoryGraphPanel");
  if (!panel || panel.dataset.wired === "1") return;
  panel.dataset.wired = "1";
  panel.hidden = true;
  document.getElementById("memoryGraphClose")?.addEventListener("click", () => closeMemoryGraphPanel());
  document.getElementById("memoryGraphRefresh")?.addEventListener("click", () => {
    lastRevision = "";
    refreshMemoryGraph({ force: true }).catch(() => {});
  });
  panel.addEventListener("click", (event) => {
    if (event.target === panel) closeMemoryGraphPanel();
  });
  window.addEventListener("atlas:memory-changed", () => {
    if (!panelOpen) return;
    lastRevision = "";
    refreshMemoryGraph({ force: true }).catch(() => {});
  });
}
