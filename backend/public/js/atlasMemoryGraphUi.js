/**
 * Holographic neural CERVELLO — unica sezione MEMORY in basso sulla plancia.
 * Full-bleed SVG: neuroni collegati da archi, pacchetti dati live sulle sinapsi.
 * Hop falliti → arco spento / nodo rosso. Niente lista, niente colori per tipo, niente filtri.
 */
const POLL_MS = 1800;
const NS = "http://www.w3.org/2000/svg";
const VIEW_W = 960;
const VIEW_H = 560;

let selectedId = "";
let pollTimer = null;
let rafId = 0;
let lastRevision = "";
let panelOpen = false;
let lastFetchOk = true;
let lastFetchAt = 0;

/** @type {{ nodes: object[], edges: object[], points: Map<string,{x:number,y:number}>, at: number }} */
let scene = { nodes: [], edges: [], points: new Map(), at: 0 };

/** @type {Map<string, { lastPulse: number, fails: number, alive: boolean }>} */
const edgeHealth = new Map();
/** @type {Map<string, { lastSeen: number, errorUntil: number }>} */
const nodeHealth = new Map();
/** @type {Array<{ id: string, from: string, to: string, t: number, speed: number, failed: boolean, reason: string }>} */
let packets = [];

function api(path) {
  return fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json" },
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  });
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

function hash01(str) {
  let h = 2166136261;
  const s = String(str || "");
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function edgeKey(from, to, reason = "") {
  const a = String(from);
  const b = String(to);
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  return `${lo}|${hi}|${reason || ""}`;
}

/** Organic two-lobe brain layout (stable per node id). */
function layoutBrain(nodes) {
  const points = new Map();
  const n = Math.max(nodes.length, 1);
  nodes.forEach((node, index) => {
    const id = String(node.id);
    const h = hash01(id);
    const lobe = h < 0.5 ? -1 : 1;
    const ring = 0.32 + hash01(`${id}:r`) * 0.58;
    const a0 = lobe < 0 ? Math.PI * 0.55 : -Math.PI * 0.55;
    const sweep = Math.PI * 0.95;
    const t = (index / n + h * 0.17) % 1;
    const angle = a0 + t * sweep * lobe;
    const cx = VIEW_W * 0.5 + lobe * 78;
    const cy = VIEW_H * 0.5 + 6;
    const rx = 200 * ring;
    const ry = 155 * ring;
    const jitterX = (hash01(`${id}:x`) - 0.5) * 26;
    const jitterY = (hash01(`${id}:y`) - 0.5) * 22;
    points.set(id, {
      x: cx + Math.cos(angle) * rx + jitterX,
      y: cy + Math.sin(angle) * ry + jitterY,
    });
  });
  const ids = [...points.keys()];
  for (let pass = 0; pass < 3; pass += 1) {
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = points.get(ids[i]);
        const b = points.get(ids[j]);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.01;
        const min = 26;
        if (d < min) {
          const push = ((min - d) / 2) * 0.65;
          const ux = dx / d;
          const uy = dy / d;
          a.x -= ux * push;
          a.y -= uy * push;
          b.x += ux * push;
          b.y += uy * push;
        }
      }
    }
  }
  return points;
}

function curvePath(a, b, bend = 0.22) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const cx = mx - dy * bend;
  const cy = my + dx * bend;
  return { d: `M ${a.x} ${a.y} Q ${cx} ${cy} ${b.x} ${b.y}`, cx, cy };
}

function ensureDefs(svg) {
  let defs = svg.querySelector("defs");
  if (defs) return defs;
  defs = document.createElementNS(NS, "defs");
  defs.innerHTML = `
    <radialGradient id="holoCore" cx="50%" cy="45%" r="55%">
      <stop offset="0%" stop-color="rgba(140,230,255,0.45)"/>
      <stop offset="55%" stop-color="rgba(20,70,95,0.22)"/>
      <stop offset="100%" stop-color="rgba(0,10,18,0)"/>
    </radialGradient>
    <filter id="holoGlow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="2.2" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <filter id="errGlow" x="-60%" y="-60%" width="220%" height="220%">
      <feGaussianBlur stdDeviation="2.8" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  `;
  svg.appendChild(defs);
  return defs;
}

