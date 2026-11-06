/**
 * cervello neurale — permanent full-viewport 3D neural brain (not a popup).
 * Neurons sit on a folded two-hemisphere cortical shell; all synapses kept.
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const POLL_MS = 2000;
const FETCH_LIMIT = 500;
/** Minimum center-to-center gap so N neurons stay countable and non-overlapping. */
const MIN_SEP = 0.72;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

const KIND_COLOR = {
  heritage: 0xd4a84b,
  skill: 0x3dff9a,
  prompt: 0x3dd6ff,
  function: 0xb794f6,
  concept: 0x9aa3ad,
  fact: 0x7eb6ff,
  tool: 0xff9f43,
  session: 0xff7ab8,
  note: 0xaeb4bf,
};

let selectedId = "";
let pollTimer = null;
let animId = 0;
let lastRevision = "";
let pageOpen = false;
let lastFetchOk = true;

/** @type {null | {
 *  scene: THREE.Scene,
 *  camera: THREE.PerspectiveCamera,
 *  renderer: THREE.WebGLRenderer,
 *  controls: OrbitControls,
 *  root: THREE.Group,
 *  packetGroup: THREE.Group,
 *  nodeById: Map<string, THREE.Object3D>,
 *  labelById: Map<string, THREE.Sprite>,
 *  edgeCurves: Array<{curve: THREE.QuadraticBezierCurve3, key: string, line: THREE.Line}>,
 *  nodes: object[],
 *  edges: object[],
 *  container: HTMLElement,
 *  onResize: () => void,
 *  onPointer: (ev: PointerEvent) => void,
 * }} */
let runtime = null;

/** @type {Array<{ mesh: THREE.Mesh, curve: THREE.QuadraticBezierCurve3, t: number, speed: number, failed: boolean, key: string }>} */
let packets = [];

/** @type {Map<string, { lastPulse: number, alive: boolean }>} */
const edgeHealth = new Map();

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

function kindOf(node) {
  const k = String(node?.kind || "concept").toLowerCase();
  return KIND_COLOR[k] != null ? k : "concept";
}

function colorForKind(kind) {
  return new THREE.Color(KIND_COLOR[kind] ?? KIND_COLOR.concept);
}

function neuronTitle(node, maxLen = 28) {
  const raw = String(node?.title || node?.label || node?.id || "neurone").trim();
  return raw.length > maxLen ? `${raw.slice(0, maxLen - 1)}…` : raw;
}

/**
 * Humanoid brain silhouette: two hemispheres + folded cortical surface.
 * Every neuron is kept — only positions change. Mild 3D separation avoids stacks.
 */
