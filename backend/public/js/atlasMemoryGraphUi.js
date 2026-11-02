/**
 * X4 memory graph viewer. List plus a simple link drawing over expandable notes.
 */
let selectedId = "";

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
    const angle = (-Math.PI / 2) + (index / count) * Math.PI * 2;
    points.set(node.id, {
      x: 260 + Math.cos(angle) * 180,
      y: 210 + Math.sin(angle) * 140,
    });
  });
  return points;
}

function renderGraph(graph) {
  const list = document.getElementById("memoryGraphList");
  const svg = document.getElementById("memoryGraphSvg");
  const summary = document.getElementById("memoryGraphSummary");
  if (!list || !svg) return;
  const nodes = graph?.nodes || [];
  const edges = graph?.edges || [];
  if (summary) summary.textContent = `${graph?.count ?? nodes.length} note · ${edges.length} legami`;
  if (!nodes.length) {
    list.innerHTML = `<p class="muted">Nessuna nota in memoria.</p>`;
    svg.replaceChildren();
    return;
  }
  const points = layout(nodes);
  const linked = new Set();
  if (selectedId) {
    for (const edge of edges) {
      if (edge.from === selectedId || edge.to === selectedId) {
        linked.add(edge.from);
        linked.add(edge.to);
      }
    }
  }
  list.innerHTML = `<ul>${nodes
    .map((node) => {
      const on = node.id === selectedId ? " is-selected" : "";
      const dim = selectedId && node.id !== selectedId && !linked.has(node.id) ? " is-dim" : "";
      return `<li class="memory-graph-item${on}${dim}" data-memory-id="${escapeHtml(node.id)}">
        <strong>${escapeHtml(node.title)}</strong>
        <div class="muted">${escapeHtml((node.tags || []).join(" · ") || "senza tag")}</div>
        <div>${escapeHtml(String(node.text || "").slice(0, 140))}</div>
      </li>`;
    })
    .join("")}</ul>`;
  list.querySelectorAll("[data-memory-id]").forEach((item) => {
    item.addEventListener("click", () => {
      const id = item.getAttribute("data-memory-id");
      selectedId = selectedId === id ? "" : id;
      renderGraph(graph);
    });
  });
  svg.setAttribute("viewBox", "0 0 520 420");
  svg.replaceChildren();
  for (const edge of edges) {
    const a = points.get(edge.from);
    const b = points.get(edge.to);
    if (!a || !b) continue;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(a.x));
    line.setAttribute("y1", String(a.y));
    line.setAttribute("x2", String(b.x));
    line.setAttribute("y2", String(b.y));
    line.setAttribute("class", edge.reason?.startsWith("recall:") ? "memory-edge memory-edge--recall" : "memory-edge");
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
      renderGraph(graph);
    });
    svg.appendChild(group);
  }
}

export async function refreshMemoryGraph() {
  const graph = await api("/api/ai/agentq/memory/graph?limit=40");
  renderGraph(graph);
  return graph;
}

export function openMemoryGraphPanel() {
  const panel = document.getElementById("memoryGraphPanel");
  if (!panel) return;
  hideOthers();
  panel.hidden = false;
  panel.setAttribute("aria-hidden", "false");
  panel.classList.add("is-open");
  document.body.dataset.atlasMemoryGraph = "1";
  refreshMemoryGraph().catch((err) => {
    const list = document.getElementById("memoryGraphList");
    if (list) list.innerHTML = `<p class="muted">${escapeHtml(err.message || "Grafo non letto")}</p>`;
  });
}

export function closeMemoryGraphPanel() {
  const panel = document.getElementById("memoryGraphPanel");
  if (!panel) return;
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  panel.classList.remove("is-open");
  document.body.dataset.atlasMemoryGraph = "0";
}

export function toggleMemoryGraphPanel() {
  const panel = document.getElementById("memoryGraphPanel");
  if (!panel || panel.hidden) openMemoryGraphPanel();
  else closeMemoryGraphPanel();
}

export function wireMemoryGraphUi() {
  const panel = document.getElementById("memoryGraphPanel");
  if (!panel || panel.dataset.wired === "1") return;
  panel.dataset.wired = "1";
  panel.hidden = true;
  document.getElementById("memoryGraphClose")?.addEventListener("click", () => closeMemoryGraphPanel());
  document.getElementById("memoryGraphRefresh")?.addEventListener("click", () => {
    refreshMemoryGraph().catch(() => {});
  });
  panel.addEventListener("click", (event) => {
    if (event.target === panel) closeMemoryGraphPanel();
  });
}