function markFlowPulse(edges, now = Date.now()) {
  for (const edge of edges) {
    const key = edgeKey(edge.from, edge.to, edge.reason);
    edgeHealth.set(key, { lastPulse: now, fails: 0, alive: true });
  }
}

function spawnPackets(edges, points, burst = 6) {
  if (!edges.length) return;
  const now = Date.now();
  const pick = [...edges].sort(() => hash01(String(now + Math.random())) - 0.5).slice(0, burst);
  for (const edge of pick) {
    if (!points.has(String(edge.from)) || !points.has(String(edge.to))) continue;
    const key = edgeKey(edge.from, edge.to, edge.reason);
    const health = edgeHealth.get(key);
    const failed = health ? !health.alive : false;
    packets.push({
      id: `pkt-${now}-${Math.random().toString(36).slice(2, 8)}`,
      from: String(edge.from),
      to: String(edge.to),
      t: 0,
      speed: 0.35 + hash01(key) * 0.55,
      failed,
      reason: edge.reason || "",
    });
  }
  if (packets.length > 48) packets = packets.slice(-48);
}

function evaluateHealth(nodes, edges, now = Date.now()) {
  const liveIds = new Set(nodes.map((n) => String(n.id)));
  for (const id of liveIds) {
    const prev = nodeHealth.get(id) || { lastSeen: 0, errorUntil: 0 };
    nodeHealth.set(id, { lastSeen: now, errorUntil: prev.errorUntil });
  }
  for (const [id, state] of [...nodeHealth.entries()]) {
    if (!liveIds.has(id) && now - state.lastSeen > 4000) nodeHealth.delete(id);
  }
  for (const edge of edges) {
    const key = edgeKey(edge.from, edge.to, edge.reason);
    const h = edgeHealth.get(key) || { lastPulse: now, fails: 0, alive: true };
    if (now - h.lastPulse > 9000) {
      h.fails += 1;
      h.alive = false;
      for (const nid of [String(edge.from), String(edge.to)]) {
        const st = nodeHealth.get(nid) || { lastSeen: now, errorUntil: 0 };
        st.errorUntil = Math.max(st.errorUntil, now + 5000);
        nodeHealth.set(nid, st);
      }
    }
    edgeHealth.set(key, h);
  }
  if (!lastFetchOk) {
    for (const id of liveIds) {
      const st = nodeHealth.get(id) || { lastSeen: now, errorUntil: 0 };
      st.errorUntil = Math.max(st.errorUntil, now + 4000);
      nodeHealth.set(id, st);
    }
  }
}

function pointAlongQuad(a, b, cx, cy, t) {
  const u = 1 - t;
  return {
    x: u * u * a.x + 2 * u * t * cx + t * t * b.x,
    y: u * u * a.y + 2 * u * t * cy + t * t * b.y,
  };
}