function layoutBrainShape(nodes, _edges = []) {
  const n = Math.max(nodes.length, 1);
  const points = new Map();
  const scale = Math.max(3.6, Math.sqrt(n) * 0.4);
  // Brain ellipsoid radii (X lateral, Y superior, Z anterior–posterior)
  const rx = 1.55;
  const ry = 1.05;
  const rz = 1.9;

  nodes.forEach((node, index) => {
    const id = String(node.id);
    const h = hash01(id);
    const h2 = hash01(`${id}:b`);
    const h3 = hash01(`${id}:c`);
    const hemi = h < 0.5 ? -1 : 1;

    // Fibonacci sphere seed, then warp into cortical shell
    const fib = index + 0.5;
    const y0 = 1 - (2 * fib) / n;
    const rxy = Math.sqrt(Math.max(0, 1 - y0 * y0));
    const theta = index * GOLDEN_ANGLE + h * 0.12;
    let x = Math.cos(theta) * rxy;
    let z = Math.sin(theta) * rxy;
    let y = y0;

    // Force left/right hemisphere with longitudinal fissure gap
    const fissure = 0.14;
    x = hemi * (Math.abs(x) * 0.92 + fissure + h2 * 0.04);

    // Gyri / sulci folds along the surface
    const folds =
      0.1 * Math.sin(x * 9.5 + h * 6) * Math.cos(z * 7.2) +
      0.07 * Math.sin(z * 11 + y * 5.5) +
      0.05 * Math.sin((x + z) * 13 + h2 * 4);

    // Temporal lobe drop (lower lateral anterior)
    const temporal =
      Math.abs(x) > 0.65 && z > -0.15 && z < 0.9 ? -0.28 * (Math.abs(x) - 0.65) : 0;
    // Occipital / cerebellar posterior bulge
    const posterior = z < -0.45 ? -0.12 * (-0.45 - z) + 0.06 * Math.sin(x * 8) : 0;

    const nx = x * (1 + folds * 0.35);
    const ny = y * (1 + folds * 0.55) + temporal + posterior + folds * 0.45;
    const nz = z * (1 + folds * 0.28);

    const len = Math.hypot(nx / rx, ny / ry, nz / rz) || 1;
    points.set(
      id,
      new THREE.Vector3(
        (nx / len) * rx * scale + (h2 - 0.5) * 0.07,
        (ny / len) * ry * scale * 0.95 + (h3 - 0.5) * 0.05,
        (nz / len) * rz * scale + (h - 0.5) * 0.07,
      ),
    );
  });

  // Soft 3D separation — preserve silhouette, prevent exact overlaps
  const ids = [...points.keys()];
  const minSep = MIN_SEP * 0.82;
  for (let pass = 0; pass < 20; pass += 1) {
    const alpha = 1 - pass / 20;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = points.get(ids[i]);
        const b = points.get(ids[j]);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dy, dz) || 0.0001;
        if (d < minSep) {
          const push = ((minSep - d) / 2) * (0.35 + 0.65 * alpha);
          const ux = dx / d;
          const uy = dy / d;
          const uz = dz / d;
          a.x -= ux * push;
          a.y -= uy * push;
          a.z -= uz * push;
          b.x += ux * push;
          b.y += uy * push;
          b.z += uz * push;
        }
      }
    }
  }
  return points;
}

function fitCameraToPoints(camera, controls, points) {
  if (!points.size) return;
  const box = new THREE.Box3();
  for (const p of points.values()) box.expandByPoint(p);
  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  box.getSize(size);
  box.getCenter(center);
  const span = Math.max(size.x, size.y, size.z, 4);
  // 3/4 view of the brain (not flat top-down)
  camera.fov = 52;
  camera.near = 0.1;
  camera.far = 400;
  camera.position.set(center.x + span * 0.85, center.y + span * 0.7, center.z + span * 1.05);
  camera.lookAt(center.x, center.y, center.z);
  camera.updateProjectionMatrix();
  controls.target.copy(center);
  controls.minDistance = 1.2;
  controls.maxDistance = Math.max(80, span * 4);
  controls.update();
}


function makeLabelSprite(text, kindColor) {
  const canvas = document.createElement("canvas");
  canvas.width = 384;
  canvas.height = 72;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const grad = ctx.createLinearGradient(0, 0, 0, 72);
  grad.addColorStop(0, "rgba(4,14,22,0.88)");
  grad.addColorStop(1, "rgba(2,8,14,0.4)");
  ctx.fillStyle = grad;
  roundRect(ctx, 6, 14, 372, 44, 10);
  ctx.fill();
  ctx.strokeStyle = `rgba(${Math.round(kindColor.r * 255)},${Math.round(kindColor.g * 255)},${Math.round(kindColor.b * 255)},0.7)`;
  ctx.lineWidth = 1.5;
  roundRect(ctx, 6, 14, 372, 44, 10);
  ctx.stroke();
  ctx.fillStyle = "#eaf6ff";
  ctx.font = "600 22px Sora, IBM Plex Sans, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 192, 38);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    opacity: 0.92,
  });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(1.05, 0.2, 1);
  spr.center.set(0.5, 0);
  return spr;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function addStarfield(scene) {
  const count = 2200;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const r = 28 + Math.random() * 70;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  scene.add(
    new THREE.Points(
      geo,
      new THREE.PointsMaterial({
        color: 0xb8d4e8,
        size: 0.045,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.85,
      }),
    ),
  );
}

function setHud(summaryText) {
  const summary = document.getElementById("memoryGraphSummary");
  if (summary) summary.textContent = summaryText;
  const legend = document.getElementById("moduleLegend");
  if (legend && pageOpen) legend.textContent = "cervello neurale · drag orbita · scroll zoom";
}

function disposeRuntime() {
  stopAnim();
  if (!runtime) return;
  const { renderer, container, onResize, onPointer, scene } = runtime;
  window.removeEventListener("resize", onResize);
  renderer.domElement.removeEventListener("pointerdown", onPointer);
  scene.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose?.();
    if (obj.material) {
      if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
      else {
        obj.material.map?.dispose?.();
        obj.material.dispose?.();
      }
    }
  });
  renderer.dispose();
  if (renderer.domElement.parentNode === container) container.removeChild(renderer.domElement);
  runtime = null;
  packets = [];
}

function buildSceneGraph(live) {
  if (!runtime) return;
  const { root, packetGroup, nodeById, labelById, camera, controls } = runtime;
  while (root.children.length) root.remove(root.children[0]);
  packetGroup.clear();
  root.add(packetGroup);
  nodeById.clear();
  labelById.clear();
  runtime.edgeCurves = [];

  const graph = live?.graph || { nodes: [], edges: [] };
  // Prefer full neuron list when graph.nodes is truncated / missing titles.
  const byId = new Map();
  for (const n of graph.nodes || []) byId.set(String(n.id), n);
  for (const n of live?.neurons || []) {
    const id = String(n.id);
    if (!byId.has(id)) byId.set(id, n);
    else byId.set(id, { ...byId.get(id), ...n });
  }
  const nodes = [...byId.values()];
  const edges = graph.edges || [];
  runtime.nodes = nodes;
  runtime.edges = edges;
  const points = layoutBrainShape(nodes, edges);

  for (const edge of edges) {
    const a = points.get(String(edge.from));
    const b = points.get(String(edge.to));
    if (!a || !b) continue;
    const key = edgeKey(edge.from, edge.to, edge.reason);
    const mid = a.clone().lerp(b, 0.5);
    mid.y += 0.12 + hash01(key) * 0.22;
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const pts = curve.getPoints(20);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const recall = String(edge.reason || "").startsWith("recall:");
    const line = new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({
        color: recall ? 0x9ad8ff : 0x3a7088,
        transparent: true,
        opacity: recall ? 0.38 : 0.2,
      }),
    );
    line.userData = { key, kind: "edge" };
    root.add(line);
    runtime.edgeCurves.push({ curve, key, line });
    if (!edgeHealth.has(key)) edgeHealth.set(key, { lastPulse: Date.now(), alive: true });
  }

  for (const node of nodes) {
    const id = String(node.id);
    const pos = points.get(id);
    if (!pos) continue;
    const kind = kindOf(node);
    const color = colorForKind(kind);
    const group = new THREE.Group();
    group.position.copy(pos);

    const halo = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 16, 16),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.16,
        depthWrite: false,
      }),
    );
    group.add(halo);

    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.07, 1),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.6,
        metalness: 0.35,
        roughness: 0.28,
      }),
    );
    mesh.userData = { pickable: true, neuronId: id, node, kind };
    group.add(mesh);

    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.105, 0.006, 6, 28),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5 }),
    );
    ring.rotation.x = Math.PI / 2;
    group.add(ring);

    const label = makeLabelSprite(neuronTitle(node, 22), color);
    label.position.set(0, 0.16, 0);
    group.add(label);

    root.add(group);
    nodeById.set(id, group);
    labelById.set(id, label);
  }

  // Fit camera once per Memory page visit (mount). Live refreshes keep the user's view.
  // Leaving Memory (unmount) clears runtime, so the next visit reframes from scratch.
  if (!runtime.cameraFitted) {
    fitCameraToPoints(camera, controls, points);
    runtime.cameraFitted = true;
  }

  const dead = [...edgeHealth.values()].filter((h) => !h.alive).length;
  setHud(
    [
      `${nodes.length} neuroni`,
      `${edges.length} sinapsi`,
      lastFetchOk ? "flusso live" : "segnale assente",
      dead ? `${dead} archi spenti` : null,
    ]
      .filter(Boolean)
      .join(" · "),
  );

  spawnPackets(10);
  if (selectedId && nodeById.has(selectedId)) focusNeuron(selectedId, { toast: false });
}