function paintFrame(ts) {
  const svg = document.getElementById("memoryGraphSvg");
  if (!svg || !panelOpen) {
    rafId = 0;
    return;
  }
  const layer = svg.querySelector("#holoPackets");
  const now = Date.now();
  const dt = Math.min(0.05, paintFrame._last ? (ts - paintFrame._last) / 1000 : 0.016);
  paintFrame._last = ts;

  const next = [];
  for (const pkt of packets) {
    pkt.t += pkt.speed * dt * (pkt.failed ? 0.55 : 1);
    if (pkt.t >= 1) {
      const key = edgeKey(pkt.from, pkt.to, pkt.reason);
      if (pkt.failed) {
        const h = edgeHealth.get(key) || { lastPulse: 0, fails: 0, alive: false };
        h.fails += 1;
        h.alive = false;
        edgeHealth.set(key, h);
        const st = nodeHealth.get(pkt.to) || { lastSeen: now, errorUntil: 0 };
        st.errorUntil = Math.max(st.errorUntil, now + 3500);
        nodeHealth.set(pkt.to, st);
      } else {
        const h = edgeHealth.get(key) || { lastPulse: now, fails: 0, alive: true };
        h.lastPulse = now;
        h.fails = 0;
        h.alive = true;
        edgeHealth.set(key, h);
      }
      continue;
    }
    next.push(pkt);
  }
  packets = next;

  if (layer) {
    layer.replaceChildren();
    for (const pkt of packets) {
      const a = scene.points.get(pkt.from);
      const b = scene.points.get(pkt.to);
      if (!a || !b) continue;
      const bend = 0.18 + hash01(edgeKey(pkt.from, pkt.to)) * 0.12;
      const { cx, cy } = curvePath(a, b, bend);
      const p = pointAlongQuad(a, b, cx, cy, pkt.t);
      const dot = document.createElementNS(NS, "circle");
      dot.setAttribute("cx", String(p.x));
      dot.setAttribute("cy", String(p.y));
      dot.setAttribute("r", pkt.failed ? "3.2" : "3.8");
      dot.setAttribute("class", pkt.failed ? "holo-packet holo-packet--fail" : "holo-packet");
      layer.appendChild(dot);
      if (!pkt.failed && pkt.t > 0.15 && pkt.t < 0.85) {
        const trail = document.createElementNS(NS, "circle");
        const tp = pointAlongQuad(a, b, cx, cy, Math.max(0, pkt.t - 0.08));
        trail.setAttribute("cx", String(tp.x));
        trail.setAttribute("cy", String(tp.y));
        trail.setAttribute("r", "2");
        trail.setAttribute("class", "holo-packet holo-packet--trail");
        layer.appendChild(trail);
      }
    }
  }

  svg.querySelectorAll(".memory-node").forEach((g) => {
    const id = g.getAttribute("data-id");
    const st = nodeHealth.get(id);
    const err = !lastFetchOk || (st && st.errorUntil > now);
    g.classList.toggle("is-error", Boolean(err));
    const core = g.querySelector(".neuron-core");
    if (core) {
      const pulse = 1 + Math.sin(now / 320 + hash01(id) * 6) * 0.06;
      core.setAttribute("r", String((err ? 9 : 8) * pulse));
    }
  });

  svg.querySelectorAll(".memory-edge").forEach((path) => {
    const key = path.getAttribute("data-key");
    const h = edgeHealth.get(key);
    const dead = !lastFetchOk || (h && !h.alive);
    path.classList.toggle("memory-edge--dead", Boolean(dead));
    path.classList.toggle("is-flowing", Boolean(h && h.alive && now - h.lastPulse < 4000));
  });

  rafId = requestAnimationFrame(paintFrame);
}
paintFrame._last = 0;

function startRaf() {
  if (rafId) return;
  paintFrame._last = 0;
  rafId = requestAnimationFrame(paintFrame);
}

function stopRaf() {
  if (rafId) cancelAnimationFrame(rafId);
  rafId = 0;
}

function setBottomToolsHidden(hidden) {
  const tools = document.getElementById("bottomTools");
  if (tools) tools.hidden = Boolean(hidden);
}