function spawnPackets(burst = 6) {
  if (!runtime?.edgeCurves?.length) return;
  const pick = [...runtime.edgeCurves]
    .sort(() => hash01(String(Date.now() + Math.random())) - 0.5)
    .slice(0, burst);
  for (const edge of pick) {
    const health = edgeHealth.get(edge.key);
    const failed = health ? !health.alive : false;
    const color = failed ? 0xff5555 : 0xd8f7ff;
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.035, 10, 10),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 }),
    );
    runtime.packetGroup.add(mesh);
    packets.push({
      mesh,
      curve: edge.curve,
      t: 0,
      speed: 0.28 + hash01(edge.key) * 0.45,
      failed,
      key: edge.key,
    });
  }
  if (packets.length > 56) {
    const drop = packets.splice(0, packets.length - 56);
    for (const p of drop) {
      runtime.packetGroup.remove(p.mesh);
      p.mesh.geometry.dispose();
      p.mesh.material.dispose();
    }
  }
}

function tick(ts) {
  if (!runtime || !pageOpen) {
    animId = 0;
    return;
  }
  const dt = Math.min(0.05, tick._last ? (ts - tick._last) / 1000 : 0.016);
  tick._last = ts;
  const { controls, renderer, scene, camera, root, nodeById } = runtime;
  controls.update();

  const next = [];
  for (const pkt of packets) {
    pkt.t += pkt.speed * dt * (pkt.failed ? 0.55 : 1);
    if (pkt.t >= 1) {
      const h = edgeHealth.get(pkt.key) || { lastPulse: 0, alive: true };
      if (pkt.failed) h.alive = false;
      else {
        h.alive = true;
        h.lastPulse = Date.now();
      }
      edgeHealth.set(pkt.key, h);
      runtime.packetGroup.remove(pkt.mesh);
      pkt.mesh.geometry.dispose();
      pkt.mesh.material.dispose();
      continue;
    }
    pkt.mesh.position.copy(pkt.curve.getPoint(pkt.t));
    next.push(pkt);
  }
  packets = next;

  const now = Date.now();
  for (const [id, group] of nodeById) {
    const mesh = group.children.find((c) => c.userData?.pickable);
    if (!mesh) continue;
    const pulse = 1 + Math.sin(now / 380 + hash01(id) * 6) * 0.07;
    mesh.scale.setScalar((selectedId === id ? 1.35 : 1) * pulse);
  }
  for (const { key, line } of runtime.edgeCurves) {
    const h = edgeHealth.get(key);
    const dead = !lastFetchOk || (h && !h.alive);
    line.material.opacity = dead ? 0.12 : 0.32;
    line.material.color.set(dead ? 0x556066 : 0x5eb0c8);
  }

  renderer.render(scene, camera);
  animId = requestAnimationFrame(tick);
}
tick._last = 0;

function startAnim() {
  if (animId) return;
  tick._last = 0;
  animId = requestAnimationFrame(tick);
}

function stopAnim() {
  if (animId) cancelAnimationFrame(animId);
  animId = 0;
}

export function focusNeuron(id, { toast = true } = {}) {
  if (!runtime) return;
  const group = runtime.nodeById.get(String(id));
  if (!group) return;
  selectedId = String(id);
  const { camera, controls } = runtime;
  // Keep the user's zoom distance and viewing angle — only retarget the orbit pivot.
  const offset = camera.position.clone().sub(controls.target);
  controls.target.copy(group.position);
  camera.position.copy(group.position.clone().add(offset));
  const node = runtime.nodes.find((n) => String(n.id) === selectedId);
  if (toast && node) {
    window.dispatchEvent(
      new CustomEvent("atlas:memory-focus", { detail: { id: selectedId, title: neuronTitle(node), kind: kindOf(node) } }),
    );
  }
}

export async function refreshMemoryGraph({ force = false } = {}) {
  try {
    const live = await api(`/api/ai/agentq/memory/live?limit=${FETCH_LIMIT}`);
    lastFetchOk = true;
    const changed = force || !live.revision || live.revision !== lastRevision;
    if (!changed) {
      spawnPackets(4);
      return live;
    }
    lastRevision = live.revision || "";
    buildSceneGraph(live);
    return live;
  } catch (err) {
    lastFetchOk = false;
    for (const [key, h] of edgeHealth) {
      h.alive = false;
      edgeHealth.set(key, h);
    }
    setHud(`segnale assente · ${escapeHtml(err.message || "errore")}`);
    throw err;
  }
}

export function startMemoryLivePolling(intervalMs = POLL_MS) {
  stopMemoryLivePolling();
  pollTimer = setInterval(() => {
    if (!pageOpen) return;
    refreshMemoryGraph().catch((err) => console.warn("[memory-live]", err?.message || err));
  }, intervalMs);
}

export function stopMemoryLivePolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

/**
 * Mount the permanent cervello neurale page into the main viewport host (glCanvas).
 * Caller must clear other engines (Cesium/Three) first.
 */
export async function mountMemoryBrainPage(container) {
  if (!container) return;
  pageOpen = true;
  document.body.dataset.atlasMemoryGraph = "1";
  document.body.classList.add("memory-page-active");
  document.body.classList.remove("memory-holo-open");

  const hud = document.getElementById("memoryPage");
  if (hud) {
    hud.hidden = false;
    hud.setAttribute("aria-hidden", "false");
    hud.classList.add("is-open");
  }
  // Legacy bottom dock panel — keep hidden forever (no popup).
  const bottom = document.getElementById("memoryBottom");
  if (bottom) {
    bottom.hidden = true;
    bottom.setAttribute("aria-hidden", "true");
    bottom.classList.remove("is-open");
  }

  disposeRuntime();
  container.innerHTML = "";
  container.style.pointerEvents = "auto";

  let w = container.clientWidth || 960;
  let h = container.clientHeight || 640;
  const scene = new THREE.Scene();
  // Solid black backdrop — no fog / starfield atmosphere.
  scene.fog = null;
  scene.background = new THREE.Color(0x000000);
  const camera = new THREE.PerspectiveCamera(52, w / Math.max(h, 1), 0.1, 400);
  // Start 3/4 view — fitCameraToPoints refines after brain layout.
  camera.position.set(8, 7, 10);
  camera.lookAt(0, 0, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5));
  renderer.setSize(w, h, false);
  renderer.setClearColor(0x000000, 1);
  container.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { width: "100%", height: "100%", display: "block" });

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enableZoom = true;
  controls.enableRotate = true;
  controls.enablePan = true;
  controls.minDistance = 1.2;
  controls.maxDistance = 120;
  // Free orbit in any direction — no polar clamp fighting the user.
  controls.minPolarAngle = 0;
  controls.maxPolarAngle = Math.PI;
  // No continuous or idle auto-rotation — camera stays exactly where the user left it.
  controls.autoRotate = false;
  controls.rotateSpeed = 0.85;
  controls.zoomSpeed = 1.15;
  controls.target.set(0, 0, 0);
  controls.addEventListener("start", () => {
    if (runtime) runtime.userOrbiting = true;
  });

  scene.add(new THREE.AmbientLight(0x7a93a8, 0.55));
  const key = new THREE.DirectionalLight(0xe8f6ff, 1.2);
  key.position.set(5, 4, 3);
  const fill = new THREE.DirectionalLight(0x3dd6ff, 0.4);
  fill.position.set(-4, -1, -2);
  const rim = new THREE.PointLight(0xb794f6, 0.65, 24);
  rim.position.set(-2.5, 2.2, 3);
  scene.add(key, fill, rim);

  const root = new THREE.Group();
  const packetGroup = new THREE.Group();
  root.add(packetGroup);
  scene.add(root);

  const onResize = () => {
    if (!runtime) return;
    const nw = container.clientWidth || 960;
    const nh = container.clientHeight || 640;
    camera.aspect = nw / Math.max(nh, 1);
    camera.updateProjectionMatrix();
    renderer.setSize(nw, nh, false);
  };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const onPointer = (ev) => {
    if (ev.button !== 0 || !runtime) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObjects(root.children, true);
    const hit = hits.find((h) => h.object?.userData?.pickable);
    if (hit) focusNeuron(hit.object.userData.neuronId);
  };
  renderer.domElement.addEventListener("pointerdown", onPointer);
  window.addEventListener("resize", onResize);

  runtime = {
    scene,
    camera,
    renderer,
    controls,
    root,
    packetGroup,
    nodeById: new Map(),
    labelById: new Map(),
    edgeCurves: [],
    nodes: [],
    edges: [],
    container,
    onResize,
    onPointer,
    cameraFitted: false,
    userOrbiting: false,
  };

  lastRevision = "";
  packets = [];
  await refreshMemoryGraph({ force: true }).catch(() => {});
  startMemoryLivePolling();
  startAnim();
}