function renderHolo(live) {
  const svg = document.getElementById("memoryGraphSvg");
  const summary = document.getElementById("memoryGraphSummary");
  if (!svg) return;

  const graph = live?.graph || { nodes: [], edges: [] };
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const now = Date.now();
  const points = layoutBrain(nodes);
  scene = { nodes, edges, points, at: now };

  evaluateHealth(nodes, edges, now);

  if (summary) {
    const dead = [...edgeHealth.values()].filter((h) => !h.alive).length;
    const errs = [...nodeHealth.values()].filter((s) => s.errorUntil > now).length;
    const parts = [
      `${live?.count ?? nodes.length} neuroni`,
      `${edges.length} sinapsi`,
      lastFetchOk ? "flusso live" : "segnale assente",
    ];
    if (dead) parts.push(`${dead} archi spenti`);
    if (errs) parts.push(`${errs} nodi in errore`);
    summary.textContent = parts.join(" · ");
  }

  svg.setAttribute("viewBox", `0 0 ${VIEW_W} ${VIEW_H}`);
  svg.setAttribute("aria-label", "Cervello olografico — flusso neurale live");
  svg.replaceChildren();
  ensureDefs(svg);

  const bg = document.createElementNS(NS, "g");
  bg.setAttribute("class", "holo-bg");
  const veil = document.createElementNS(NS, "ellipse");
  veil.setAttribute("cx", String(VIEW_W / 2));
  veil.setAttribute("cy", String(VIEW_H / 2));
  veil.setAttribute("rx", "320");
  veil.setAttribute("ry", "230");
  veil.setAttribute("fill", "url(#holoCore)");
  bg.appendChild(veil);
  for (const side of [-1, 1]) {
    const lobe = document.createElementNS(NS, "ellipse");
    lobe.setAttribute("cx", String(VIEW_W / 2 + side * 110));
    lobe.setAttribute("cy", String(VIEW_H / 2));
    lobe.setAttribute("rx", "190");
    lobe.setAttribute("ry", "185");
    lobe.setAttribute("class", "holo-lobe");
    bg.appendChild(lobe);
  }
  svg.appendChild(bg);

  const edgeLayer = document.createElementNS(NS, "g");
  edgeLayer.setAttribute("class", "holo-edges");
  for (const edge of edges) {
    const a = points.get(String(edge.from));
    const b = points.get(String(edge.to));
    if (!a || !b) continue;
    const key = edgeKey(edge.from, edge.to, edge.reason);
    const health = edgeHealth.get(key);
    const bend = 0.18 + hash01(key) * 0.12;
    const { d } = curvePath(a, b, bend);
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", d);
    path.setAttribute("data-key", key);
    const classes = ["memory-edge"];
    if (String(edge.reason || "").startsWith("recall:")) classes.push("memory-edge--recall");
    if ((health && !health.alive) || !lastFetchOk) classes.push("memory-edge--dead");
    path.setAttribute("class", classes.join(" "));
    edgeLayer.appendChild(path);
  }
  svg.appendChild(edgeLayer);

  const packetLayer = document.createElementNS(NS, "g");
  packetLayer.setAttribute("id", "holoPackets");
  packetLayer.setAttribute("class", "holo-packets");
  svg.appendChild(packetLayer);

  const nodeLayer = document.createElementNS(NS, "g");
  nodeLayer.setAttribute("class", "holo-nodes");
  for (const node of nodes) {
    const id = String(node.id);
    const point = points.get(id);
    if (!point) continue;
    const st = nodeHealth.get(id);
    const err = !lastFetchOk || (st && st.errorUntil > now);
    const group = document.createElementNS(NS, "g");
    group.setAttribute(
      "class",
      ["memory-node", selectedId === id ? "is-selected" : "", err ? "is-error" : ""]
        .filter(Boolean)
        .join(" "),
    );
    group.setAttribute("data-id", id);
    group.setAttribute("filter", err ? "url(#errGlow)" : "url(#holoGlow)");

    const halo = document.createElementNS(NS, "circle");
    halo.setAttribute("cx", String(point.x));
    halo.setAttribute("cy", String(point.y));
    halo.setAttribute("r", "15");
    halo.setAttribute("class", "neuron-halo");
    group.appendChild(halo);

    const core = document.createElementNS(NS, "circle");
    core.setAttribute("cx", String(point.x));
    core.setAttribute("cy", String(point.y));
    core.setAttribute("r", selectedId === id ? "10" : "8");
    core.setAttribute("class", "neuron-core");
    group.appendChild(core);

    group.addEventListener("click", () => {
      selectedId = selectedId === id ? "" : id;
      const out = edges.filter((e) => String(e.from) === id || String(e.to) === id);
      spawnPackets(out.length ? out : edges, points, 8);
      renderHolo(live);
    });
    nodeLayer.appendChild(group);
  }
  svg.appendChild(nodeLayer);

  if (!lastFetchOk) {
    const banner = document.createElementNS(NS, "text");
    banner.setAttribute("x", String(VIEW_W / 2));
    banner.setAttribute("y", "28");
    banner.setAttribute("text-anchor", "middle");
    banner.setAttribute("class", "holo-signal-lost");
    banner.textContent = "SEGNALE ASSENTE — hop falliti";
    svg.appendChild(banner);
  }

  startRaf();
}