export function unmountMemoryBrainPage() {
  pageOpen = false;
  document.body.dataset.atlasMemoryGraph = "0";
  document.body.classList.remove("memory-page-active", "memory-holo-open");
  const hud = document.getElementById("memoryPage");
  if (hud) {
    hud.hidden = true;
    hud.setAttribute("aria-hidden", "true");
    hud.classList.remove("is-open");
  }
  stopMemoryLivePolling();
  disposeRuntime();
}

/** @deprecated popup API — maps to permanent page helpers for old callers */
export function openMemoryGraphPanel() {
  const gl = document.getElementById("glCanvas");
  if (gl && document.body.dataset.module === "memory") {
    return mountMemoryBrainPage(gl);
  }
  /* module switch owns mounting */
}

export function closeMemoryGraphPanel() {
  unmountMemoryBrainPage();
}

export function toggleMemoryGraphPanel() {
  if (pageOpen) unmountMemoryBrainPage();
  else openMemoryGraphPanel();
}

export function notifyMemoryChanged() {
  window.dispatchEvent(new CustomEvent("atlas:memory-changed"));
  if (pageOpen) {
    lastRevision = "";
    refreshMemoryGraph({ force: true }).catch(() => {});
  }
}

export function wireMemoryGraphUi() {
  const hud = document.getElementById("memoryPage");
  if (hud?.dataset.wired === "1") return;
  if (hud) hud.dataset.wired = "1";
  document.getElementById("memoryGraphRefresh")?.addEventListener("click", () => {
    lastRevision = "";
    refreshMemoryGraph({ force: true }).catch(() => {});
  });
  window.addEventListener("atlas:memory-changed", () => {
    if (!pageOpen) return;
    lastRevision = "";
    refreshMemoryGraph({ force: true }).catch(() => {});
  });
  // Ensure legacy bottom panel never shows as a modal.
  const bottom = document.getElementById("memoryBottom");
  if (bottom) {
    bottom.hidden = true;
    bottom.setAttribute("aria-hidden", "true");
  }
}