export async function refreshMemoryGraph({ force = false } = {}) {
  try {
    const live = await api("/api/ai/agentq/memory/live?limit=48");
    lastFetchOk = true;
    lastFetchAt = Date.now();
    const changed = force || !live.revision || live.revision !== lastRevision;
    if (!changed) {
      spawnPackets(scene.edges, scene.points, 3);
      markFlowPulse(scene.edges, lastFetchAt);
      return live;
    }
    lastRevision = live.revision || "";
    renderHolo(live);
    markFlowPulse(live?.graph?.edges || [], lastFetchAt);
    spawnPackets(live?.graph?.edges || [], scene.points, 10);
    for (const edge of (live?.graph?.edges || []).slice(0, 2)) {
      const key = edgeKey(edge.from, edge.to, edge.reason);
      const h = edgeHealth.get(key);
      if (h && !h.alive) {
        packets.push({
          id: `miss-${Date.now()}`,
          from: String(edge.from),
          to: String(edge.to),
          t: 0,
          speed: 0.4,
          failed: true,
          reason: edge.reason || "",
        });
      }
    }
    return live;
  } catch (err) {
    lastFetchOk = false;
    lastFetchAt = Date.now();
    for (const [key, h] of edgeHealth) {
      h.alive = false;
      h.fails += 1;
      edgeHealth.set(key, h);
    }
    for (const [id, st] of nodeHealth) {
      st.errorUntil = Date.now() + 8000;
      nodeHealth.set(id, st);
    }
    packets = packets.map((p) => ({ ...p, failed: true }));
    const summary = document.getElementById("memoryGraphSummary");
    if (summary) summary.textContent = `segnale assente · ${escapeHtml(err.message || "errore")}`;
    if (scene.nodes.length) {
      renderHolo({
        count: scene.nodes.length,
        graph: { nodes: scene.nodes, edges: scene.edges },
      });
    }
    throw err;
  }
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
  const panel = document.getElementById("memoryBottom");
  if (!panel) return;
  hideOthers();
  panel.hidden = false;
  panel.setAttribute("aria-hidden", "false");
  panel.classList.add("is-open");
  document.body.dataset.atlasMemoryGraph = "1";
  document.body.classList.add("memory-holo-open");
  setBottomToolsHidden(true);
  panelOpen = true;
  lastRevision = "";
  packets = [];
  refreshMemoryGraph({ force: true }).catch(() => {});
  startMemoryLivePolling();
  startRaf();
}

export function closeMemoryGraphPanel() {
  const panel = document.getElementById("memoryBottom");
  if (!panel) return;
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  panel.classList.remove("is-open");
  document.body.dataset.atlasMemoryGraph = "0";
  document.body.classList.remove("memory-holo-open");
  setBottomToolsHidden(false);
  panelOpen = false;
  stopMemoryLivePolling();
  stopRaf();
}

export function toggleMemoryGraphPanel() {
  const panel = document.getElementById("memoryBottom");
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
  const panel = document.getElementById("memoryBottom");
  if (!panel || panel.dataset.wired === "1") return;
  panel.dataset.wired = "1";
  panel.hidden = true;
  document.getElementById("memoryGraphClose")?.addEventListener("click", () => closeMemoryGraphPanel());
  document.getElementById("memoryGraphRefresh")?.addEventListener("click", () => {
    lastRevision = "";
    refreshMemoryGraph({ force: true }).catch(() => {});
  });
  window.addEventListener("atlas:memory-changed", () => {
    if (!panelOpen) return;
    lastRevision = "";
    refreshMemoryGraph({ force: true }).catch(() => {});
  });
}
