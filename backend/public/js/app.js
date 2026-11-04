import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import {
  CITY_LOD_HEIGHT,
  destroyMapGlobe,
  detectLowGpu,
  emphasizeTopIds,
  filterTopEntities,
  flyToTop,
  getGlobeState,
  getViewer,
  HOME_VIEW,
  mountMapGlobe,
  resetNorth,
  searchPlace,
  setFollowLabel,
  setOrbitEnabled,
  setPulseTop,
  updateMapGlobeTops,
  updateNewsPins,
  zoomByFactor,
  zoomToHeight,
} from "./mapGlobe.js?v=rail-25-atlas";
import {
  fetchAiNews,
  fetchAiStatus,
  openBriefingModal,
  runPaidAiTurn,
  shouldPromptBriefing,
  startProactivePolling,
  syncClientMemoryToServer,
  wireActionRunner,
  wireBriefingForm,
  wireBriefingHandler,
  wireProactiveHandlers,
} from "./aiAgentUi.js?v=rail-25-atlas";
import {
  noteAiFunctionReports,
  openFunctionBoardPanel,
  toggleFunctionBoardPanel,
  wireFunctionBoardUi,
} from "./functionBoardUi.js?v=rail-25-atlas";
import { openSandboxDoc, rememberOpenModule, showProblems, wireAgentqUi } from "./agentqUi.js?v=rail-40-mic-clone";
import { voiceDefersToAtlasHands } from "./atlasHandsPlan.js?v=rail-40-mic-clone";
import {
  dispatchAtlasHand,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
} from "./atlasHoloDispatch.js?v=rail-40-mic-clone";
import { toggleCockpitPanel, wireCockpitUi } from "./atlasCockpitUi.js?v=rail-40-mic-clone";
import {
  mountMemoryBrainPage,
  unmountMemoryBrainPage,
  wireMemoryGraphUi,
} from "./atlasMemoryGraphUi.js?v=rail-43-memory-orbit";
import { normalizeSpeakText } from "./atlasSpeak.js?v=rail-40-mic-clone";
import { VOICE_DUPLEX, reduceCall, shouldYieldToCall, wakeWordStatus } from "./atlasCall.js?v=rail-40-mic-clone";
import {
  WAKE_WORD,
  canArmAlwaysOn,
  isDesktopVoiceHost,
  matchesWakeWord,
  reduceAlwaysOn,
  wakeCommandRemainder,
} from "./atlasWake.js?v=rail-40-mic-clone";

const BUILD_ID = "rail-43-memory-orbit";
const CHAT_MODEL_STORAGE_KEY = "ops_chat_model";
const COMPANY_NOTES_KEY = "ops_company_notes";
const TOPS_ORDER_KEY_PREFIX = "ops_tops_order_";
const VIEW_MEMORY_KEY = "ops_last_view";
const ONBOARD_KEY = "ops_voice_onboard_v1";
const ACCENT_KEY = "ops_accent_theme";
const MODULES = ["map", "pipeline", "memory", "chat"];
const CITY_FLY_HEIGHT = CITY_LOD_HEIGHT;
const AUTO_REFRESH_MS = 60_000;
const AUTO_TOUR_MS = 14_000;
const TOUR_IDLE_MS = 20_000;
const CHAT_SUGGESTIONS = [
  "Riassumi i top di oggi",
  "Quali errori pipeline sono aperti?",
  "Dove è debole la coverage?",
  "Confronta i primi 3 business",
  "Cosa verificare prima del ranking?",
];
const MODEL_COST_HINTS = {
  "deepseek/deepseek-v4.1-flash": "~$0.05–0.50 /1M",
  "deepseek/deepseek-v4.1-flash-1017": "~$0.15/$0.60",
  "perplexity/sonar": "~$1/$1 + web",
  "z-ai/glm-5.3-flash": "~$0.02/$0.15",
  "anthropic/claude-sonnet-5.5": "~$2/$10",
  "openai/gpt-6.1-sol": "~$2/$10",
  "anthropic/claude-opus-5.5": "~$4/$20",
  "meta-llama/llama-3.1-70b-instruct": "value tier",
  "mistralai/mixtral-8x7b-instruct": "value tier",
  "google/gemini-2.0-flash-001": "value tier",
  "meta-llama/llama-3.2-3b-instruct": "lite",
  "anthropic/claude-3.5-sonnet": "premium",
  "openai/gpt-4o": "premium",
  "google/gemini-2.5-pro": "premium",
};

const state = {
  module: "map",
  snapshot: null,
  threadId: null,
  chatModel: null,
  chatModelCatalog: null,
  sideFilter: "",
  lastUpdated: null,
  secrets: null,
  recognition: null,
  micLive: false,
  renderer: null,
  scene: null,
  camera: null,
  controls: null,
  animId: null,
  rootGroup: null,
  autoRotate: true,
  resizeObserver: null,
  pulse: [],
  mapEngine: "cesium", // progressive 5-level LOD satellite zoom
  focusedTopId: null,
  dragTopId: null,
  compareIds: [],
  mapChipFilters: { region: null, source: null, minScore: null },
  coverageFocusIdx: 0,
  coverageScrubActive: false,
  lastMapPick: null,
  pickHandler: null,
  memoryLinks: [],
  memoryMeshes: new Map(),
  autoRefreshTimer: null,
  autoTourTimer: null,
  tourIdx: 0,
  tourTopId: null,
  lastUserInputAt: 0,
  refreshCount: 0,
  lowGpu: false,
  aiStatus: null,
  aiPaid: false,
  news: [],
  pendingAttachment: null,
};

const $ = (id) => document.getElementById(id);

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

function healthClass(status) {
  if (status === "ok") return "ok";
  if (status === "degraded") return "warn";
  return "bad";
}

function setHealth(health) {
  const el = $("healthBadge");
  if (el) {
    el.className = `health ${healthClass(health.status)}`;
    el.textContent = `HEALTH ${String(health.status || "—").toUpperCase()}`;
  }
  const cov = $("statCoverage");
  const covPct = Math.round((health.coverageAvg ?? 0) * 100);
  if (cov) {
    cov.textContent = "COVERAGE";
    cov.title = `Coverage media ${covPct}%`;
    cov.dataset.value = String(covPct);
  }
  setSignalBars(health);
  if ($("footerRight")) {
    $("footerRight").textContent = `errs ${health.openErrors ?? 0} · thr ${((health.verificationThreshold ?? 0.72) * 100) | 0}%`;
  }
}

/** Header signal strength: lit bars track health score (0–100). */
function setSignalBars(health) {
  const host = $("signalBars");
  if (!host) return;
  const bars = host.querySelectorAll("i");
  const score = Number.isFinite(health?.score)
    ? health.score
    : health?.status === "ok"
      ? 90
      : health?.status === "degraded"
        ? 55
        : 20;
  const lit = Math.max(1, Math.round((Math.min(100, Math.max(0, score)) / 100) * bars.length));
  bars.forEach((b, i) => b.classList.toggle("on", i < lit));
  host.setAttribute("aria-label", `Segnale ${score}/100 · menu`);
}

function tickUtcClock() {
  const el = $("utcClock");
  if (!el) return;
  const now = new Date();
  el.textContent = `${now.toISOString().slice(11, 19)} UTC`;
}

function renderCoverageMini(coverage) {
  if (!coverage?.length) {
    $("coverageMini").textContent = "Coverage —";
    return;
  }
  const avg = coverage.reduce((s, c) => s + (c.pct || 0), 0) / coverage.length;
  $("coverageMini").textContent = `Coverage ${Math.round(avg * 100)}% transparent`;
}

function disposeScene() {
  if (state.animId) cancelAnimationFrame(state.animId);
  state.animId = null;
  state.pulse = [];
  if (state.resizeObserver) {
    state.resizeObserver.disconnect();
    state.resizeObserver = null;
  }
  if (state.renderer) {
    try {
      const lose = state.renderer.getContext()?.getExtension?.("WEBGL_lose_context");
      lose?.loseContext?.();
    } catch {
      /* ignore */
    }
    try {
      state.renderer.forceContextLoss?.();
    } catch {
      /* ignore */
    }
    state.renderer.dispose();
    const canvas = state.renderer.domElement;
    canvas?.parentNode?.removeChild(canvas);
  }
  state.renderer = null;
  state.scene = null;
  state.camera = null;
  state.controls = null;
  state.rootGroup = null;
}

/** Wait two animation frames so Cesium/WebGL teardown can release the GPU before Three.js mounts. */
function settleGlAfterTeardown() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function forceLoseLeftoverWebgl(container) {
  if (!container) return;
  container.querySelectorAll("canvas").forEach((canvas) => {
    try {
      const gl =
        canvas.getContext("webgl2") ||
        canvas.getContext("webgl") ||
        canvas.getContext("experimental-webgl");
      const lose = gl?.getExtension?.("WEBGL_lose_context");
      lose?.loseContext?.();
    } catch {
      /* ignore — context may already be gone */
    }
  });
}

function addStarfield(scene) {
  const count = 1400;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const r = 40 + Math.random() * 60;
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
      new THREE.PointsMaterial({ color: 0x9fb8c9, size: 0.05, sizeAttenuation: true, transparent: true, opacity: 0.75 }),
    ),
  );
}

function initThree(container, { autoRotate = true, minDistance = 2.4, maxDistance = 20 } = {}) {
  disposeScene();
  state.autoRotate = autoRotate;
  let w = container.clientWidth;
  let h = container.clientHeight;
  if (w < 40 || h < 40) {
    w = Math.max(w, container.parentElement?.clientWidth || 900);
    h = Math.max(h, Math.floor((container.parentElement?.clientHeight || 560) * 0.92));
  }
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05080d, 0.018);
  const camera = new THREE.PerspectiveCamera(42, w / Math.max(h, 1), 0.1, 200);
  camera.position.set(0, 1.4, 5.6);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  // Prefer near-4K backing store for Three.js modules (pipeline/memory/map fallback)
  const dprCap = Math.min(Math.max(window.devicePixelRatio || 1, 1), 3);
  renderer.setPixelRatio(dprCap);
  renderer.setSize(w, h, false);
  renderer.setClearColor(0x05080d, 1);
  container.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { width: "100%", height: "100%", display: "block" });

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = minDistance;
  controls.maxDistance = maxDistance;
  controls.rotateSpeed = 0.75;
  controls.zoomSpeed = 1.05;
  controls.autoRotate = Boolean(autoRotate);
  controls.autoRotateSpeed = 0.55;
  let resumeTimer = null;
  controls.addEventListener("start", () => {
    controls.autoRotate = false;
    clearTimeout(resumeTimer);
  });
  controls.addEventListener("end", () => {
    clearTimeout(resumeTimer);
    if (autoRotate) {
      resumeTimer = setTimeout(() => {
        controls.autoRotate = true;
      }, 4500);
    }
  });

  scene.add(new THREE.AmbientLight(0x6f8799, 0.55));
  const key = new THREE.DirectionalLight(0xd7f0ff, 1.15);
  key.position.set(5, 3.5, 4);
  const fill = new THREE.DirectionalLight(0x3dd6ff, 0.45);
  fill.position.set(-4, -1, -3);
  const rim = new THREE.PointLight(0x3dff9a, 0.55, 20);
  rim.position.set(-2, 2.5, 3);
  scene.add(key, fill, rim);
  addStarfield(scene);

  const root = new THREE.Group();
  scene.add(root);
  state.scene = scene;
  state.camera = camera;
  state.renderer = renderer;
  state.controls = controls;
  state.rootGroup = root;
  state.pickHandler = null;

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  renderer.domElement.addEventListener("pointerdown", (ev) => {
    if (!state.pickHandler || !state.scene || !state.camera) return;
    if (ev.button !== 0) return;
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, state.camera);
    const hits = raycaster.intersectObjects(state.rootGroup.children, true);
    const hit = hits.find((h) => h.object?.userData?.pickable);
    if (hit) state.pickHandler(hit.object.userData, hit.object, ev);
  });

  const syncSize = () => {
    if (!state.renderer) return;
    const nw = Math.max(container.clientWidth, 1);
    const nh = Math.max(container.clientHeight, 1);
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
    renderer.setSize(nw, nh, false);
  };
  state.resizeObserver = new ResizeObserver(syncSize);
  state.resizeObserver.observe(container);
  requestAnimationFrame(syncSize);

  const tick = (t) => {
    state.animId = requestAnimationFrame(tick);
    for (const p of state.pulse) {
      const wave = 1 + Math.sin(t * 0.004 + p.phase) * 0.16;
      const bx = p.baseX || 1;
      const by = p.baseY || bx;
      p.mesh.scale.set(bx * wave, by * wave, 1);
      if (p.mat) p.mat.opacity = 0.4 + (Math.sin(t * 0.004 + p.phase) + 1) * 0.22;
    }
    controls.update();
    renderer.render(scene, camera);
  };
  tick(0);
  return root;
}

/** Public-domain / open demo Earth textures (NOT Palantir assets). Dark ops tone applied in material. */
const EARTH_TEX = {
  // Blue Marble day (NASA-style equirectangular via three-globe examples CDN)
  day: "https://cdn.jsdelivr.net/npm/three-globe@2.41.12/example/img/earth-blue-marble.jpg",
  night: "https://cdn.jsdelivr.net/npm/three-globe@2.41.12/example/img/earth-night.jpg",
  topo: "https://cdn.jsdelivr.net/npm/three-globe@2.41.12/example/img/earth-topology.png",
  water: "https://cdn.jsdelivr.net/npm/three-globe@2.41.12/example/img/earth-water.png",
  // NASA Visible Earth fallback (public)
  nasaDay:
    "https://eoimages.gsfc.nasa.gov/images/imagerecords/57000/57752/land_shallow_topo_2048.jpg",
};

function loadTexture(url) {
  return new Promise((resolve, reject) => {
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    loader.load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        resolve(tex);
      },
      undefined,
      reject,
    );
  });
}

async function loadSatelliteMaps() {
  try {
    const [day, night, topo, water] = await Promise.all([
      loadTexture(EARTH_TEX.day),
      loadTexture(EARTH_TEX.night),
      loadTexture(EARTH_TEX.topo),
      loadTexture(EARTH_TEX.water),
    ]);
    return { day, night, topo, water, source: "satellite-dark" };
  } catch (err) {
    console.warn("Primary satellite textures failed, trying NASA day map", err);
    try {
      const day = await loadTexture(EARTH_TEX.nasaDay);
      return { day, night: null, topo: null, water: null, source: "nasa-day" };
    } catch (err2) {
      console.warn("NASA texture failed, procedural fallback", err2);
      return { day: makeProceduralFallback(), night: null, topo: null, water: null, source: "procedural" };
    }
  }
}

function makeProceduralFallback() {
  const w = 2048;
  const h = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0a1820";
  ctx.fillRect(0, 0, w, h);
  const lands = [
    [0.18, 0.38, 0.14, 0.18], [0.48, 0.3, 0.22, 0.16], [0.62, 0.42, 0.16, 0.2],
    [0.12, 0.62, 0.08, 0.18], [0.82, 0.28, 0.12, 0.1],
  ];
  for (const [cx, cy, rw, rh] of lands) {
    const g = ctx.createRadialGradient(cx * w, cy * h, 0, cx * w, cy * h, Math.max(rw, rh) * w);
    g.addColorStop(0, "#2a4a38");
    g.addColorStop(1, "rgba(8,20,18,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx * w, cy * h, rw * w, rh * h, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Dark-ops grade with legible continents (public Blue Marble — no Palantir tiles).
 * Oceans stay dark teal-black; land keeps most Blue Marble luminance.
 */
function makeDarkOpsAlbedo(dayTex, topoTex) {
  const img = dayTex.image;
  if (!img || !img.width) return dayTex;
  const w = img.width;
  const h = img.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  // Light topo for relief only — do not crush land
  if (topoTex?.image) {
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = 0.18;
    ctx.drawImage(topoTex.image, 0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i];
    let g = px[i + 1];
    let b = px[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const isOcean = lum < 72 && b >= g * 0.9 && b >= r * 0.95;
    if (isOcean) {
      // Readable dark ocean (not crushed to void)
      px[i] = 12 + lum * 0.12;
      px[i + 1] = 22 + lum * 0.16;
      px[i + 2] = 32 + lum * 0.22;
    } else {
      // Keep ~80–90% of source luminance, mild cool desaturate
      const lift = Math.max(0, lum - 70) * 0.22;
      const nr = lum * 0.22 + r * 0.58 + 28 + lift;
      const ng = lum * 0.2 + g * 0.62 + 32 + lift;
      const nb = lum * 0.18 + b * 0.5 + 30 + lift * 0.85;
      px[i] = Math.min(255, nr);
      px[i + 1] = Math.min(255, ng);
      px[i + 2] = Math.min(255, nb);
    }
  }
  ctx.putImageData(data, 0, 0);

  // Very light teal grade — legibility first
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "rgba(140, 170, 165, 0.18)";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";

  // Hairline graticule (visible over land)
  ctx.strokeStyle = "rgba(120, 210, 235, 0.22)";
  ctx.lineWidth = Math.max(1, w / 1800);
  for (let i = 1; i < 18; i++) {
    const y = (i / 18) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  for (let i = 1; i < 36; i++) {
    const x = (i / 36) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(61, 214, 255, 0.35)";
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function latLonToVec3(lat, lon, radius) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lon + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

function slerpVec(a, b, t) {
  const aa = a.clone().normalize();
  const bb = b.clone().normalize();
  let dot = THREE.MathUtils.clamp(aa.dot(bb), -1, 1);
  const omega = Math.acos(dot);
  if (omega < 1e-4) return aa.lerp(bb, t).normalize();
  const so = Math.sin(omega);
  return aa
    .multiplyScalar(Math.sin((1 - t) * omega) / so)
    .add(bb.multiplyScalar(Math.sin(t * omega) / so))
    .normalize();
}

function greatCirclePoints(a, b, radius, segments = 64) {
  const points = [];
  const altitude = 1.0;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    // Arc loft: peak mid-arc for COP link readability
    const loft = 1 + Math.sin(Math.PI * t) * 0.06 * altitude;
    points.push(slerpVec(a, b, t).multiplyScalar(radius * loft));
  }
  return points;
}

function addHairlineGraticule(root, radius) {
  const mat = new THREE.LineBasicMaterial({
    color: 0x7adfff,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
  });
  // Parallels every 20°
  for (let lat = -60; lat <= 60; lat += 20) {
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 4) {
      pts.push(latLonToVec3(lat, lon, radius));
    }
    root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
  }
  // Meridians every 30°
  for (let lon = -180; lon < 180; lon += 30) {
    const pts = [];
    for (let lat = -90; lat <= 90; lat += 3) {
      pts.push(latLonToVec3(lat, lon, radius));
    }
    root.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat.clone()));
  }
}

function makeMarkerRing(color) {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.12, color);
  g.addColorStop(0.4, color.replace(")", ",0.55)").replace("rgb", "rgba"));
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(64, 64, 26, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(64, 64, 32, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  return new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

async function buildMap(root, tops) {
  const R = 1.85;
  $("moduleLegend").textContent = "Map · loading satellite imagery…";
  const maps = await loadSatelliteMaps();
  if (state.module !== "map" || !state.rootGroup) return;

  const albedo = makeDarkOpsAlbedo(maps.day, maps.topo);
  const mat = new THREE.MeshStandardMaterial({
    map: albedo,
    color: 0xffffff,
    metalness: 0.08,
    roughness: 0.82,
    bumpMap: maps.topo || null,
    bumpScale: maps.topo ? 0.06 : 0,
    displacementMap: maps.topo || null,
    displacementScale: maps.topo ? 0.018 : 0,
    emissiveMap: maps.night || null,
    emissive: maps.night ? new THREE.Color(0x4a8aaa) : new THREE.Color(0x0a1218),
    emissiveIntensity: maps.night ? 1.35 : 0.12,
  });

  const globe = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 160), mat);
  root.add(globe);

  // Soft ocean specular only — low opacity so land stays readable
  if (maps.water) {
    root.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(R * 1.0012, 128, 128),
        new THREE.MeshStandardMaterial({
          map: maps.water,
          color: 0x0a1820,
          transparent: true,
          opacity: 0.18,
          metalness: 0.75,
          roughness: 0.28,
          emissive: new THREE.Color(0x0c3038),
          emissiveIntensity: 0.15,
          depthWrite: false,
        }),
      ),
    );
  }

  // Stronger limb atmosphere for silhouette against dark UI
  root.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.028, 64, 64),
      new THREE.MeshBasicMaterial({
        color: 0x5ec8e6,
        transparent: true,
        opacity: 0.11,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    ),
  );
  root.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.07, 48, 48),
      new THREE.MeshBasicMaterial({
        color: 0x1a5a6e,
        transparent: true,
        opacity: 0.07,
        side: THREE.BackSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    ),
  );

  addHairlineGraticule(root, R * 1.006);

  const markers = [];
  const green = "rgb(61,255,154)";
  const amber = "rgb(255,193,74)";
  (tops || []).slice(0, 10).forEach((t, i) => {
    const lat = Number.isFinite(t.lat) ? t.lat : 20 - i * 8;
    const lon = Number.isFinite(t.lon) ? t.lon : -40 + i * 28;
    const pos = latLonToVec3(lat, lon, R * 1.02);
    const verified = Boolean(t.verified);
    const rgb = verified ? green : amber;

    const ring = new THREE.Sprite(makeMarkerRing(rgb));
    const scale = 0.36 + (t.score || 0.5) * 0.28;
    ring.scale.set(scale, scale, 1);
    ring.position.copy(pos);
    root.add(ring);
    state.pulse.push({ mesh: ring, phase: i, baseX: scale, baseY: scale });

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.022 + (t.score || 0.5) * 0.018, 16, 16),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    core.position.copy(pos);
    root.add(core);

    const normal = pos.clone().normalize();
    const beamLen = 0.28 + (t.score || 0.5) * 0.2;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.002, beamLen, 8),
      new THREE.MeshBasicMaterial({
        color: verified ? 0x3dff9a : 0x3dd6ff,
        transparent: true,
        opacity: 0.65,
      }),
    );
    beam.position.copy(normal.clone().multiplyScalar(R * 1.02 + beamLen / 2));
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    root.add(beam);

    const label = makeSprite(t.title || t.id, true);
    label.position.copy(normal.clone().multiplyScalar(R * 1.02 + beamLen + 0.12));
    root.add(label);
    markers.push({ pos, verified, score: t.score || 0.5 });
  });

  // High-confidence arcs only (verified pairs / consecutive tops)
  for (let i = 0; i < markers.length - 1; i++) {
    if (!(markers[i].score > 0.7 && markers[i + 1].score > 0.7)) continue;
    const pts = greatCirclePoints(markers[i].pos, markers[i + 1].pos, R * 1.01, 72);
    root.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: 0x3dd6ff,
          transparent: true,
          opacity: 0.42,
        }),
      ),
    );
    // Soft pulse twin (wider, dimmer)
    root.add(
      new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({
          color: 0x7adfff,
          transparent: true,
          opacity: 0.12,
        }),
      ),
    );
  }

  state.camera.position.set(0.15, 0.85, 4.55);
  state.controls.target.set(0, 0, 0);
  state.controls.minDistance = 2.5;
  state.controls.maxDistance = 10;
  state.autoRotate = true;
  $("moduleLegend").textContent =
    maps.source === "procedural"
      ? "Map · procedural fallback"
      : "GLOBE · dark satellite COP · public Blue Marble · drag to orbit";
  $("coverageMini").textContent = "Layer: satellite · tops · arcs · atmosphere";
}

function buildPipeline(root, nodes, edges) {
  const positions = {};
  const layers = {};
  (nodes || []).forEach((n) => {
    layers[n.layer] = layers[n.layer] || [];
    layers[n.layer].push(n);
  });
  const layerKeys = Object.keys(layers).sort((a, b) => Number(a) - Number(b));
  layerKeys.forEach((lk, li) => {
    const arr = layers[lk];
    arr.forEach((n, i) => {
      const x = (i - (arr.length - 1) / 2) * 1.4;
      const z = (li - (layerKeys.length - 1) / 2) * 1.8;
      const y = (n.health === "ok" ? 0.2 : n.health === "warn" ? 0 : -0.25);
      positions[n.id] = new THREE.Vector3(x, y, z);
      const color = n.health === "ok" ? 0x3dff9a : n.health === "warn" ? 0xffc14a : 0xff5a6a;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.45, 0.45),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2, metalness: 0.3, roughness: 0.5 })
      );
      mesh.position.copy(positions[n.id]);
      mesh.userData = { pickable: true, kind: "pipeline-node", node: n };
      root.add(mesh);
      const label = makeSprite(n.label || n.id);
      label.position.set(x, y + 0.45, z);
      root.add(label);
    });
  });
  (edges || []).forEach((e) => {
    const a = positions[e.from];
    const b = positions[e.to];
    if (!a || !b) return;
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x3dd6ff, transparent: true, opacity: 0.55 }));
    root.add(line);
  });
  state.camera.position.set(0, 4, 9);
  state.controls.target.set(0, 0, 0);
  state.pickHandler = (data) => {
    if (data?.kind === "pipeline-node") inspectPipelineNode(data.node);
  };
}

function makeSprite(text, compact = false) {
  const canvas = document.createElement("canvas");
  canvas.width = compact ? 360 : 280;
  canvas.height = compact ? 56 : 68;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(6,12,20,0.92)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(61,214,255,0.75)";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  ctx.fillStyle = "#f2f6fa";
  ctx.font = compact ? "600 22px IBM Plex Sans" : "600 24px IBM Plex Sans";
  ctx.fillText(String(text).slice(0, compact ? 28 : 22), 12, compact ? 36 : 44);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(compact ? 1.25 : 1.35, compact ? 0.2 : 0.34, 1);
  return spr;
}

function showToast(message, kind = "ok") {
  const host = $("toastHost");
  if (!host) return;
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function formatAlt(meters) {
  const h = Number(meters);
  if (!Number.isFinite(h)) return "";
  if (h >= 1000) return `${Math.round(h / 1000)} km`;
  return `${Math.round(h)} m`;
}

function readCompanyNotes() {
  try {
    return JSON.parse(localStorage.getItem(COMPANY_NOTES_KEY) || "{}") || {};
  } catch {
    return {};
  }
}

function writeCompanyNote(id, text) {
  const all = readCompanyNotes();
  if (text?.trim()) all[id] = text.trim();
  else delete all[id];
  try {
    localStorage.setItem(COMPANY_NOTES_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

function downloadText(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportTopsCsv(tops) {
  const rows = [["rank", "id", "title", "score", "region", "source", "lat", "lon"]];
  (tops || []).forEach((t, i) => {
    rows.push([
      t.rank ?? i + 1,
      t.id || t.business_key || "",
      `"${String(t.title || "").replace(/"/g, '""')}"`,
      t.score ?? "",
      `"${String(t.region || "").replace(/"/g, '""')}"`,
      `"${String(t.source || "").replace(/"/g, '""')}"`,
      t.lat ?? "",
      t.lon ?? "",
    ]);
  });
  downloadText(`tops-${state.snapshot?.day_key || "export"}.csv`, rows.map((r) => r.join(",")).join("\n"), "text/csv");
  showToast("Export CSV tops completato");
}

function updateStatsStrip(snap) {
  const health = snap?.health || {};
  const errors = (snap?.errors || []).filter((e) => e.status === "open");
  const cov = Math.round((health.coverageAvg ?? 0) * 100);
  if ($("statDay")) {
    $("statDay").textContent = "DAY";
    $("statDay").title = `Giorno dati ${snap?.day_key || "—"}`;
    $("statDay").dataset.value = snap?.day_key || "";
  }
  if ($("statTops")) $("statTops").innerHTML = `Tops <strong>${(snap?.tops || []).length}</strong>`;
  if ($("statErrors")) $("statErrors").innerHTML = `Errors <strong>${errors.length}</strong>`;
  if ($("statCoverage")) {
    $("statCoverage").textContent = "COVERAGE";
    $("statCoverage").title = `Coverage media ${cov}%`;
    $("statCoverage").dataset.value = String(cov);
  }
  if ($("statUpdated")) {
    const ts = state.lastUpdated ? state.lastUpdated.toLocaleTimeString() : "—";
    $("statUpdated").textContent = `Updated ${ts}`;
  }
  const sec = state.secrets || {};
  if ($("statSecrets")) {
    const or = sec.openrouter ? "OR ✓" : "OR ✗";
    const pw = sec.site_password ? "PWD ✓" : "PWD ✗";
    $("statSecrets").innerHTML = `API <strong>${or}</strong> · ${pw}`;
  }
  if ($("footerRight")) {
    $("footerRight").textContent = `score ${health.score ?? "—"} · ${health.status || "—"}`;
  }
}

async function refreshSecretsStatus() {
  try {
    const h = await fetch("/health", { credentials: "same-origin" }).then((r) => r.json());
    state.secrets = h.secrets_configured || null;
    // Server health cannot see the UA. Desktop always-on is armed here only.
    // iPad/iPhone/iPod stay Phase Now. wakeWord is "later" until a desktop host is armed.
    const desktop = isDesktopVoiceHost(navigator.userAgent);
    const envOn = Boolean(h.voice?.alwaysOn);
    const armed = canArmAlwaysOn({ alwaysOnEnv: envOn, desktop });
    document.documentElement.dataset.voiceDuplex = h.voice?.duplex || VOICE_DUPLEX;
    if (armed) {
      document.documentElement.dataset.wakeWordArmed = "1";
      document.documentElement.dataset.wakeWord = "desktop-always-on";
      document.documentElement.dataset.voiceAlwaysOn = "1";
      if (document.documentElement.dataset.voiceCall !== "1") {
        document.documentElement.dataset.voicePhase = "desktop-always-on";
      }
      // Marks the controller only. The first MIC tap is what calls getUserMedia.
      globalMicControl?.armAlwaysOn?.();
    } else {
      document.documentElement.dataset.wakeWordArmed = "0";
      document.documentElement.dataset.wakeWord = "later";
      document.documentElement.dataset.voiceAlwaysOn = envOn ? "1" : "0";
      if (document.documentElement.dataset.voiceCall !== "1" && document.documentElement.dataset.voicePhase === "desktop-always-on") {
        document.documentElement.dataset.voicePhase = "idle";
      }
    }
  } catch {
    state.secrets = null;
  }
}

function renderChatSuggestions() {
  const host = $("chatPromptChips");
  if (!host) return;
  host.innerHTML = "";
  CHAT_SUGGESTIONS.forEach((prompt) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = prompt;
    b.onclick = () => {
      $("chatInput").value = prompt;
      sendChat(prompt);
    };
    host.appendChild(b);
  });
}

function updateModelHint() {
  const hint = $("chatModelHint");
  if (!hint) return;
  const id = getSelectedChatModel();
  hint.textContent = MODEL_COST_HINTS[id] || "";
}

function topsOrderKey(dayKey) {
  return `${TOPS_ORDER_KEY_PREFIX}${dayKey || "unknown"}`;
}

function readTopsOrder(dayKey) {
  try {
    return JSON.parse(localStorage.getItem(topsOrderKey(dayKey)) || "[]") || [];
  } catch {
    return [];
  }
}

function writeTopsOrder(dayKey, ids) {
  try {
    localStorage.setItem(topsOrderKey(dayKey), JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

function orderedTops(snap) {
  const tops = [...(snap?.tops || [])];
  const order = readTopsOrder(snap?.day_key);
  if (!order.length) return tops;
  const byId = new Map(tops.map((t) => [t.id, t]));
  const sorted = [];
  order.forEach((id) => {
    if (byId.has(id)) {
      sorted.push(byId.get(id));
      byId.delete(id);
    }
  });
  byId.forEach((t) => sorted.push(t));
  return sorted;
}

function findTop(id) {
  return (state.snapshot?.tops || []).find((t) => t.id === id) || null;
}

function setFocusedTop(id) {
  state.focusedTopId = id || null;
  document.querySelectorAll(".card[data-top-id]").forEach((card) => {
    card.classList.toggle("is-focused", card.dataset.topId === id);
  });
  const top = id ? findTop(id) : null;
  setFollowLabel(id, top?.title || "");
  setPulseTop(id);
}

function flyToTopCard(t) {
  if (!t) return;
  const lon = Number.isFinite(t.lon) ? t.lon : 12.5;
  const lat = Number.isFinite(t.lat) ? t.lat : 42;
  setFocusedTop(t.id);
  flyToTop(lon, lat, CITY_FLY_HEIGHT);
  showToast(`Fly → ${t.title || t.id}`);
}

async function openChatAnalyze(title) {
  const prompt = `analizza ${title || "questa azienda"}`;
  await showModule("chat");
  const input = $("chatInput");
  if (input) {
    input.value = prompt;
    input.focus();
  }
  showToast("Atlas pronto");
}

function updateCompareStrip() {
  const strip = $("compareStrip");
  if (!strip) return;
  const [aId, bId] = state.compareIds;
  const a = findTop(aId);
  const b = findTop(bId);
  strip.hidden = !(a || b);
  const fill = (el, top, label) => {
    if (!el) return;
    if (!top) {
      el.innerHTML = `<span class="muted">${label}</span>`;
      return;
    }
    el.innerHTML = `<strong>${escapeHtml(top.title)}</strong>
      <span class="mono">${Math.round((top.score || 0) * 100)}%</span>
      <div class="muted">${escapeHtml(top.region || "")} · ${escapeHtml(top.source || "")}</div>`;
  };
  fill($("compareA"), a, "Pin A");
  fill($("compareB"), b, "Pin B");
  emphasizeTopIds(state.compareIds.filter(Boolean));
}

function pinCompare(top) {
  if (!top?.id) return;
  if (state.compareIds.includes(top.id)) {
    showToast("Già in confronto", "warn");
    return;
  }
  if (state.compareIds.length >= 2) state.compareIds = [state.compareIds[1]];
  state.compareIds.push(top.id);
  updateCompareStrip();
  showToast(`Confronto · ${top.title || top.id}`);
}

function clearCompare() {
  state.compareIds = [];
  updateCompareStrip();
  emphasizeTopIds([]);
}

function applyMapFilters() {
  const chips = state.mapChipFilters;
  const cov = state.coverageScrubActive ? (state.snapshot?.coverage || [])[state.coverageFocusIdx] : null;
  const covToken = (cov?.domain || "").toLowerCase();
  filterTopEntities((top) => {
    if (chips.region && (top.region || "") !== chips.region) return false;
    if (chips.source && (top.source || "") !== chips.source) return false;
    if (chips.minScore != null && (top.score || 0) < chips.minScore) return false;
    if (covToken) {
      const hay = `${top.source || ""} ${top.title || ""} ${top.region || ""}`.toLowerCase();
      // Soft match: if domain appears in meta keep; else keep high-score tops as fallback
      if (!hay.includes(covToken) && (top.score || 0) < 0.75) return false;
    }
    return true;
  });
}

function renderMapFilterChips(tops) {
  const host = $("mapFilterChips");
  if (!host) return;
  host.innerHTML = "";
  const regions = [...new Set((tops || []).map((t) => t.region).filter(Boolean))].slice(0, 4);
  const sources = [...new Set((tops || []).map((t) => t.source).filter(Boolean))].slice(0, 4);
  const addChip = (label, active, onClick) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = label;
    if (active) b.classList.add("active");
    b.onclick = onClick;
    host.appendChild(b);
  };
  addChip("Tutti", !state.mapChipFilters.region && !state.mapChipFilters.source && state.mapChipFilters.minScore == null, () => {
    state.mapChipFilters = { region: null, source: null, minScore: null };
    renderMapFilterChips(tops);
    applyMapFilters();
  });
  regions.forEach((r) => {
    addChip(r, state.mapChipFilters.region === r, () => {
      state.mapChipFilters.region = state.mapChipFilters.region === r ? null : r;
      renderMapFilterChips(tops);
      applyMapFilters();
    });
  });
  sources.forEach((s) => {
    addChip(s, state.mapChipFilters.source === s, () => {
      state.mapChipFilters.source = state.mapChipFilters.source === s ? null : s;
      renderMapFilterChips(tops);
      applyMapFilters();
    });
  });
  addChip("score≥75%", state.mapChipFilters.minScore === 0.75, () => {
    state.mapChipFilters.minScore = state.mapChipFilters.minScore === 0.75 ? null : 0.75;
    renderMapFilterChips(tops);
    applyMapFilters();
  });
}

function setupCoverageScrub(coverage) {
  const wrap = $("coverageScrub");
  const range = $("coverageScrubRange");
  const label = $("coverageScrubLabel");
  if (!wrap || !range) return;
  const list = coverage || [];
  if (!list.length) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  range.min = "0";
  range.max = String(Math.max(0, list.length - 1));
  range.value = String(Math.min(state.coverageFocusIdx, list.length - 1));
  const paint = () => {
    state.coverageFocusIdx = Number(range.value) || 0;
    const c = list[state.coverageFocusIdx];
    if (label) {
      label.textContent = c
        ? `${c.domain || c.id} · ${Math.round((c.pct || 0) * 100)}%`
        : "—";
    }
    applyMapFilters();
  };
  range.oninput = () => {
    state.coverageScrubActive = true;
    paint();
  };
  paint();
}

function inspectPipelineNode(node) {
  const body = $("sideBody");
  if (!body || !node) return;
  let panel = body.querySelector(".inspect-panel");
  if (!panel) {
    panel = document.createElement("div");
    panel.className = "card inspect-panel";
    body.prepend(panel);
  }
  const errs = (state.snapshot?.errors || []).filter(
    (e) =>
      String(e.code || "").includes(node.id) ||
      String(e.message || "").toLowerCase().includes(String(node.label || "").toLowerCase()) ||
      e.nodeId === node.id,
  );
  panel.innerHTML = `<strong>Inspect · ${escapeHtml(node.label || node.id)}</strong>
    <div class="muted">${escapeHtml(node.kind || "")} · health <span class="mono">${escapeHtml(node.health || "—")}</span></div>
    <div class="muted">layer ${escapeHtml(String(node.layer ?? "—"))}</div>
    ${
      errs.length
        ? `<div class="err">${errs.map((e) => escapeHtml(e.message || e.code || "")).join("<br/>")}</div>`
        : `<div class="muted">Nessun errore collegato</div>`
    }`;
  showToast(`Nodo · ${node.label || node.id}`);
}

async function submitCorrection(id, verdict) {
  const body = $("sideBody");
  const note = body?.querySelector(`input[data-note="${id}"]`)?.value || "";
  await api("/api/corrections", {
    method: "POST",
    body: JSON.stringify({
      targetType: "top",
      targetId: id,
      verdict,
      note,
    }),
  });
  showToast(verdict === "correct" ? "Segnato correct" : "Segnato incorrect", verdict === "correct" ? "ok" : "warn");
  await refresh();
}

function syncHoloActive(actionOrModule) {
  const mod = MODULES.includes(actionOrModule) ? actionOrModule : state.module;
  document.querySelectorAll("#holoVoicePlancia [data-holo-action]").forEach((node) => {
    const a = node.getAttribute("data-holo-action");
    node.classList.toggle("is-active", a === mod || a === actionOrModule);
  });
}

/** Onboarding lines. Spoken only after MIC unlock and only while the mic is closed. */
let pendingVoiceLines = [];
/** True only after unlockVoiceOutput runs synchronously inside MIC pointerdown/click. */
let voiceUnlocked = false;
let lastTtsGateMsgAt = 0;

function isAppleWebKit() {
  const ua = navigator.userAgent || "";
  return /Safari/i.test(ua) && !/Chrome|Chromium|CriOS|Edg|EdgiOS|OPR|Firefox|FxiOS/i.test(ua);
}

function isIpadLike() {
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/i.test(ua)) return true;
  // iPadOS desktop UA: Macintosh + touch
  if (/Macintosh/i.test(ua) && Number(navigator.maxTouchPoints || 0) > 1) return true;
  return isAppleWebKit() && /Mobile/i.test(ua);
}

/** Prefer MediaRecorder+Whisper over SpeechRecognition (avoids false «nessuna voce»). */
function preferWhisperMic() {
  return (
    isIpadLike() ||
    isAppleWebKit() ||
    Number(navigator.maxTouchPoints || 0) > 0 ||
    /Mobile|Android|iPhone|iPad/i.test(navigator.userAgent || "")
  );
}

/** iPadOS 26 SpeechSynthesis can hard-break on angle brackets — strip them always. */
function sanitizeTtsText(text) {
  return String(text || "")
    .replace(/[<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 420);
}

function ensureAudioSessionPlayAndRecord() {
  try {
    if ("audioSession" in navigator && navigator.audioSession) {
      navigator.audioSession.type = "play-and-record";
    }
  } catch {
    /* ignore */
  }
}

function getPrimedAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try {
    if (!state._audioCtx || state._audioCtx.state === "closed") {
      state._audioCtx = new Ctx();
      state._audioPrimed = false;
    }
  } catch {
    return null;
  }
  const ctx = state._audioCtx;
  try {
    ctx.resume?.();
  } catch {
    /* ignore */
  }
  // iOS stays silent later unless a buffer actually starts during the user gesture.
  if (!state._audioPrimed) {
    try {
      const buffer = ctx.createBuffer(1, 1, ctx.sampleRate || 22050);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
      state._audioPrimed = true;
    } catch {
      /* ignore */
    }
  }
  return ctx;
}

/** Every MIC gesture: resume playback and keep the context alive across capture. */
function primeAudioContextInGesture(ctx) {
  if (!ctx) return;
  try {
    const rate = ctx.sampleRate || 44100;
    const frames = Math.max(1, Math.floor(rate * 0.03));
    const buffer = ctx.createBuffer(1, frames, rate);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(0);
    state._audioPrimed = true;
  } catch {
    /* ignore */
  }
  if (state._keepAlive) return;
  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0.00001;
    osc.frequency.value = 30;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    state._keepAlive = osc;
  } catch {
    /* ignore */
  }
}

/**
 * Unlock outgoing voice synchronously inside MIC pointerdown/click.
 * Must NOT be deferred after await/fetch — Safari drops the gesture otherwise.
 * Does not speak: TTS while the mic is opening ducks playback on iPad.
 */
function primeHtmlAudioElement() {
  try {
    if (!state._ttsAudio) {
      const audio = new Audio();
      audio.setAttribute("playsinline", "true");
      audio.preload = "auto";
      state._ttsAudio = audio;
    }
    if (state._htmlAudioPrimed) return;
    // Silent WAV inside the MIC gesture so a later data: URL play() is allowed.
    state._ttsAudio.src =
      "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";
    const pending = state._ttsAudio.play?.();
    state._htmlAudioPrimed = true;
    pending?.catch?.(() => {});
  } catch {
    /* ignore */
  }
}

function unlockVoiceOutput() {
  voiceUnlocked = true;
  document.documentElement.dataset.tts = "1";
  ensureAudioSessionPlayAndRecord();
  primeAudioContextInGesture(getPrimedAudioContext());
  primeHtmlAudioElement();
  // iPadOS 26 SpeechSynthesis can break the audio session. iPad playback is server + AudioContext.
  if (!isIpadLike()) {
    try {
      const synth = window.speechSynthesis;
      if (synth) {
        synth.getVoices?.();
        const warm = new SpeechSynthesisUtterance(" ");
        warm.volume = 0;
        warm.lang = "it-IT";
        synth.speak(warm);
        synth.cancel();
      }
    } catch {
      /* ignore */
    }
  }
  try {
    if (state.aiPaid) {
      api("/api/ai/proactive/tts", {
        method: "POST",
        body: JSON.stringify({ enabled: true }),
      }).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

function pickItalianVoice(synth) {
  try {
    const voices = synth.getVoices?.() || [];
    return (
      voices.find((v) => /it[-_]?IT/i.test(v.lang) && /sara|alice|federica|italian/i.test(v.name)) ||
      voices.find((v) => /it[-_]?IT/i.test(v.lang)) ||
      voices.find((v) => /^it/i.test(v.lang)) ||
      null
    );
  } catch {
    return null;
  }
}

function speakViaSpeechSynthesis(line) {
  // iPad: never use SpeechSynthesis. Playback is server audio on the primed AudioContext.
  if (isIpadLike()) return false;
  const synth = window.speechSynthesis;
  if (!synth || !line) return false;
  try {
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(line);
    utter.lang = "it-IT";
    utter.rate = 1.02;
    utter.volume = 0.95;
    const voice = pickItalianVoice(synth);
    if (voice) utter.voice = voice;
    let started = false;
    utter.onstart = () => {
      started = true;
    };
    synth.speak(utter);
    // Heuristic: if engine has zero voices on WebKit, treat as failed so server TTS can run.
    if (isIpadLike() && !(synth.getVoices?.() || []).length) return false;
    void started;
    return true;
  } catch {
    return false;
  }
}


function playbackStale(token) {
  return token !== state._ttsToken;
}

/** New TTS generation. Cancels any HTMLAudio / AudioContext playback already running. */
function armPlayback() {
  try { state._ttsAbort?.abort(); } catch { /* ignore */ }
  silenceVoice();
  state._ttsToken = (state._ttsToken || 0) + 1;
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  state._ttsAbort = ctrl;
  state._ttsPlaying = true;
  return { token: state._ttsToken, signal: ctrl?.signal };
}

/** Barge-in and hangup: stop Web Audio and HTMLAudio without starting a new clip. */
function cancelPlayback() {
  state._ttsToken = (state._ttsToken || 0) + 1;
  state._ttsPlaying = false;
  try { state._ttsAbort?.abort(); } catch { /* ignore */ }
  silenceVoice();
}

/** Resolves when HTMLAudio or an AudioBufferSourceNode finishes, with a duration cap. */
function waitForPlaybackEnd(target, durationSec, token) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    try {
      target?.addEventListener?.("ended", finish, { once: true });
      target?.addEventListener?.("error", finish, { once: true });
      if (target && "onended" in target) {
        const prev = target.onended;
        target.onended = (ev) => {
          try { if (typeof prev === "function") prev.call(target, ev); } catch { /* ignore */ }
          finish();
        };
      }
    } catch {
      /* ignore */
    }
    const dur = Number(durationSec);
    const cap = Number.isFinite(dur) && dur > 0 && dur < 180
      ? Math.min(dur * 1000 + 700, 60000)
      : 45000;
    const started = Date.now();
    const poll = () => {
      if (playbackStale(token) || Date.now() - started >= cap) finish();
      else setTimeout(poll, 80);
    };
    setTimeout(poll, 80);
  });
}

function b64ToUint8(b64) {
  const raw = atob(b64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Drive the plancia mic-level bars (0..1). */
function paintMicLevel(rms) {
  const level = Math.min(1, Math.max(0, (Number(rms) - 0.003) / 0.1));
  document.documentElement.style.setProperty("--mic-level", level.toFixed(3));
  document.documentElement.dataset.micFlow = level > 0.02 ? "1" : "0";
  const meters = document.querySelectorAll(".mic-level");
  for (const meter of meters) {
    meter.style.setProperty("--mic-level", level.toFixed(3));
    meter.dataset.active = level > 0.02 ? "1" : "0";
    const bars = meter.querySelectorAll("i");
    bars.forEach((bar, idx) => {
      const threshold = (idx + 1) / (bars.length + 0.35);
      bar.classList.toggle("on", level >= threshold * 0.55);
    });
  }
}

function clearMicLevel() {
  paintMicLevel(0);
  document.documentElement.dataset.micFlow = "0";
}

/** Play server MP3. Safari tablet: Blob URL HTMLAudio first (data: URLs go silent). */
async function speakViaServerAudio(line, playback) {
  const token = playback?.token;
  const signal = playback?.signal;
  ensureAudioSessionPlayAndRecord();
  const ctx = getPrimedAudioContext();
  try {
    await ctx?.resume?.();
  } catch {
    /* ignore */
  }
  let data;
  try {
    data = await api("/api/ai/speak", {
      method: "POST",
      body: JSON.stringify({ text: line }),
      signal,
    });
  } catch (err) {
    if (playbackStale(token) || err?.name === "AbortError") return false;
    throw err;
  }
  if (playbackStale(token)) return false;
  const b64 = data?.audioBase64;
  const mime = data?.mime || "audio/mpeg";
  if (!b64) throw new Error(data?.reply || "TTS server senza audio");
  try {
    state._ttsAudio?.pause?.();
  } catch {
    /* ignore */
  }
  const bytes = b64ToUint8(b64);

  const playHtml = async () => {
    if (playbackStale(token)) return false;
    primeHtmlAudioElement?.();
    const audio = state._ttsAudio || new Audio();
    try {
      audio.pause?.();
    } catch {
      /* ignore */
    }
    // Safari tablet: large data: URLs often fail silently. Blob URLs are reliable.
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    audio.setAttribute("playsinline", "true");
    audio.setAttribute("webkit-playsinline", "true");
    audio.preload = "auto";
    audio.volume = 1;
    audio.src = url;
    state._ttsAudio = audio;
    try {
      await audio.play();
      if (playbackStale(token)) {
        try { audio.pause(); } catch { /* ignore */ }
        return false;
      }
      let dur = audio.duration;
      if (!Number.isFinite(dur) || dur <= 0) {
        await new Promise((resolve) => {
          const done = () => resolve();
          audio.addEventListener?.("loadedmetadata", done, { once: true });
          setTimeout(done, 900);
        });
        dur = audio.duration;
      }
      await waitForPlaybackEnd(audio, dur, token);
      return !playbackStale(token);
    } finally {
      try { URL.revokeObjectURL(url); } catch { /* ignore */ }
    }
  };

  const playCtx = async () => {
    if (playbackStale(token)) return false;
    if (!ctx) throw new Error("AudioContext assente");
    ensureAudioSessionPlayAndRecord();
    primeAudioContextInGesture(ctx);
    await ctx.resume?.();
    if (playbackStale(token)) return false;
    if (ctx.state && ctx.state !== "running") {
      throw new Error(`AudioContext ${ctx.state}`);
    }
    const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const audioBuf = await new Promise((resolve, reject) => {
      let settled = false;
      const ok = (buf) => {
        if (settled) return;
        settled = true;
        resolve(buf);
      };
      const bad = (err) => {
        if (settled) return;
        settled = true;
        reject(err || new Error("decodeAudioData fallita"));
      };
      try {
        const result = ctx.decodeAudioData(copy.slice(0), ok, bad);
        if (result && typeof result.then === "function") result.then(ok, bad);
      } catch (err) {
        bad(err);
      }
    });
    if (playbackStale(token)) return false;
    try {
      state._ttsSource?.stop?.();
    } catch {
      /* ignore */
    }
    const source = ctx.createBufferSource();
    source.buffer = audioBuf;
    const gain = ctx.createGain();
    gain.gain.value = 1;
    source.connect(gain);
    gain.connect(ctx.destination);
    state._ttsSource = source;
    source.start(0);
    await waitForPlaybackEnd(source, audioBuf.duration, token);
    return !playbackStale(token);
  };

  // iPad/Safari: HTMLAudio+Blob first (gesture-primed). Desktop: AudioContext first.
  const apple = isIpadLike() || isAppleWebKit();
  const order = apple ? [playHtml, playCtx] : [playCtx, playHtml];
  let lastErr = null;
  for (const play of order) {
    try {
      const played = await play();
      if (played === false) return false;
      return played;
    } catch (err) {
      if (playbackStale(token)) return false;
      lastErr = err;
    }
  }
  throw new Error(lastErr?.message || String(lastErr || "TTS playback fallita"));
}

/**
 * Speak only after MIC unlock. On iPad prefer server TTS on the primed AudioContext.
 * Angle brackets are stripped. `opts.force` must not unlock audio by itself.
 */
function speak(text, opts = {}) {
  // Resident summaries yield the MIC call and stay silent until a real unlock.
  // They must not call getUserMedia and must not take the call's playback slot.
  if (shouldYieldToCall({
    yieldToCall: opts.yieldToCall,
    callOpen: document.documentElement.dataset.voiceCall === "1",
  })) return;
  const unlocked = voiceUnlocked || document.documentElement.dataset.tts === "1";
  if (!unlocked) {
    if (opts.ifUnlocked) return;
    const now = Date.now();
    if (now - lastTtsGateMsgAt > 4000) {
      lastTtsGateMsgAt = now;
      postChatUpdate?.("Tocca MIC per attivare la voce", "warn");
    }
    return;
  }
  const prepared = normalizeSpeakText(String(text || "").replace(/[<>]/g, " "));
  const line = String(prepared.text || "").slice(0, 1500);
  if (!line) return;

  ensureAudioSessionPlayAndRecord();
  const inCall = document.documentElement.dataset.voiceCall === "1";
  let epoch = 0;
  try {
    if (typeof globalMicControl?.releaseForTts === "function") {
      epoch = Number(globalMicControl.releaseForTts()) || 0;
    } else if (!inCall) {
      globalMicControl?.stop?.();
    }
  } catch {
    /* ignore */
  }

  const preferServer = inCall || isIpadLike() || opts.force === "server" || opts.via === "server";
  const failSpeak = (err) => {
    if (err?.name === "AbortError") return;
    const msg = err?.message || String(err || "TTS fallita");
    postChatUpdate?.(`Voce non riprodotta: ${msg}`, "warn");
    showToast?.(`TTS: ${msg}`, "warn");
  };
  const finish = () => {
    state._ttsPlaying = false;
    try { globalMicControl?.resumeAfterTts?.(epoch); } catch { /* ignore */ }
  };
  const run = async () => {
    const playback = armPlayback();
    if (preferServer) {
      try {
        const played = await speakViaServerAudio(line, playback);
        if (played === false) return;
        return;
      } catch (err) {
        if (playbackStale(playback.token) || err?.name === "AbortError") return;
        if (isIpadLike()) throw err;
        const ok = speakViaSpeechSynthesis(line);
        if (!ok) throw err;
        await waitForSpeechSynthesis(playback.token);
        return;
      }
    }
    const ok = speakViaSpeechSynthesis(line);
    if (!ok) {
      const played = await speakViaServerAudio(line, playback);
      if (played === false) return;
      return;
    }
    await waitForSpeechSynthesis(playback.token);
  };
  run().catch(failSpeak).finally(finish);
}

function waitForSpeechSynthesis(token) {
  const synth = window.speechSynthesis;
  if (!synth) return Promise.resolve();
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (token !== undefined && playbackStale(token)) {
        try { synth.cancel(); } catch { /* ignore */ }
        resolve();
        return;
      }
      const speaking = Boolean(synth.speaking || synth.pending);
      if (!speaking && Date.now() - started > 280) resolve();
      else if (Date.now() - started > 22000) resolve();
      else setTimeout(tick, 120);
    };
    setTimeout(tick, 180);
  });
}

function silenceVoice() {
  try {
    window.speechSynthesis?.cancel?.();
  } catch {
    /* ignore */
  }
  try {
    state._ttsSource?.stop?.();
  } catch {
    /* ignore */
  }
  state._ttsSource = null;
  try {
    state._ttsAudio?.pause?.();
    if (state._ttsAudio) state._ttsAudio.currentTime = 0;
  } catch {
    /* ignore */
  }
}

function presentChatText(text, role = "system") {
  const raw = String(text || "");
  if (String(role || "").toLowerCase() === "user") return raw;
  return raw.replace(/\bAgente Q\b|\bAgent Q\b|\bAgentQ\b/g, "Atlas");
}

function atlasThreadLabel(title) {
  const raw = presentChatText(title, "system").trim();
  if (!raw || /^(session|nuova chat|new chat)$/i.test(raw)) return "Atlas";
  return raw;
}

function chatExportRole(role) {
  const r = String(role || "").toLowerCase();
  if (r === "assistant" || r === "system") return "ATLAS";
  if (r === "user") return "TU";
  return (r || "msg").toUpperCase();
}

function trustModeFromText(text) {
  const t = String(text || "");
  if (/Affidabilità\s·\sASK|Atlas\.\sASK\b/.test(t)) return "ask";
  if (/Affidabilità\s·\sAUTO|Atlas\.\sAUTO\b/.test(t)) return "auto";
  return "";
}

/** Status / onboarding / command acks → chat panel (and toast), never TTS. */
function postChatUpdate(text, kind = "ok", meta = null) {
  const line = presentChatText(text, "system").trim();
  if (!line) return;
  const toast = line.length > 180 ? `${line.slice(0, 176).replace(/\s+\S*$/, "")}…` : line;
  showToast(toast, kind);
  const msgs = $("messageList");
  if (!msgs) return;
  const d = document.createElement("div");
  d.className = "bubble system";
  const trust = meta?.trust || trustModeFromText(line);
  if (trust === "auto" || trust === "ask") d.dataset.trust = trust;
  d.textContent = line;
  const trustLine = meta?.trustLine && !line.includes(meta.trustLine) ? String(meta.trustLine) : "";
  if (trustLine) {
    const span = document.createElement("span");
    span.className = "atlas-trust";
    span.textContent = trustLine;
    d.appendChild(span);
  }
  msgs.appendChild(d);
  msgs.scrollTop = msgs.scrollHeight;
}

function playHoloTick() {
  // Subtle feedback click (no asset files) — original improvement
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!state._audioCtx) state._audioCtx = new Ctx();
    const ctx = state._audioCtx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.025;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
    o.stop(ctx.currentTime + 0.09);
  } catch {
    /* ignore */
  }
}

function saveLastView(mod) {
  try {
    localStorage.setItem(
      VIEW_MEMORY_KEY,
      JSON.stringify({
        module: mod || state.module,
        focusedTopId: state.focusedTopId,
        chatModel: state.chatModel,
        at: Date.now(),
      }),
    );
  } catch {
    /* ignore */
  }
  rememberOpenModule(mod || state.module);
}

function readLastView() {
  try {
    return JSON.parse(localStorage.getItem(VIEW_MEMORY_KEY) || "null");
  } catch {
    return null;
  }
}

function applyAccentTheme(name) {
  const root = document.documentElement;
  const themes = {
    cyan: { accent: "#7ad7ff", gold: "#ffa500" },
    amber: { accent: "#e8b84a", gold: "#ffd27a" },
    mint: { accent: "#3dff9a", gold: "#9effc8" },
  };
  const t = themes[name] || themes.cyan;
  root.style.setProperty("--cyan", t.accent);
  root.style.setProperty("--gold", t.gold);
  try {
    localStorage.setItem(ACCENT_KEY, name);
  } catch {
    /* ignore */
  }
}

function maybeVoiceOnboarding() {
  try {
    if (localStorage.getItem(ONBOARD_KEY)) return;
    localStorage.setItem(ONBOARD_KEY, "1");
  } catch {
    return;
  }
  document.body.dataset.voiceOnboard = "shown";
  const lines = [
    "Atlas. Benvenuto nella plancia. Di’ MAPPA, PIPELINE, MEMORY o CHAT.",
    "Atlas. Di’ CHAT per aprire la chat. Usa la rotella o i tasti più e meno per lo zoom mappa.",
    "Atlas. Di’ AGGIORNA per i dati freschi. Tocca MIC per parlare; la voce si attiva al primo tocco.",
  ];
  // Chat always. Spoken only if MIC already unlocked and the capture is closed.
  pendingVoiceLines = lines.slice();
  let i = 0;
  const step = () => {
    if (i >= lines.length) return;
    postChatUpdate(lines[i], "ok");
    i += 1;
    setTimeout(step, 900);
  };
  setTimeout(step, 400);
  if (voiceUnlocked && !state.micLive) {
    const queued = pendingVoiceLines.splice(0);
    queued.forEach((line, idx) => {
      setTimeout(() => {
        if (state.micLive) return;
        speak(line);
      }, 400 + idx * 2200);
    });
  } else {
    pendingVoiceLines = [];
    if (!voiceUnlocked) postChatUpdate("Atlas. Tocca MIC per attivare la voce", "ok");
  }
}

function markUserInput() {
  state.lastUserInputAt = Date.now();
}

function tourShouldPause() {
  if (document.visibilityState === "hidden" || state.module !== "map") return true;
  if (state.micLive || moduleSwitchLocked) return true;
  if (Date.now() - state.lastUserInputAt < TOUR_IDLE_MS) return true;
  if (document.querySelector("#sideBody .card.is-open")) return true;
  if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return true;
  return false;
}

/** One tour step: highlight the next top in the panel and pulse its pin (camera stays put). */
function tourStep() {
  if (tourShouldPause()) return false;
  const tops = orderedTops(state.snapshot);
  if (!tops.length) return false;
  const t = tops[state.tourIdx % tops.length];
  state.tourIdx += 1;
  state.tourTopId = t.id;
  document.body.dataset.tourTop = t.id;
  setFocusedTop(t.id);
  emphasizeTopIds([...state.compareIds.filter(Boolean), t.id]);
  return true;
}

function startAutoSystems() {
  if (!startAutoSystems.wired) {
    startAutoSystems.wired = true;
    ["pointerdown", "keydown", "wheel", "touchstart"].forEach((ev) =>
      window.addEventListener(ev, markUserInput, { capture: true, passive: true }),
    );
  }
  if (state.autoRefreshTimer) clearInterval(state.autoRefreshTimer);
  state.autoRefreshTimer = setInterval(() => {
    if (document.visibilityState === "hidden") return;
    refresh({ silent: true }).catch(() => {});
  }, AUTO_REFRESH_MS);

  if (state.autoTourTimer) clearInterval(state.autoTourTimer);
  state.autoTourTimer = setInterval(tourStep, AUTO_TOUR_MS);
  setOrbitEnabled(true);
}

window.__opsDiag = () => ({
  module: state.module,
  focusedTopId: state.focusedTopId,
  tourTopId: state.tourTopId,
  tourIdx: state.tourIdx,
  refreshCount: state.refreshCount,
  lastUpdated: state.lastUpdated ? state.lastUpdated.toISOString() : null,
  autoRefreshMs: AUTO_REFRESH_MS,
  autoTourMs: AUTO_TOUR_MS,
  timers: { refresh: Boolean(state.autoRefreshTimer), tour: Boolean(state.autoTourTimer) },
  mapEngine: state.mapEngine,
  build: BUILD_ID,
  lowGpu: document.documentElement.dataset.lowGpu === "1",
  lastOpenRefresh: document.body.dataset.lastOpenRefresh || null,
  voiceOnboard: document.body.dataset.voiceOnboard || null,
  voiceCall: document.documentElement.dataset.voiceCall || "0",
  voicePhase: document.documentElement.dataset.voicePhase || "idle",
  wakeWord: document.documentElement.dataset.wakeWord || "later",
  wakePhase: document.documentElement.dataset.wakePhase || "off",
  micEngine: document.documentElement.dataset.micEngine || "",
  lastView: readLastView(),
  globe: getGlobeState(),
});

window.__opsVoice = (text) => handleVoiceCommand(text);
window.__opsRun = (action) => runHoloAction(action, { fromVoice: false });

/** Dual control: same actions for voice keywords and holographic touch targets. */
function runHoloAction(action, opts = {}) {
  const fromVoice = Boolean(opts.fromVoice);
  const t0 = state.focusedTopId
    ? findTop(state.focusedTopId)
    : state.snapshot?.tops?.[0];
  const lon = Number.isFinite(t0?.lon) ? t0.lon : 12.5;
  const lat = Number.isFinite(t0?.lat) ? t0.lat : 42;
  const src = fromVoice ? "voce" : "tocco";
  playHoloTick();
  if (fromVoice) {
    silenceVoice();
    const label = document.querySelector(`#holoVoicePlancia [data-holo-action="${action}"] .holo-label`);
    postChatUpdate(`${(label?.textContent || String(action)).trim()} · ${src}`);
  }

  const dispatched = dispatchAtlasHand(action, {
    lon,
    lat,
    cityHeight: CITY_FLY_HEIGHT,
    showModule,
    zoomByFactor,
    zoomToHeight,
    flyToTop,
    showToast,
    syncHoloActive,
    saveLastView,
    openBriefingModal,
    openMemoryLive: () => showModule("memory"),
    openDocument: (rel) => openSandboxDoc(String(rel || "").replace(/^sandbox:\/\//, ""), { postChatUpdate }),
    refreshNews: () => loadAiNewsPins(),
  }, { ...opts, fromVoice });
  if (dispatched) return dispatched;

  switch (action) {
    case "refresh":
      return refresh().then(() => showToast(`AGGIORNA · ${src}`));
    case "filtro-score":
      setToolsOpen(true);
      state.mapChipFilters.minScore = state.mapChipFilters.minScore === 0.75 ? null : 0.75;
      renderMapFilterChips(state.snapshot?.tops || []);
      applyMapFilters();
      showToast(`FILTRO SCORE · ${src}`);
      return Promise.resolve();
    case "filtro-reset":
      state.mapChipFilters = { region: null, source: null, minScore: null };
      state.coverageScrubActive = false;
      renderMapFilterChips(state.snapshot?.tops || []);
      applyMapFilters();
      showToast(`FILTRI OFF · ${src}`);
      return Promise.resolve();
    case "coverage-next": {
      setToolsOpen(true);
      const range = $("coverageScrubRange");
      const wrap = $("coverageScrub");
      if (wrap) wrap.hidden = false;
      if (range) {
        const max = Number(range.max) || 0;
        range.value = String((Number(range.value) + 1) % (max + 1));
        range.dispatchEvent(new Event("input", { bubbles: true }));
      }
      showToast(`COVERAGE · ${src}`);
      return Promise.resolve();
    }
    case "confronta":
      if (t0) pinCompare(t0);
      showToast(`CONFRONTA · ${src}`);
      return Promise.resolve();
    case "fly":
      if (t0) flyToTopCard(t0);
      return Promise.resolve();
    case "focus-top": {
      const id = state.focusedTopId || t0?.id;
      if (id) setFocusedTop(id);
      if (t0) flyToTopCard(t0);
      showToast(`FOCUS TOP · ${src}`);
      return Promise.resolve();
    }
    case "inspect":
      return showModule("pipeline").then(() => {
        syncHoloActive("pipeline");
        showToast(`INSPECT · ${src}`);
      });
    case "strumenti": {
      const on = setToolsOpen();
      showToast(`STRUMENTI ${on ? "ON" : "OFF"} · ${src}`);
      return Promise.resolve();
    }
    case "controlli":
    case "funzionamento": {
      toggleFunctionBoardPanel();
      showToast(`CONTROLLI PLANCIA · ${src}`);
      return Promise.resolve();
    }
    case "cockpit": {
      toggleCockpitPanel();
      showToast(`COCKPIT · ${src}`);
      return Promise.resolve();
    }
    case "memory-graph":
    case "grafo": {
      return showModule("memory").then(() => {
        syncHoloActive("memory");
        showToast(`MEMORY · ${src}`);
      });
    }
    case "status":
    case "health":
    case "agentq-status":
      return api("/api/ai/agentq/state", {
        method: "POST",
        body: JSON.stringify({
          question: "stato della plancia",
          module: state.module,
          via: "resident",
        }),
      })
        .then((data) => {
          if (data?.reply) {
            postChatUpdate(data.reply, "ok", {
              trust: data.trust?.mode || "auto",
              trustLine: data.trustLine || "",
            });
          }
        })
        .catch((err) => {
          postChatUpdate(`Atlas. Stato non letto: ${err?.message || "errore"}`, "warn");
        });
    case "problems":
      return showProblems({ postChatUpdate, runHoloAction, resolve: false }).catch((err) => {
        postChatUpdate(`Atlas. Problemi non letti: ${err?.message || "errore"}`, "warn");
      });
    case "tema-cyan":
      applyAccentTheme("cyan");
      showToast(`TEMA CYAN · ${src}`);
      return Promise.resolve();
    case "tema-amber":
      applyAccentTheme("amber");
      showToast(`TEMA AMBRA · ${src}`);
      return Promise.resolve();
    case "tema-mint":
      applyAccentTheme("mint");
      showToast(`TEMA MINT · ${src}`);
      return Promise.resolve();
    default:
      return Promise.resolve();
  }
}

function handleVoiceCommand(text) {
  const lower = String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .trim();
  // Zoom, modules, documents, and briefing go through the Atlas hand plan
  // (voiceDefers → __opsAgentqHandle → runHoloAction), not this shortcut table.
  if (voiceDefersToAtlasHands(text)) return false;
  const rules = [
    [/filtro\s*(score|punti)|score\s*75|filtro alto/, "filtro-score"],
    [/filtri?\s*(off|reset|tutti)|reset filtri/, "filtro-reset"],
    [/coverage|copertura|scrub/, "coverage-next"],
    [/confronta|compare/, "confronta"],
    [/fly|vola|vai l[iì]/, "fly"],
    [/funzionamento|controlli\s*plancia|pagina\s*controllo|\bcontrolli\b/, "controlli"],
    [/cockpit|quadro\s*operatore/, "cockpit"],
    [/grafo\s*(memoria|note)|memory\s*graph/, "memory-graph"],
    [/strumenti|tools/, "strumenti"],
    [/tema\s*(cyan|ciano)/, "tema-cyan"],
    [/tema\s*(ambra|amber)/, "tema-amber"],
    [/tema\s*(mint|verde)/, "tema-mint"],
  ];
  for (const [re, action] of rules) {
    if (re.test(lower)) {
      runHoloAction(action, { fromVoice: true });
      return true;
    }
  }
  return false;
}

function setToolsOpen(open) {
  const on = open == null ? !document.body.classList.contains("tools-open") : Boolean(open);
  document.body.classList.toggle("tools-open", on);
  $("toolsToggle")?.classList.toggle("active", on);
  return on;
}

function setTopMenuOpen(open) {
  const wrap = document.querySelector(".top-right");
  const btn = $("signalBars");
  if (!wrap) return;
  const on = open == null ? !wrap.classList.contains("menu-open") : Boolean(open);
  wrap.classList.toggle("menu-open", on);
  btn?.setAttribute("aria-expanded", on ? "true" : "false");
}

function wireTopMenu() {
  const btn = $("signalBars");
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = "1";
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    setTopMenuOpen();
  });
  $("topMenu")?.addEventListener(
    "click",
    (e) => {
      if (e.target.closest("button")) setTopMenuOpen(false);
    },
    true,
  );
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".top-right")) setTopMenuOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") setTopMenuOpen(false);
  });
  $("toolsToggle")?.addEventListener("click", () => {
    const on = setToolsOpen();
    showToast(on ? "Strumenti mappa attivi" : "Strumenti mappa nascosti");
  });
}

/** Light-point labels stay hidden like the reference photo; reveal them briefly so touch users can learn them. */
function flashHoloLabels(ms = 6000) {
  document.body.classList.add("holo-labels-on");
  clearTimeout(flashHoloLabels._t);
  flashHoloLabels._t = setTimeout(() => document.body.classList.remove("holo-labels-on"), ms);
}

const TOP_MARKS = [
  '<svg viewBox="0 0 16 16"><path class="fill" d="M8 .8l1.5 5.2 5.2-1.6-3.6 4 3.6 4-5.2-1.6L8 15.2l-1.5-5.2-5.2 1.6 3.6-4-3.6-4 5.2 1.6z"/></svg>',
  '<svg viewBox="0 0 16 16"><path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2"/></svg>',
  '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.6"/><path d="M8 1v2.4M8 12.6V15M1 8h2.4M12.6 8H15M3 3l1.7 1.7M11.3 11.3L13 13M13 3l-1.7 1.7M4.7 11.3L3 13"/></svg>',
  '<svg viewBox="0 0 16 16"><path class="fill" d="M8 1l1.9 4.6 4.9.4-3.7 3.2 1.1 4.8L8 11.5 3.8 14l1.1-4.8L1.2 6l4.9-.4z"/></svg>',
  '<svg viewBox="0 0 16 16"><circle cx="8" cy="6.5" r="4.6"/><path d="M4.6 13.8h6.8"/></svg>',
];

function topMarkFor(id) {
  let h = 0;
  for (const ch of String(id || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TOP_MARKS[h % TOP_MARKS.length];
}

function wireHoloPlancia() {
  const host = $("holoVoicePlancia");
  if (!host || host.dataset.wired) return;
  host.dataset.wired = "1";
  host.addEventListener("click", (e) => {
    const node = e.target.closest("[data-holo-action]");
    if (!node || !host.contains(node)) return;
    e.preventDefault();
    e.stopPropagation();
    runHoloAction(node.getAttribute("data-holo-action"), { fromVoice: false });
  });
}

function sideForModule(mod, snap) {
  const body = $("sideBody");
  const title = $("sideTitle");
  const tools = $("sideTools");
  body.innerHTML = "";
  if (tools) tools.innerHTML = "";
  if (mod === "map") {
    title.textContent = "Daily tops · correct";
    const notes = readCompanyNotes();
    const tops = orderedTops(snap);
    tops.forEach((t) => {
      const el = document.createElement("div");
      el.className = "card top-row-card";
      el.draggable = true;
      el.dataset.topId = t.id;
      el.dataset.filter = `${t.title || ""} ${t.region || ""} ${t.source || ""}`.toLowerCase();
      if (state.focusedTopId === t.id) el.classList.add("is-focused");
      el.innerHTML = `
        <div class="row top-holo-row">
          <span class="top-mark" aria-hidden="true">${topMarkFor(t.id)}</span>
          <strong class="top-fly" title="${escapeHtml(t.title)}">${escapeHtml(t.title)}</strong>
          <span class="top-pct">${Math.round((t.score || 0) * 100)}%</span>
        </div>
        <div class="top-holo-detail">${escapeHtml(t.region || "")} · ${escapeHtml(t.source || "")}</div>
        <div class="top-holo-tools">
          <input type="text" placeholder="Nota correzione" data-note="${t.id}" />
          <textarea class="note-local" rows="1" placeholder="Nota locale" data-local-note="${t.id}"></textarea>
          <div class="actions">
            <button class="pill-btn" data-fly="${t.id}">Fly</button>
            <button class="pill-btn" data-compare="${t.id}">Confronta</button>
            <button class="pill-btn" data-correct="1" data-id="${t.id}">✓</button>
            <button class="pill-btn" data-correct="0" data-id="${t.id}">✗</button>
          </div>
        </div>`;
      el.querySelector(".top-fly")?.addEventListener("click", (e) => {
        e.stopPropagation();
        el.classList.add("is-open");
        flyToTopCard(t);
      });
      el.addEventListener("click", (e) => {
        if (e.target.closest("button, input, textarea")) return;
        const wasOpen = el.classList.contains("is-open");
        body.querySelectorAll(".card.is-open").forEach((c) => c.classList.remove("is-open"));
        el.classList.toggle("is-open", !wasOpen);
        setFocusedTop(t.id);
      });
      el.addEventListener("dragstart", (e) => {
        state.dragTopId = t.id;
        try {
          e.dataTransfer.setData("text/top-id", t.id);
          e.dataTransfer.effectAllowed = "move";
        } catch {
          /* ignore */
        }
        el.classList.add("dragging");
      });
      el.addEventListener("dragend", () => {
        el.classList.remove("dragging");
        state.dragTopId = null;
      });
      el.addEventListener("dragover", (e) => {
        e.preventDefault();
        el.classList.add("drag-over");
      });
      el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        el.classList.remove("drag-over");
        let fromId = state.dragTopId;
        try {
          fromId = e.dataTransfer.getData("text/top-id") || fromId;
        } catch {
          /* ignore */
        }
        if (!fromId || fromId === t.id) return;
        const ids = tops.map((x) => x.id);
        const from = ids.indexOf(fromId);
        const to = ids.indexOf(t.id);
        if (from < 0 || to < 0) return;
        ids.splice(to, 0, ids.splice(from, 1)[0]);
        writeTopsOrder(snap.day_key, ids);
        showToast("Ordine tops salvato");
        sideForModule("map", snap);
      });
      const local = el.querySelector(`[data-local-note="${t.id}"]`);
      if (local) {
        local.value = notes[t.id] || "";
        local.addEventListener("change", () => {
          writeCompanyNote(t.id, local.value);
          showToast("Nota locale salvata");
        });
      }
      body.appendChild(el);
    });
    body.querySelectorAll("[data-fly]").forEach((btn) => {
      btn.addEventListener("click", () => flyToTopCard(findTop(btn.getAttribute("data-fly"))));
    });
    body.querySelectorAll("[data-compare]").forEach((btn) => {
      btn.addEventListener("click", () => pinCompare(findTop(btn.getAttribute("data-compare"))));
    });
    body.querySelectorAll("[data-correct]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const verdict = btn.getAttribute("data-correct") === "1" ? "correct" : "incorrect";
        await submitCorrection(id, verdict);
      });
    });
    renderMapFilterChips(tops);
    setupCoverageScrub(snap.coverage);
    updateCompareStrip();

    // Secondary tools stay folded so the panel reads like the reference photo
    const extras = document.createElement("details");
    extras.className = "side-extras";
    if (state.sideExtrasOpen) extras.open = true;
    extras.addEventListener("toggle", () => {
      state.sideExtrasOpen = extras.open;
    });
    extras.innerHTML = `<summary>Strumenti · zoom · csv</summary>`;
    const filter = document.createElement("input");
    filter.className = "side-filter";
    filter.type = "search";
    filter.placeholder = "Filtra tops…";
    filter.value = state.sideFilter || "";
    const applySideFilter = () => {
      state.sideFilter = filter.value;
      const q = filter.value.trim().toLowerCase();
      body.querySelectorAll(".card[data-top-id]").forEach((card) => {
        const hay = card.getAttribute("data-filter") || "";
        card.hidden = q ? !hay.includes(q) : false;
      });
    };
    filter.addEventListener("input", applySideFilter);
    extras.appendChild(filter);
    const zoomHelp = document.createElement("div");
    zoomHelp.className = "card";
    zoomHelp.innerHTML = `<div class="muted">Zoom: tasti <span class="mono">+</span>/<span class="mono">−</span> (o <span class="mono">=</span>/<span class="mono">_</span>), rotella, pinch · voce «zoom» / «zoom in» · salti LOD · Orbit / Nord / Fly.</div>
      <div class="actions" id="lodJumps"></div>`;
    extras.appendChild(zoomHelp);
    const jumps = [
      ["Continente", 12_000_000],
      ["Paese", 1_500_000],
      ["Città", CITY_FLY_HEIGHT],
      ["Strade", 8_000],
      ["Dettaglio", 600],
    ];
    const box = zoomHelp.querySelector("#lodJumps");
    jumps.forEach(([label, h]) => {
      const b = document.createElement("button");
      b.className = "pill-btn";
      b.textContent = label;
      b.onclick = () => {
        const t0 = state.focusedTopId ? findTop(state.focusedTopId) : (state.snapshot?.tops || [])[0];
        const lon = Number.isFinite(t0?.lon) ? t0.lon : 12.5;
        const lat = Number.isFinite(t0?.lat) ? t0.lat : 42;
        flyToTop(lon, lat, h);
      };
      box.appendChild(b);
    });
    const exp = document.createElement("button");
    exp.className = "pill-btn";
    exp.textContent = "CSV";
    exp.title = "Export tops CSV";
    exp.onclick = () => exportTopsCsv(snap.tops);
    box.appendChild(exp);
    body.appendChild(extras);
    if (filter.value) applySideFilter();
  } else if (mod === "pipeline") {
    title.textContent = "Pipeline · errors";
    const hint = document.createElement("div");
    hint.className = "card muted";
    hint.textContent = "Clicca un nodo 3D per ispezionare stats/errori qui.";
    body.appendChild(hint);
    (snap.pipeline?.nodes || []).forEach((n) => {
      const el = document.createElement("div");
      el.className = "card";
      el.innerHTML = `<div class="row"><strong>${escapeHtml(n.label || n.id)}</strong><span class="mono">${escapeHtml(n.health || "—")}</span></div>
        <div class="muted">${escapeHtml(n.kind || "")}</div>`;
      el.addEventListener("click", () => inspectPipelineNode(n));
      body.appendChild(el);
    });
    const errs = snap.errors || [];
    if (errs.length) {
      const h = document.createElement("h2");
      h.textContent = "Error registry";
      body.appendChild(h);
      errs.forEach((e) => {
        const el = document.createElement("div");
        el.className = "err muted";
        el.innerHTML = `<div class="mono">${escapeHtml(e.code || e.id)}</div>${escapeHtml(e.message || "")}`;
        body.appendChild(el);
      });
    }
  } else if (mod === "memory") {
    title.textContent = "MEMORY · neuroni";
    const hint = document.createElement("div");
    hint.className = "card muted";
    hint.textContent = "Pagina fissa 3D: drag ruota, scroll zoom, impulsi live sulle sinapsi. Click su un neurone qui o nello spazio.";
    body.appendChild(hint);
    const kinds = [
      ["heritage", "Heritage / Agent Q"],
      ["skill", "Skill"],
      ["prompt", "Prompt"],
      ["function", "Function"],
      ["concept", "Concept / altro"],
    ];
    kinds.forEach(([k, label]) => {
      const el = document.createElement("div");
      el.className = "card";
      el.innerHTML = `<div class="row"><strong>${escapeHtml(label)}</strong><span class="mono mem-kind mem-kind--${escapeHtml(k)}">${escapeHtml(k)}</span></div>`;
      body.appendChild(el);
    });
  } else if (mod === "chat") {
    title.textContent = "Coverage transparency";
    (snap.coverage || []).forEach((c) => {
      const el = document.createElement("div");
      el.className = "card";
      el.innerHTML = `<div class="cov"><span>${escapeHtml(c.domain || c.id)}</span><span class="mono">${Math.round((c.pct || 0) * 100)}%</span></div>
        <div class="bar"><span style="width:${Math.round((c.pct || 0) * 100)}%"></span></div>
        <div class="muted">${escapeHtml(c.note || "")}</div>`;
      body.appendChild(el);
    });
    const thr = snap.verification || {};
    const box = document.createElement("div");
    box.className = "card";
    box.innerHTML = `<strong>Verification threshold</strong>
      <div class="muted">Raised floor: <span class="mono">${Math.round((thr.threshold ?? 0.72) * 100)}%</span> · mode ${escapeHtml(thr.mode || "tiered")}</div>`;
    body.appendChild(box);
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

let moduleEpoch = 0;
let moduleSwitchLocked = false;
let moduleSwitchPromise = null;

function clearViewportHost() {
  unmountMemoryBrainPage();
  disposeScene();
  const gl = $("glCanvas");
  // Lose Cesium GL before wiping DOM so the next Three.js renderer can allocate cleanly.
  forceLoseLeftoverWebgl(gl);
  destroyMapGlobe();
  forceLoseLeftoverWebgl(gl);
  if (gl) {
    gl.innerHTML = "";
    gl.classList.remove("cesium-ops", "is-suppressed");
    gl.style.pointerEvents = "none";
  }
}

function syncModuleHash(mod) {
  const next = `#/${mod}`;
  if (location.hash !== next) {
    history.replaceState(null, "", next);
  }
}

function moduleFromHash() {
  const raw = (location.hash || "").replace(/^#\/?/, "").trim().toLowerCase();
  return MODULES.includes(raw) ? raw : null;
}

function stillCurrent(epoch, mod) {
  return epoch === moduleEpoch && state.module === mod;
}

function setExclusivePanels(mod) {
  const chatPanel = $("chatPanel");
  const gl = $("glCanvas");
  const mapChrome = $("mapChrome");
  const hud = document.querySelector(".overlay-hud");
  const pickCard = $("mapPickCard");
  const isChat = mod === "chat";
  const isMap = mod === "map";

  document.body.dataset.module = mod;
  if (mapChrome) mapChrome.hidden = !isMap;
  if (hud) hud.hidden = isChat || mod === "memory";
  if (pickCard && !isMap) pickCard.hidden = true;
  const compare = $("compareStrip");
  if (compare && !isMap) compare.hidden = true;
  else if (isMap) updateCompareStrip();
  const credit = $("imageryCredit");
  if (credit) credit.hidden = !isMap || mod === "memory";
  if (mod !== "memory") {
    unmountMemoryBrainPage();
  }
  if (!isMap) {
    state.pickHandler = null;
    state.memoryMeshes = new Map();
  }

  if (isChat) {
    if (gl) {
      gl.hidden = true;
      gl.classList.add("is-suppressed");
      gl.style.pointerEvents = "none";
    }
    if (chatPanel) {
      chatPanel.hidden = false;
      chatPanel.setAttribute("aria-hidden", "false");
    }
  } else {
    if (chatPanel) {
      chatPanel.hidden = true;
      chatPanel.setAttribute("aria-hidden", "true");
    }
    if (gl) {
      gl.hidden = false;
      gl.classList.remove("is-suppressed");
      // Canvas stays interactive for Three.js (pipeline/memory); holo nodes sit above via z-index.
      gl.style.pointerEvents = "";
    }
  }
}

/**
 * Switch module. First click wins while a switch is in flight — overlapping
 * second clicks are ignored so async mounts cannot remount a stale panel.
 * Pass { force: true } for refresh / boot.
 */
async function showModule(mod, opts = {}) {
  if (!MODULES.includes(mod)) mod = "map";
  const force = Boolean(opts.force);

  // Exclusive lock: ignore a second overlapping click while the first switch runs.
  if (moduleSwitchLocked && !force) {
    return moduleSwitchPromise;
  }
  // Globe already live: map actions (orbit / nord / zoom) must not remount it.
  if (!force && mod === "map" && state.module === "map" && state.mapEngine === "cesium" && getViewer()) {
    syncHoloActive(mod);
    saveLastView("map");
    return Promise.resolve();
  }

  const epoch = ++moduleEpoch;
  state.module = mod;
  syncModuleHash(mod);
  document.querySelectorAll("#moduleNav button").forEach((b) => {
    b.classList.toggle("active", b.dataset.module === mod);
  });
  syncHoloActive(mod);

  moduleSwitchLocked = true;
  const run = (async () => {
    try {
      const gl = $("glCanvas");
      const snap = state.snapshot || {};

      // Tear down previous host first so canvases cannot stack / steal clicks.
      clearViewportHost();
      await settleGlAfterTeardown();
      if (!stillCurrent(epoch, mod)) return;
      setExclusivePanels(mod);

      if (mod === "chat") {
        $("moduleLegend").textContent = "Atlas · cronologia · voce";
        sideForModule(mod, snap);
        // Never block opening chat if thread API is slow/rate-limited
        try {
          await loadChat({ introduce: true });
        } catch (err) {
          console.warn("[chat] loadChat", err?.message || err);
          showToast(err?.message || "Cronologia Atlas non disponibile", "warn");
          maybeIntroduceAtlas($("messageList"), [], true);
        }
        if (!stillCurrent(epoch, mod)) return;
        requestAnimationFrame(() => {
          if (!stillCurrent(epoch, mod)) return;
          $("chatInput")?.focus?.();
        });
      } else if (mod === "map") {
        $("moduleLegend").textContent = "Map · loading interactive globe…";
        try {
          await mountMapGlobe(gl, {
            tops: snap.tops,
            onLod: (lod, heightM) => {
              if (state.module !== "map") return;
              const km = heightM > 1000 ? `${(heightM / 1000).toFixed(0)} km` : `${Math.round(heightM)} m`;
              $("moduleLegend").textContent = `GLOBE LIVE · ${lod.label} · alt ${km}`;
              $("coverageMini").textContent = `${lod.detail} · drag rotate · scroll zoom · L${lod.level}/5`;
            },
            onSelect: (sel) => {
              if (state.module !== "map") return;
              const card = $("mapPickCard");
              if (!card) return;
              state.lastMapPick = sel;
              card.hidden = false;
              $("mapPickTitle").textContent = sel.title || "Selection";
              $("mapPickDetail").textContent = sel.detail || `${sel.lat?.toFixed?.(3)}, ${sel.lon?.toFixed?.(3)}`;
              const analyze = $("mapPickAnalyze");
              const compareBtn = $("mapPickCompare");
              const isTop = sel.kind === "top" || sel.top;
              if (analyze) analyze.hidden = !isTop && !sel.title;
              if (compareBtn) compareBtn.hidden = !sel.top;
              if (sel.top?.id) setFocusedTop(sel.top.id);
            },
          });
          if (!stillCurrent(epoch, mod)) return;
          applyMapFilters();
          emphasizeTopIds([...state.compareIds, state.tourTopId].filter(Boolean));
          if (state.news?.length) updateNewsPins(state.news);
          state.mapEngine = "cesium";
        } catch (err) {
          if (!stillCurrent(epoch, mod)) return;
          console.warn("Cesium LOD globe failed, Three.js fallback", err);
          state.mapEngine = "three";
          clearViewportHost();
          setExclusivePanels(mod);
          $("moduleLegend").textContent = "Map · Three.js live fallback · drag / scroll";
          const root = initThree(gl, { autoRotate: true, minDistance: 2.6, maxDistance: 12 });
          await buildMap(root, snap.tops);
          if (!stillCurrent(epoch, mod)) {
            disposeScene();
            return;
          }
        }
      } else if (mod === "pipeline") {
        const nodes = snap.pipeline?.nodes || [];
        const edges = snap.pipeline?.edges || [];
        if (!nodes.length) {
          $("moduleLegend").textContent = "Pipeline · nessun dato · refresh…";
          showToast("Pipeline senza nodi · aggiorno i dati", "warn");
          try {
            const fresh = await api("/api/dashboard/snapshot");
            if (!stillCurrent(epoch, mod)) return;
            state.snapshot = fresh;
            const n2 = fresh?.pipeline?.nodes || [];
            const e2 = fresh?.pipeline?.edges || [];
            if (!n2.length) {
              $("moduleLegend").textContent = "Pipeline · vuota (nessun nodo nello snapshot)";
              showToast("Pipeline ancora vuota dopo refresh", "warn");
              sideForModule(mod, fresh);
              return;
            }
            $("moduleLegend").textContent = "Pipeline · 3D graph · zoomable";
            const root = initThree(gl, { autoRotate: false, minDistance: 3, maxDistance: 22 });
            buildPipeline(root, n2, e2);
          } catch (err) {
            console.warn("[pipeline] snapshot refresh", err?.message || err);
            $("moduleLegend").textContent = "Pipeline · errore caricamento dati";
            showToast(err?.message || "Pipeline: refresh fallito", "warn");
          }
          if (!stillCurrent(epoch, mod)) {
            disposeScene();
            return;
          }
        } else {
          $("moduleLegend").textContent = "Pipeline · 3D graph · zoomable";
          const root = initThree(gl, { autoRotate: false, minDistance: 3, maxDistance: 22 });
          buildPipeline(root, nodes, edges);
          if (!stillCurrent(epoch, mod)) {
            disposeScene();
            return;
          }
        }
      } else if (mod === "memory") {
        $("moduleLegend").textContent = "MEMORY · cervello neurale 3D · drag / scroll";
        // Permanent Memory page: own Three.js brain (replaces old 5D concept hologram).
        await mountMemoryBrainPage(gl);
        if (!stillCurrent(epoch, mod)) {
          unmountMemoryBrainPage();
          return;
        }
      }

      if (!stillCurrent(epoch, mod)) return;
      // Re-assert exclusive panels after async mounts (Cesium can leave DOM).
      setExclusivePanels(mod);
      sideForModule(mod, snap);
      if (mod !== "map") renderCoverageMini(snap.coverage);
      if (snap.health) setHealth(snap.health);
      saveLastView(mod);
    } finally {
      if (epoch === moduleEpoch) {
        moduleSwitchLocked = false;
        moduleSwitchPromise = null;
      }
    }
  })();

  moduleSwitchPromise = run;
  return run;
}

let refreshInFlight = null;

/**
 * Pull a fresh snapshot. The live globe is updated in place (pins, arcs, side panel)
 * instead of being torn down, so auto-refresh never blanks or re-zooms the map.
 * Pass { remount: true } to force a full module rebuild.
 */
function refresh({ silent = false, remount = false } = {}) {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    await refreshSecretsStatus();
    const snap = await api("/api/dashboard/snapshot");
    state.snapshot = snap;
    state.lastUpdated = new Date();
    state.refreshCount += 1;
    updateStatsStrip(snap);
    if (snap.health) setHealth(snap.health);
    const mapLive = state.module === "map" && state.mapEngine === "cesium" && getViewer() && !moduleSwitchLocked;
    if (!remount && mapLive) {
      await updateMapGlobeTops(snap.tops);
      if (state.news?.length) updateNewsPins(state.news);
      applyMapFilters();
      emphasizeTopIds([...state.compareIds, state.tourTopId].filter(Boolean));
      sideForModule("map", snap);
    } else {
      await showModule(state.module, { force: true });
    }
    document.body.dataset.refreshedAt = String(state.lastUpdated.getTime());
    if (!silent) {
      /* toast handled by callers when needed */
    }
  })().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

function readStoredChatModel() {
  try {
    return localStorage.getItem(CHAT_MODEL_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function writeStoredChatModel(modelId) {
  try {
    localStorage.setItem(CHAT_MODEL_STORAGE_KEY, modelId);
  } catch {
    /* ignore quota / private mode */
  }
}

function getSelectedChatModel() {
  const sel = $("chatModelSelect");
  return (sel?.value || state.chatModel || "").trim();
}

async function ensureChatModelSelect() {
  const sel = $("chatModelSelect");
  if (!sel) return;
  if (!state.chatModelCatalog) {
    state.chatModelCatalog = await api("/api/chat/models");
  }
  const catalog = state.chatModelCatalog;
  const preferred = readStoredChatModel() || catalog.default;
  sel.innerHTML = "";
  for (const group of catalog.groups || []) {
    const og = document.createElement("optgroup");
    og.label = group.label;
    for (const m of group.models || []) {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.label;
      og.appendChild(opt);
    }
    sel.appendChild(og);
  }
  const allowed = new Set(
    (catalog.groups || []).flatMap((g) => (g.models || []).map((m) => m.id)),
  );
  const pick = allowed.has(preferred) ? preferred : catalog.default;
  sel.value = pick;
  state.chatModel = pick;
  writeStoredChatModel(pick);
  updateModelHint();
  if (!sel.dataset.wired) {
    sel.dataset.wired = "1";
    sel.addEventListener("change", () => {
      state.chatModel = sel.value;
      writeStoredChatModel(sel.value);
      updateModelHint();
    });
  }
}

/** Nota fissa concordata (Atlas) — reiniettata a ogni ingresso in chat. */
const PINNED_BRIEFING_LINES = [
  "CONCORDATO · Atlas in plancia (nota fissa ad ogni apertura chat)",
  "1) Framework: Atlas integrato in plancia. Nome, chat e voce: sempre Atlas.",
  "2) Ricerca su richiesta: modulo ricerca su file locali, database e API, oltre al browser Playwright — solo se l’utente lo chiede.",
  "3) Chiavi API: già presenti in plancia; riutilizzarle, mai hardcodarle.",
  "4) Client: uso da tablet ora (PC tra settimane/mesi); UI ok su browser tablet.",
  "5) Sandbox: ricerca locale in sandbox con permessi limitati.",
  "6) Scope verificato: nessun riferimento istituzionale/intelligence nella repo ufficiale; paper ~95% successi web con Llama-3 70B.",
];

function renderPinnedBriefing(msgs) {
  if (!msgs) return;
  const pin = document.createElement("div");
  pin.className = "bubble system pinned-briefing";
  pin.dataset.pinned = "concordato-atlas";
  pin.setAttribute("role", "note");
  pin.textContent = PINNED_BRIEFING_LINES.join("\n");
  msgs.appendChild(pin);
}

let atlasGreetedThisPage = false;
const ATLAS_GREET_KEY = "atlas_chat_greet_v1";
const ATLAS_GREETING =
  "Atlas. Sono l’assistente della plancia. Chiedimi un’analisi, la mappa, la pipeline o la memory.";

function atlasGreetingRemembered() {
  if (atlasGreetedThisPage) return true;
  try {
    return sessionStorage.getItem(ATLAS_GREET_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberAtlasGreeting() {
  atlasGreetedThisPage = true;
  try {
    sessionStorage.setItem(ATLAS_GREET_KEY, "1");
  } catch {
    /* private mode */
  }
}

function messagesIncludeAtlasGreeting(messages) {
  return (messages || []).some((m) => String(m.content || "").includes(ATLAS_GREETING));
}

/** One Atlas intro per browser session, only when chat opens and the line is missing. */
function maybeIntroduceAtlas(msgs, messages, introduce) {
  if (!introduce || !msgs) return;
  if (messagesIncludeAtlasGreeting(messages) || msgs.querySelector("[data-atlas-greet]")) {
    rememberAtlasGreeting();
    return;
  }
  if (atlasGreetingRemembered()) return;
  rememberAtlasGreeting();
  const line = document.createElement("div");
  line.className = "bubble system";
  line.dataset.atlasGreet = "1";
  line.setAttribute("role", "status");
  line.textContent = ATLAS_GREETING;
  msgs.appendChild(line);
}

async function loadChat({ introduce = false } = {}) {
  await ensureChatModelSelect();
  renderChatSuggestions();
  const { threads } = await api("/api/chat/threads");
  const list = $("threadList");
  list.innerHTML = "";
  const neu = document.createElement("button");
  neu.className = "pill-btn primary";
  neu.textContent = "New";
  neu.onclick = async () => {
    const t = await api("/api/chat/threads", { method: "POST", body: JSON.stringify({ title: "Atlas" }) });
    state.threadId = t.id;
    showToast("Nuova sessione Atlas");
    await loadChat();
  };
  list.appendChild(neu);
  (threads || []).forEach((t) => {
    const b = document.createElement("button");
    b.className = "pill-btn" + (t.id === state.threadId ? " primary" : "");
    b.textContent = atlasThreadLabel(t.title) || t.id;
    b.onclick = async () => {
      state.threadId = t.id;
      await loadChat();
    };
    list.appendChild(b);
  });
  // Resume last thread for the session only; do not surprise-jump to an ancient first message.
  if (!state.threadId && threads?.[0]) state.threadId = threads[0].id;
  const msgs = $("messageList");
  msgs.innerHTML = "";
  // Concordato: compact note once — not a sticky wall that makes old history look "stuck" on screen.
  renderPinnedBriefing(msgs);
  if (!state.threadId) {
    maybeIntroduceAtlas(msgs, [], introduce);
    msgs.scrollTop = msgs.scrollHeight;
    return;
  }
  const { messages } = await api(`/api/chat/threads/${state.threadId}`);
  const chatMessages = Array.isArray(messages) ? messages : [];
  // Tablet UX: show only the recent tail so an old first prompt (e.g. «Riassumi i top…»)
  // does not dominate the viewport when re-entering chat from the plancia.
  const RECENT_TAIL = 12;
  const start = Math.max(0, chatMessages.length - RECENT_TAIL);
  if (start > 0) {
    const more = document.createElement("div");
    more.className = "bubble system";
    more.dataset.historyTrim = "1";
    more.textContent = `… ${start} messaggi precedenti nascosti · apri Export o New per gestione completa`;
    msgs.appendChild(more);
  }
  chatMessages.slice(start).forEach((m) => {
    const d = document.createElement("div");
    const role = m.role === "assistant" || m.role === "system" || m.role === "user" ? m.role : "user";
    d.className = `bubble ${role}`;
    d.dataset.role = role;
    const attach = m.attachment_name
      ? `\n[allegato: ${m.attachment_name}]`
      : "";
    d.textContent = `${presentChatText(m.content || "", role)}${attach}`;
    const trust = trustModeFromText(d.textContent);
    if (trust) d.dataset.trust = trust;
    if (m.speech_input) d.dataset.speech = "1";
    msgs.appendChild(d);
  });
  maybeIntroduceAtlas(msgs, chatMessages, introduce);
  // Always land on the latest messages — scrollTop=0 was resurfacing the oldest user line.
  requestAnimationFrame(() => {
    msgs.scrollTop = msgs.scrollHeight;
  });
}

function recentConversation(limit = 8) {
  const nodes = [...($("messageList")?.querySelectorAll(".bubble") || [])];
  return nodes
    .filter((node) => !node.classList.contains("system"))
    .slice(-limit)
    .map((node) => ({
      role: node.dataset?.role === "assistant" || node.classList.contains("assistant") ? "assistant" : "user",
      content: String(node.textContent || "").trim().slice(0, 400),
    }))
    .filter((row) => row.content);
}

async function sendChat(text, { voice = false } = {}) {
  if (!text.trim()) return;
  if (!state.threadId) {
    const t = await api("/api/chat/threads", { method: "POST", body: JSON.stringify({ title: "Atlas" }) });
    state.threadId = t.id;
  }
  await ensureChatModelSelect();
  const model = getSelectedChatModel();
  try {
    // Voice and typed turns share this path: the thread is persisted (speech_input
    // on MIC) and the paid /api/ai/turn injects atlasRecall before the model call.
    const attach = state.pendingAttachment;
    try {
      await api(`/api/chat/threads/${state.threadId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          content: text,
          model,
          speech_input: Boolean(voice),
          skipAssistant: Boolean(state.aiPaid),
          attachment_name: attach?.name || "",
          attachment_mime: attach?.mime || "",
          attachment_text: attach?.text || "",
        }),
      });
      state.pendingAttachment = null;
      const nameEl = $("chatAttachName");
      if (nameEl) nameEl.textContent = "";
    } catch (persistErr) {
      console.warn("[chat] persist failed", persistErr?.message || persistErr);
    }

    // Paid AI agent path: busy ✓ while working, actions[] applied, reply in chat
    if (state.aiPaid) {
      const uiState = {
        module: state.module,
        focusedTopId: state.focusedTopId,
        voice: Boolean(voice),
        conversation: recentConversation(),
      };
      let result = await runPaidAiTurn({
        message: text,
        uiState,
      });
      if (result?.needSpendConfirm) {
        let ok = false;
        try {
          ok = window.confirm(`${result.reply}\n\nAutorizzare il turno oltre la fascia soft?`);
        } catch {
          ok = false;
        }
        if (ok) {
          result = await runPaidAiTurn({
            message: text,
            uiState,
            confirmSpend: true,
          });
        }
      }
      $("chatInput").value = "";
      const trustLine =
        result.trustLine && !String(result.reply || "").includes(result.trustLine)
          ? `\n${result.trustLine}`
          : "";
      const reply = `${result.reply || "Atlas. Nessuna risposta."}${trustLine}`;
      // Store assistant reply on the same thread
      try {
        await api(`/api/chat/threads/${state.threadId}/messages`, {
          method: "POST",
          body: JSON.stringify({
            content: reply,
            role: "assistant",
            model: result.model || model,
            skipAssistant: true,
          }),
        });
      } catch {
        /* optional */
      }
      await loadChat().catch(() => {
        postChatUpdate(reply, result.blocked ? "warn" : "ok");
      });
      if (result.tier) {
        const budget = result.budget;
        const rem =
          budget && Number.isFinite(budget.remainingEur)
            ? ` · €${budget.remainingEur.toFixed(2)} left`
            : "";
        showToast(`AI ${result.tier}${rem}`);
      }
      if (voice) {
        // Do not "unlock" after async — Safari needs the prior MIC gesture. speak() warns if gated.
        speak(reply);
        if (voiceUnlocked) postChatUpdate("Risposta vocale ricevuta · in lettura", "ok");
      }
      return;
    }
    $("chatInput").value = "";
    await loadChat();
    if (voice) {
      const lastAssistant = [...($("messageList")?.querySelectorAll(".bubble") || [])]
        .reverse()
        .find((n) => n.classList.contains("assistant") || n.dataset?.role === "assistant");
      const replyText = (lastAssistant?.textContent || "").trim();
      if (replyText) speak(replyText);
      if (voiceUnlocked) postChatUpdate("Risposta vocale ricevuta · in lettura", "ok");
    }
  } catch (err) {
    showToast(err.message || "Atlas non ha risposto", "bad");
  }
}

function micErrorMessage(code) {
  switch (String(code || "")) {
    case "not-allowed":
    case "service-not-allowed":
      return "Permesso microfono negato. Su Safari: Impostazioni → Siti web → Microfono → Consenti per questo sito, poi ritocca MIC.";
    case "audio-capture":
      return "Microfono non disponibile o già in uso da un’altra app.";
    case "network":
      return "Riconoscimento vocale: errore di rete. Controlla la connessione.";
    case "no-speech":
      return "Nessuna voce nel riconoscimento web. Ritocca MIC: su iPad usiamo registrazione + Whisper.";
    case "aborted":
      return "";
    case "language-not-supported":
      return "Lingua it-IT non supportata dal riconoscimento. Prova di nuovo.";
    case "secure-context":
      return "Il microfono richiede HTTPS (contesto sicuro).";
    case "permission-denied":
    case "NotAllowedError":
      return "Accesso al microfono rifiutato. Consenti il permesso nella finestra Safari e ritocca MIC.";
    case "NotFoundError":
      return "Nessun microfono trovato su questo dispositivo.";
    case "NotReadableError":
      return "Microfono occupato. Chiudi altre app che lo usano e riprova.";
    case "gesture":
      return "Tocca MIC per attivare il microfono.";
    default:
      return code ? `Microfono: ${code}` : "Microfono non disponibile.";
  }
}

/**
 * Call only from the MIC pointerdown/click stack, before any await.
 * getUserMedia is refused outside a secure context.
 */
function beginUserMediaCapture() {
  if (!window.isSecureContext) {
    return Promise.resolve({ ok: false, code: "secure-context" });
  }
  const gum = navigator.mediaDevices?.getUserMedia;
  if (typeof gum !== "function") {
    return Promise.resolve({ ok: false, code: "not-allowed" });
  }
  ensureAudioSessionPlayAndRecord();
  try {
    const apple = isIpadLike() || isAppleWebKit();
    const pending = gum.call(navigator.mediaDevices, {
      audio: apple
        ? {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: true,
            channelCount: 1,
          }
        : {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
      video: false,
    });
    return Promise.resolve(pending).then(
      (stream) => ({ ok: true, stream }),
      (err) => ({ ok: false, code: err?.name || "NotAllowedError" }),
    );
  } catch (err) {
    return Promise.resolve({ ok: false, code: err?.name || "not-allowed" });
  }
}

function releaseMicStream(stream) {
  if (!stream) return;
  try {
    stream.getTracks().forEach((t) => {
      try {
        t.stop();
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }
}

function createSpeechRecognizer() {
  // iPad Safari SpeechRecognition stays silent or throws — Whisper only.
  if (isIpadLike()) return null;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  // Single-utterance mode: more reliable for short plancia commands ("mappa", "zoom").
  // Safari still needs continuous=true or it often ends with no-speech immediately.
  rec.continuous = Boolean(isAppleWebKit());
  rec.interimResults = Boolean(isAppleWebKit());
  rec.lang = "it-IT";
  try {
    rec.maxAlternatives = 3;
  } catch {
    /* older WebKit */
  }
  return rec;
}

/** Shared MIC controller so left-rail + Analizza bar use the same session (no synthetic clicks). */
let globalMicControl = null;

function pickRecorderMime() {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/mp4",
    "audio/aac",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];
  return candidates.find((t) => MediaRecorder.isTypeSupported?.(t)) || "";
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result || "");
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

function openMediaRecorder(stream) {
  const preferred = isIpadLike() || isAppleWebKit()
    ? ["audio/mp4", "audio/aac", "audio/mp4;codecs=mp4a.40.2"]
    : ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  const seen = new Set();
  for (const mime of preferred) {
    if (!mime || seen.has(mime)) continue;
    seen.add(mime);
    if (typeof MediaRecorder.isTypeSupported === "function" && !MediaRecorder.isTypeSupported(mime)) {
      continue;
    }
    try {
      return { recorder: new MediaRecorder(stream, { mimeType: mime }), mime };
    } catch {
      /* try the next container */
    }
  }
  try {
    const recorder = new MediaRecorder(stream);
    return { recorder, mime: recorder.mimeType || "" };
  } catch (err) {
    return { recorder: null, mime: "", error: err };
  }
}

function encodeWavPcm(chunks, sampleRate) {
  let length = 0;
  for (const chunk of chunks) length += chunk.length;
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i += 1) {
      const s = Math.max(-1, Math.min(1, chunk[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function bytesInclude(bytes, word) {
  const n = word.length;
  if (!bytes || bytes.length < n) return false;
  outer: for (let i = 0; i + n <= bytes.length; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (bytes[i + j] !== word.charCodeAt(j)) continue outer;
    }
    return true;
  }
  return false;
}

/** True when the blob is one decodable container, not a header-only Safari fragment. */
function containerLooksDecodable(bytes, mime) {
  if (!bytes || bytes.length <= 16) return false;
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return true;
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46) return bytes.length > 44;
  if (bytes[0] === 0x4f && bytes[1] === 0x67 && bytes[2] === 0x67 && bytes[3] === 0x53) return true;
  const ftyp = bytes.length > 8 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
  if (ftyp) return bytesInclude(bytes, "mdat") && (bytesInclude(bytes, "moov") || bytesInclude(bytes, "moof"));
  if (/aac/i.test(mime || "")) return bytes.length > 16;
  return false;
}

/**
 * Safari/iPad: MediaRecorder + createMediaStreamSource on the SAME MediaStream
 * often yields silent Analyser PCM (meter stuck at 0, Whisper empty). Feed the
 * Web Audio graph cloned tracks; leave the original stream for MediaRecorder.
 */
function micStreamForAudioGraph(stream) {
  if (!stream || typeof stream.getAudioTracks !== "function") return stream;
  try {
    const tracks = stream.getAudioTracks();
    if (!tracks.length) return stream;
    const clones = tracks.map((track) => (typeof track.clone === "function" ? track.clone() : track));
    if (!clones.some((clone, index) => clone !== tracks[index])) return stream;
    return new MediaStream(clones);
  } catch {
    return stream;
  }
}

function releaseClonedMicStream(graphStream, original) {
  if (!graphStream || graphStream === original) return;
  try {
    graphStream.getTracks?.().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }
}

/**
 * Mic → PCM via AnalyserNode (ScriptProcessor is unreliable / silent on Safari).
 * MediaRecorder mp4 on iPad is often empty; Whisper gets this WAV instead.
 */
function startPcmTap(stream) {
  const ctx = getPrimedAudioContext();
  if (!ctx || typeof ctx.createMediaStreamSource !== "function" || typeof ctx.createAnalyser !== "function") {
    return null;
  }
  try {
    ctx.resume?.();
    primeAudioContextInGesture(ctx);
    const graphStream = micStreamForAudioGraph(stream);
    const source = ctx.createMediaStreamSource(graphStream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    const mute = ctx.createGain();
    mute.gain.value = 0;
    source.connect(analyser);
    analyser.connect(mute);
    mute.connect(ctx.destination);
    const rate = ctx.sampleRate || 48000;
    const chunks = [];
    const frame = new Float32Array(analyser.fftSize);
    let timer = null;
    const pull = () => {
      try {
        if (typeof analyser.getFloatTimeDomainData === "function") {
          analyser.getFloatTimeDomainData(frame);
        } else if (typeof analyser.getByteTimeDomainData === "function") {
          const bytes = new Uint8Array(analyser.fftSize);
          analyser.getByteTimeDomainData(bytes);
          for (let i = 0; i < bytes.length; i += 1) frame[i] = (bytes[i] - 128) / 128;
        } else {
          return;
        }
        let acc = 0;
        for (let i = 0; i < frame.length; i += 1) acc += frame[i] * frame[i];
        const rms = Math.sqrt(acc / frame.length);
        chunks.push(new Float32Array(frame));
        // Cap memory: keep ~8s of audio frames at this hop.
        const maxChunks = Math.ceil((rate * 8) / frame.length);
        if (chunks.length > maxChunks) chunks.splice(0, chunks.length - maxChunks);
        paintMicLevel(rms);
      } catch {
        /* analyser can fail if the context was closed */
      }
    };
    timer = setInterval(pull, 40);
    const measure = (list) => {
      let samples = 0;
      let acc = 0;
      for (const chunk of list) {
        samples += chunk.length;
        for (let i = 0; i < chunk.length; i += 1) acc += chunk[i] * chunk[i];
      }
      return {
        samples,
        sampleRate: rate,
        rms: samples ? Math.sqrt(acc / samples) : 0,
        blob: samples ? encodeWavPcm(list, rate) : null,
      };
    };
    return {
      stop() {
        if (timer) clearInterval(timer);
        timer = null;
        clearMicLevel();
        try { source.disconnect(); } catch { /* ignore */ }
        try { analyser.disconnect(); } catch { /* ignore */ }
        try { mute.disconnect(); } catch { /* ignore */ }
        releaseClonedMicStream(graphStream, stream);
      },
      snapshot() {
        return measure(chunks);
      },
      consume() {
        return measure(chunks.splice(0, chunks.length));
      },
      level() {
        try {
          if (typeof analyser.getFloatTimeDomainData === "function") {
            analyser.getFloatTimeDomainData(frame);
          }
          let acc = 0;
          for (let i = 0; i < frame.length; i += 1) acc += frame[i] * frame[i];
          return Math.sqrt(acc / frame.length);
        } catch {
          return 0;
        }
      },
    };
  } catch {
    return null;
  }
}

function describeAudioBlob(blob) {
  const mime = String(blob?.type || "application/octet-stream");
  const m = mime.toLowerCase();
  if (m.includes("wav")) return { mimeType: "audio/wav", filename: "mic.wav" };
  if (m.includes("webm")) return { mimeType: mime, filename: "mic.webm" };
  if (m.includes("ogg")) return { mimeType: mime, filename: "mic.ogg" };
  if (m.includes("mpeg") || m.includes("mp3")) return { mimeType: "audio/mpeg", filename: "mic.mp3" };
  if (m.includes("aac") && !m.includes("mp4")) return { mimeType: "audio/aac", filename: "mic.aac" };
  return { mimeType: "audio/mp4", filename: "mic.m4a" };
}

async function chooseUploadBlob(chunks, mime, pcmTap) {
  const parts = (chunks || []).filter((c) => c && c.size > 0);
  const type = mime || parts[0]?.type || "audio/mp4";
  const recorderBlob = parts.length ? new Blob(parts, { type }) : new Blob([], { type });
  let recBytes = null;
  if (recorderBlob.size > 16) recBytes = new Uint8Array(await recorderBlob.arrayBuffer());
  const recOk = Boolean(recBytes && containerLooksDecodable(recBytes, type));
  let snap = null;
  try {
    snap = pcmTap?.snapshot?.() || null;
  } catch {
    snap = null;
  }
  const wav = snap?.blob && snap.blob.size > 16 ? snap.blob : null;
  // Tablet Safari mics often land quieter than desktop; accept a lower RMS floor.
  const rmsFloor = isIpadLike() || isAppleWebKit() ? 0.004 : 0.008;
  const wavSpeech = Boolean(
    wav &&
      snap.samples > (snap.sampleRate || 16000) * 0.35 &&
      snap.rms >= rmsFloor,
  );
  // Real iPad: send the PCM/WAV Whisper already accepts. The fake-mic test is a
  // valid container; a Safari timeslice mp4 often is not.
  if ((isIpadLike() || isAppleWebKit()) && wavSpeech) return wav;
  if (recOk) return new Blob([recBytes], { type: type || "audio/mp4" });
  if (wav) return wav;
  if (recorderBlob.size > 16) return recorderBlob;
  return recorderBlob;
}


/** Whisper often invents these on silence. Keep the call open and do not reply. */
function isIgnorableTranscript(text) {
  const raw = String(text || "").trim();
  if (raw.length < 2) return true;
  const t = raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!t || t.length < 2) return true;
  return (
    /sottotitol/.test(t) ||
    /\bamara\b/.test(t) ||
    /grazie per aver (guardato|ascoltato|visto)/.test(t) ||
    /thanks for watching/.test(t) ||
    /thank you for watching/.test(t) ||
    /^\[?\s*(musica|music|applausi|applause|risate)\s*\]?$/.test(t)
  );
}

function isSilenceTranscriptError(err) {
  const msg = String(err?.message || err || "");
  return /testo vuoto|audio vuoto|troppo corto|no speech|nessuna voce/i.test(msg);
}

function setupMic(button, onText) {
  if (!button) return null;
  if (button.dataset.micWired) return globalMicControl;
  button.dataset.micWired = "1";
  const hasSR = Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
  button.title = "Tocca per avviare la chiamata vocale. Ritocca END per chiudere.";
  button.setAttribute("aria-pressed", "false");
  button.removeAttribute("aria-disabled");

  let rec = null;
  let micStream = null;
  let starting = false;
  let startWatchTimer = null;
  let handledByPointer = false;
  let mediaRecorder = null;
  let recordChunks = [];
  let recordMime = "";
  let recordTimer = null;
  let mode = null; // "sr" | "call"
  let gestureMicPromise = null;
  let pcmTap = null;
  let callLive = false;
  let callGen = 0;
  let ttsEpoch = 0;
  let ttsHolding = false;
  let segmentDiscard = false;
  let wakeSegment = null;
  let finishCollect = null;
  let bargeWatch = null;
  let alwaysOnState = { phase: "off", enabled: false, action: "keep", wakeWord: "Atlas" };
  let wakeActive = false;
  let wakeGen = 0;
  let wakeHold = false;
  const uiButtons = new Set([button]);
  const CALL_SEGMENT_MS = 3200;
  const WAKE_SEGMENT_MS = 1800;
  const LISTEN_CUE = "In ascolto — di' Atlas per parlare.";

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const clearStartWatch = () => {
    if (startWatchTimer) {
      clearTimeout(startWatchTimer);
      startWatchTimer = null;
    }
  };

  const callOpen = () => Boolean(callLive || mode === "call");

  const paintMicLabel = (btn, open) => {
    const span = btn.querySelector("span");
    if (span) span.textContent = open ? "END" : "MIC";
    else if (!btn.querySelector("svg")) btn.textContent = open ? "END" : "MIC";
    btn.setAttribute("aria-label", open ? "Chiudi chiamata" : "Apri chiamata vocale");
  };

  const setMicTracksEnabled = (on) => {
    const tracks = micStream?.getAudioTracks?.() || [];
    for (const track of tracks) {
      try { track.enabled = Boolean(on); } catch { /* ignore */ }
    }
  };

  const setLiveUi = (live) => {
    const open = callOpen();
    state.micLive = Boolean(live || open);
    document.body.classList.toggle("mic-live", state.micLive);
    document.body.classList.toggle("voice-call", open);
    document.documentElement.dataset.voiceCall = open ? "1" : "0";
    document.documentElement.dataset.voiceDuplex = VOICE_DUPLEX;
    if (!open) document.documentElement.dataset.voicePhase = "idle";
    for (const btn of uiButtons) {
      btn.classList.toggle("live", state.micLive);
      btn.setAttribute("aria-pressed", state.micLive ? "true" : "false");
      paintMicLabel(btn, open);
      btn.title = open
        ? "Chiamata attiva — ritocca END per chiudere"
        : "Tocca per avviare la chiamata vocale. Ritocca END per chiudere.";
    }
  };

  const stopUi = () => {
    clearMicLevel();
    starting = false;
    mode = null;
    clearStartWatch();
    if (recordTimer) {
      clearTimeout(recordTimer);
      recordTimer = null;
    }
    setLiveUi(false);
  };

  const stopPcmTap = () => {
    const tap = pcmTap;
    pcmTap = null;
    try { tap?.stop?.(); } catch { /* ignore */ }
    return tap;
  };

  const stopBargeWatch = () => {
    const watch = bargeWatch;
    bargeWatch = null;
    try { watch?.stop?.(); } catch { /* ignore */ }
  };

  const dropGestureCapture = () => {
    const leftover = gestureMicPromise;
    gestureMicPromise = null;
    if (!leftover) return;
    Promise.resolve(leftover).then((perm) => {
      if (perm?.stream && perm.stream !== micStream) releaseMicStream(perm.stream);
    }).catch(() => {});
  };

  const hardStop = () => {
    stopBargeWatch();
    callLive = false;
    callGen += 1;
    wakeActive = false;
    wakeGen += 1;
    wakeHold = false;
    ttsEpoch += 1;
    ttsHolding = false;
    segmentDiscard = true;
    try { wakeSegment?.(); } catch { /* ignore */ }
    wakeSegment = null;
    try { finishCollect?.(); } catch { /* ignore */ }
    finishCollect = null;
    const recNow = mediaRecorder;
    mediaRecorder = null;
    if (recNow && recNow.state !== "inactive") {
      try { recNow.onstop = null; recNow.stop(); } catch { /* ignore */ }
    }
    recordChunks = [];
    stopPcmTap();
    if (rec) {
      try {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.onstart = null;
        rec.abort?.();
      } catch {
        try { rec.stop(); } catch { /* ignore */ }
      }
      rec = null;
    }
    releaseMicStream(micStream);
    micStream = null;
    dropGestureCapture();
    stopUi();
    document.documentElement.dataset.voicePhase = "idle";
    document.documentElement.dataset.micEngine = "";
    if (alwaysOnState?.enabled) applyAlwaysOn("disable");
    else document.documentElement.dataset.wakePhase = "off";
  };

  const streamAlive = (stream) => {
    const tracks = stream?.getAudioTracks?.() || [];
    return tracks.length > 0 && tracks.some((track) => track.readyState === "live");
  };

  // First MIC tap on a desktop host with VOICE_ALWAYS_ON grants the mic and arms
  // wake listening. It does not open the Phase Now call. iPad never enters here.
  const desktopAlwaysOn = () => canArmAlwaysOn({
    alwaysOnEnv: document.documentElement.dataset.voiceAlwaysOn === "1",
    desktop: isDesktopVoiceHost(),
  });

  const applyAlwaysOn = (event, payload) => {
    alwaysOnState = reduceAlwaysOn(alwaysOnState, event, payload);
    document.documentElement.dataset.wakePhase = alwaysOnState.phase || "off";
    return alwaysOnState;
  };

  const paintWakeUi = () => {
    state.micLive = true;
    document.body.classList.toggle("mic-live", true);
    document.body.classList.toggle("voice-call", false);
    document.documentElement.dataset.voiceCall = "0";
    document.documentElement.dataset.voicePhase = "desktop-always-on";
    document.documentElement.dataset.wakeWord = "desktop-always-on";
    document.documentElement.dataset.wakeWordArmed = "1";
    document.documentElement.dataset.micEngine = "wake-spot";
    document.documentElement.dataset.wakePhase = alwaysOnState.phase || "listening";
    for (const btn of uiButtons) {
      btn.classList.toggle("live", true);
      btn.setAttribute("aria-pressed", "true");
      paintMicLabel(btn, false);
      btn.title = LISTEN_CUE;
      btn.setAttribute("aria-label", "Ascolto Atlas attivo");
    }
  };

  const stopActiveRecorder = () => {
    const recNow = mediaRecorder;
    mediaRecorder = null;
    if (recNow && recNow.state !== "inactive") {
      try { recNow.onstop = null; recNow.stop(); } catch { /* ignore */ }
    }
    recordChunks = [];
  };

  const stopWakeLoop = () => {
    wakeActive = false;
    wakeGen += 1;
    wakeHold = false;
    try { wakeSegment?.(); } catch { /* ignore */ }
    wakeSegment = null;
    stopActiveRecorder();
    stopPcmTap();
  };

  const pauseCallKeepMic = () => {
    stopBargeWatch();
    callLive = false;
    callGen += 1;
    ttsEpoch += 1;
    ttsHolding = false;
    segmentDiscard = true;
    wakeHold = false;
    try { wakeSegment?.(); } catch { /* ignore */ }
    wakeSegment = null;
    try { finishCollect?.(); } catch { /* ignore */ }
    finishCollect = null;
    stopActiveRecorder();
    stopPcmTap();
    if (rec) {
      try {
        rec.onresult = null;
        rec.onerror = null;
        rec.onend = null;
        rec.onstart = null;
        rec.abort?.();
      } catch {
        try { rec.stop(); } catch { /* ignore */ }
      }
      rec = null;
    }
    dropGestureCapture();
    starting = false;
    mode = null;
    clearStartWatch();
    if (recordTimer) {
      clearTimeout(recordTimer);
      recordTimer = null;
    }
  };

  const startWakeLoop = () => {
    if (!desktopAlwaysOn() || callLive || !streamAlive(micStream)) return;
    if (alwaysOnState.phase === "arming" && alwaysOnState.enabled) applyAlwaysOn("mic-ready");
    wakeHold = false;
    wakeActive = true;
    const gen = ++wakeGen;
    paintWakeUi();
    runWakeLoop(gen).catch((err) => {
      if (!wakeActive || gen !== wakeGen) return;
      postChatUpdate(err?.message || "Ascolto interrotto", "warn");
      applyAlwaysOn("mic-dead");
      hardStop();
    });
  };

  const openCallFromWake = async (heard) => {
    const opened = reduceCall({ open: false, phase: "idle" }, "wake");
    if (opened.action !== "open" || opened.open !== true) {
      applyAlwaysOn("call-end");
      return;
    }
    stopWakeLoop();
    applyAlwaysOn("call-open");
    const rest = wakeCommandRemainder(heard);
    await delay(160);
    if (callLive || !desktopAlwaysOn()) return;
    if (!streamAlive(micStream)) {
      applyAlwaysOn("mic-dead");
      hardStop();
      postChatUpdate("Microfono interrotto. Ritocca MIC per riarmare l'ascolto.", "warn");
      return;
    }
    await startVoiceCall({ reuseStream: true, seedText: rest });
  };

  const runWakeLoop = async (gen) => {
    let lastWarnAt = 0;
    while (wakeActive && gen === wakeGen && !callLive) {
      while (wakeActive && gen === wakeGen && wakeHold && !callLive) await delay(120);
      if (!wakeActive || gen !== wakeGen || callLive) return;
      if (!streamAlive(micStream)) {
        applyAlwaysOn("mic-dead");
        hardStop();
        postChatUpdate("Microfono interrotto. Ritocca MIC per riarmare l'ascolto.", "warn");
        return;
      }
      const captured = await recordSegment(gen, {
        ms: WAKE_SEGMENT_MS,
        wake: true,
        alive: () => wakeActive && gen === wakeGen && !callLive && !wakeHold,
      });
      if (!wakeActive || gen !== wakeGen || callLive || wakeHold) continue;
      if (!captured) continue;
      const { blob, snap } = captured;
      if (segmentIsSilent(blob, snap)) continue;
      let heard = "";
      try {
        heard = await transcribeSegment(blob, { wakeOnly: true });
      } catch (err) {
        if (!wakeActive || gen !== wakeGen || callLive) return;
        if (isSilenceTranscriptError(err)) continue;
        const now = Date.now();
        if (now - lastWarnAt > 8000) {
          lastWarnAt = now;
          postChatUpdate(err?.message || "Trascrizione wake fallita", "warn");
        }
        await delay(600);
        continue;
      }
      if (!wakeActive || gen !== wakeGen || callLive || wakeHold) continue;
      if (!heard || isIgnorableTranscript(heard) || !matchesWakeWord(heard)) {
        if (heard) applyAlwaysOn("transcript", { text: heard });
        continue;
      }
      const decision = applyAlwaysOn("transcript", { text: heard });
      if (decision.action !== "open-call") continue;
      await openCallFromWake(heard);
      return;
    }
  };

  const armAlwaysOnFromGesture = async () => {
    if (!desktopAlwaysOn() || callOpen() || starting) return;
    if (wakeActive && streamAlive(micStream)) {
      paintWakeUi();
      postChatUpdate(LISTEN_CUE);
      showToast(LISTEN_CUE, "ok");
      return;
    }
    applyAlwaysOn("enable");
    markUserInput?.();
    const capture = gestureMicPromise;
    gestureMicPromise = null;
    if (!capture && streamAlive(micStream)) {
      applyAlwaysOn("mic-ready");
      postChatUpdate(LISTEN_CUE);
      showToast(LISTEN_CUE, "ok");
      startWakeLoop();
      return;
    }
    if (!capture) {
      applyAlwaysOn("mic-dead");
      postChatUpdate(micErrorMessage("gesture"), "warn");
      return;
    }
    let perm;
    try {
      perm = await capture;
    } catch (err) {
      applyAlwaysOn("mic-dead");
      postChatUpdate(micErrorMessage(err?.name || "not-allowed"), "warn");
      return;
    }
    if (callOpen() || starting) {
      if (perm?.stream && perm.stream !== micStream) releaseMicStream(perm.stream);
      return;
    }
    if (!perm?.ok || !perm.stream) {
      if (perm?.stream) releaseMicStream(perm.stream);
      applyAlwaysOn("mic-dead");
      postChatUpdate(micErrorMessage(perm?.code), "warn");
      return;
    }
    if (micStream && micStream !== perm.stream) releaseMicStream(micStream);
    micStream = perm.stream;
    const canCapture = typeof MediaRecorder !== "undefined"
      || Boolean(getPrimedAudioContext()?.createScriptProcessor);
    if (!canCapture) {
      releaseMicStream(micStream);
      micStream = null;
      applyAlwaysOn("mic-dead");
      postChatUpdate(`Microfono non disponibile su questo browser (${micDiagHint()}).`, "warn");
      return;
    }
    applyAlwaysOn("mic-ready");
    postChatUpdate(LISTEN_CUE);
    showToast(LISTEN_CUE, "ok");
    startWakeLoop();
  };

  const endVoiceCall = (msg = "Chiamata chiusa") => {
    const wasCall = callOpen() || starting;
    const wasWake = wakeActive && !wasCall;
    const decision = reduceCall({ open: wasCall, phase: "listen" }, "hangup");
    const was = wasCall || state.micLive;
    cancelPlayback();
    if (wasWake) {
      hardStop();
      document.documentElement.dataset.voicePhase = "idle";
      postChatUpdate("Ascolto disattivato");
      showToast("Ascolto disattivato", "ok");
      return;
    }
    const keepForWake = wasCall && desktopAlwaysOn() && streamAlive(micStream);
    if (keepForWake) {
      pauseCallKeepMic();
      applyAlwaysOn("call-end");
      paintWakeUi();
      if (was && msg) {
        postChatUpdate(`Chiamata chiusa. ${LISTEN_CUE}`);
        showToast(LISTEN_CUE, "ok");
      }
      delay(180).then(() => {
        if (!callLive && desktopAlwaysOn() && streamAlive(micStream)) startWakeLoop();
      });
      return;
    }
    hardStop();
    document.documentElement.dataset.voicePhase = decision.phase;
    if (was && msg) {
      postChatUpdate(msg);
      showToast(msg, "ok");
    }
  };

  const micDiagHint = () => {
    const parts = [
      window.isSecureContext ? "HTTPS ok" : "contesto non sicuro",
      navigator.mediaDevices?.getUserMedia ? "getUserMedia ok" : "getUserMedia assente",
      hasSR ? "SpeechRecognition ok" : "SpeechRecognition assente",
      typeof MediaRecorder !== "undefined" ? "MediaRecorder ok" : "MediaRecorder assente",
    ];
    return parts.join(" · ");
  };

  const collectRecorder = () => new Promise((resolve) => {
    const recNow = mediaRecorder;
    if (!recNow || recNow.state === "inactive") {
      resolve(recordChunks.splice(0, recordChunks.length));
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      finishCollect = null;
      if (mediaRecorder === recNow) mediaRecorder = null;
      resolve(recordChunks.splice(0, recordChunks.length));
    };
    finishCollect = finish;
    recNow.ondataavailable = (ev) => {
      if (ev.data && ev.data.size) recordChunks.push(ev.data);
    };
    recNow.onerror = () => finish();
    recNow.onstop = () => {
      setTimeout(finish, isIpadLike() || isAppleWebKit() ? 480 : 90);
    };
    try { recNow.stop(); } catch { finish(); }
    setTimeout(finish, 1600);
  });

  const blobForSegment = async (chunks, mime, snap) => {
    const rmsFloor = isIpadLike() || isAppleWebKit() ? 0.004 : 0.008;
    const speechy = Boolean(
      snap &&
      snap.blob &&
      snap.rms >= rmsFloor &&
      snap.samples > (snap.sampleRate || 16000) * 0.22,
    );
    // PCM/WAV is the reliable Apple capture. MediaRecorder mp4 is used when PCM
    // did not hear speech but the container itself looks real.
    if (speechy) return snap.blob;
    return chooseUploadBlob(chunks, mime, { snapshot: () => snap });
  };

  const segmentIsSilent = (blob, snap) => {
    const rmsFloor = isIpadLike() || isAppleWebKit() ? 0.004 : 0.008;
    if (snap && snap.samples > (snap.sampleRate || 16000) * 0.18) return snap.rms < rmsFloor;
    if (!blob || blob.size <= 16) return true;
    const min = /wav|mp4|aac|m4a/i.test(blob.type || "") ? 700 : 64;
    return blob.size < min;
  };

  const transcribeSegment = async (blob, opts = {}) => {
    const meta = describeAudioBlob(blob);
    const audioBase64 = await blobToBase64(blob);
    const data = await api("/api/ai/transcribe", {
      method: "POST",
      body: JSON.stringify({
        audioBase64,
        mimeType: meta.mimeType,
        filename: meta.filename,
        language: "it",
        ...(opts.wakeOnly ? { wakeOnly: true } : {}),
      }),
    });
    const heard = String(data?.text || "").trim();
    if (!heard && data?.fallback && data?.reply) {
      const err = new Error(data.reply);
      err.code = data.fallback;
      throw err;
    }
    return heard;
  };

  const recordSegment = async (gen, opts = {}) => {
    const ms = Number(opts.ms) > 0 ? Number(opts.ms) : CALL_SEGMENT_MS;
    const alive = typeof opts.alive === "function"
      ? opts.alive
      : () => Boolean(callLive && gen === callGen);
    if (!alive() || !micStream || ttsHolding || (opts.wake && wakeHold)) return null;
    ensureAudioSessionPlayAndRecord();
    setMicTracksEnabled(true);
    if (!pcmTap) pcmTap = startPcmTap(micStream);
    segmentDiscard = false;
    recordChunks = [];
    recordMime = "";
    if (typeof MediaRecorder !== "undefined") {
      const opened = openMediaRecorder(micStream);
      if (opened.recorder) {
        mediaRecorder = opened.recorder;
        recordMime = opened.mime || mediaRecorder.mimeType || "";
        mediaRecorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size) recordChunks.push(ev.data);
        };
        try {
          // No timeslice. Apple audio/mp4 + start(timeslice) yields empty blobs.
          mediaRecorder.start();
        } catch {
          try { mediaRecorder.onstop = null; } catch { /* ignore */ }
          mediaRecorder = null;
          recordMime = "audio/wav";
        }
      }
    }
    if (opts.wake) {
      document.documentElement.dataset.voicePhase = "desktop-always-on";
      document.documentElement.dataset.wakeWord = "desktop-always-on";
    } else {
      document.documentElement.dataset.voicePhase = "listen";
      setLiveUi(true);
    }
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        wakeSegment = null;
        resolve();
      }, ms);
      wakeSegment = () => {
        clearTimeout(timer);
        wakeSegment = null;
        resolve();
      };
    });
    const discard = segmentDiscard || ttsHolding || (opts.wake && wakeHold) || !alive();
    const chunks = await collectRecorder();
    let snap = null;
    try { snap = pcmTap?.consume?.() || null; } catch { snap = null; }
    if (discard) {
      if (ttsHolding) stopPcmTap();
      return null;
    }
    const blob = await blobForSegment(chunks, recordMime, snap);
    return { blob, snap };
  };

  const runCallLoop = async (gen, seedText = "") => {
    let lastWarnAt = 0;
    const warn = (msg) => {
      const now = Date.now();
      if (!msg || now - lastWarnAt < 8000) return;
      lastWarnAt = now;
      postChatUpdate(msg, "warn");
    };
    const seed = String(seedText || "").trim();
    if (seed && callLive && gen === callGen && !isIgnorableTranscript(seed)) {
      const reply = reduceCall({ open: true, phase: "listen" }, "segment-heard");
      if (reply.action === "reply") {
        postChatUpdate(`Voce rilevata: ${seed}`);
        showToast("Voce rilevata", "ok");
        ttsHolding = true;
        segmentDiscard = true;
        setMicTracksEnabled(false);
        stopPcmTap();
        document.documentElement.dataset.voicePhase = reply.phase;
        const epoch = ttsEpoch;
        try {
          await Promise.resolve(onText(seed));
        } catch (err) {
          warn(err?.message || "Risposta vocale fallita");
        }
        if (!callLive || gen !== callGen) return;
        if (ttsEpoch !== epoch) {
          while (callLive && gen === callGen && ttsHolding) await delay(120);
          if (!callLive || gen !== callGen) return;
          await delay(420);
        } else {
          ttsHolding = false;
          segmentDiscard = false;
          setMicTracksEnabled(true);
        }
        const back = reduceCall({ open: true, phase: "tts" }, "tts-end");
        if (!back.open) return;
        document.documentElement.dataset.voicePhase = back.phase;
      }
    }
    while (callLive && gen === callGen) {
      while (callLive && gen === callGen && ttsHolding) await delay(120);
      if (!callLive || gen !== callGen || !micStream) return;
      const tracks = micStream.getAudioTracks?.() || [];
      if (!tracks.length || tracks.every((t) => t.readyState === "ended")) {
        endVoiceCall("Microfono interrotto. Ritocca MIC per riaprire la chiamata.");
        return;
      }
      const captured = await recordSegment(gen);
      if (!callLive || gen !== callGen) return;
      if (ttsHolding || !captured) continue;
      const { blob, snap } = captured;
      if (segmentIsSilent(blob, snap)) {
        const stay = reduceCall({ open: true, phase: "listen" }, "segment-silence");
        if (!stay.open || stay.action !== "listen") return;
        continue;
      }
      let heard = "";
      try {
        heard = await transcribeSegment(blob);
      } catch (err) {
        if (!callLive || gen !== callGen) return;
        if (isSilenceTranscriptError(err)) continue;
        warn(err?.message || "Trascrizione fallita");
        await delay(600);
        continue;
      }
      if (!callLive || gen !== callGen || ttsHolding) continue;
      if (!heard || isIgnorableTranscript(heard)) continue;
      const reply = reduceCall({ open: true, phase: "listen" }, "segment-heard");
      if (reply.action !== "reply") continue;
      postChatUpdate(`Voce rilevata: ${heard}`);
      showToast("Voce rilevata", "ok");
      ttsHolding = true;
      segmentDiscard = true;
      setMicTracksEnabled(false);
      stopPcmTap();
      document.documentElement.dataset.voicePhase = reply.phase;
      const epoch = ttsEpoch;
      try {
        await Promise.resolve(onText(heard));
      } catch (err) {
        warn(err?.message || "Risposta vocale fallita");
      }
      if (!callLive || gen !== callGen) return;
      if (ttsEpoch !== epoch) {
        while (callLive && gen === callGen && ttsHolding) await delay(120);
        if (!callLive || gen !== callGen) return;
        await delay(420);
      } else {
        ttsHolding = false;
        segmentDiscard = false;
        setMicTracksEnabled(true);
      }
      const back = reduceCall({ open: true, phase: "tts" }, "tts-end");
      if (!back.open) return;
      document.documentElement.dataset.voicePhase = back.phase;
    }
  };

  const startVoiceCall = async ({ reuseStream = false, seedText = "" } = {}) => {
    markUserInput?.();
    ensureAudioSessionPlayAndRecord();
    const myGen = ++callGen;
    starting = true;
    mode = "call";
    document.documentElement.dataset.micEngine = "media-recorder-call";
    document.documentElement.dataset.voicePhase = "listen";
    setLiveUi(true);

    if (reuseStream) {
      if (myGen !== callGen || !streamAlive(micStream)) {
        if (myGen === callGen) hardStop();
        postChatUpdate("Microfono non disponibile. Ritocca MIC per riarmare l'ascolto.", "warn");
        return;
      }
      if (!pcmTap) pcmTap = startPcmTap(micStream);
      if (!pcmTap && typeof MediaRecorder === "undefined") {
        if (myGen === callGen) hardStop();
        postChatUpdate(
          `Microfono non disponibile su questo browser (${micDiagHint()}). Su iPad serve Safari aggiornato.`,
          "warn",
        );
        return;
      }
      callLive = true;
      ttsHolding = false;
      segmentDiscard = false;
      starting = false;
      setLiveUi(true);
      postChatUpdate("Chiamata aperta — resto in ascolto. Rispondo a voce. Ritocca END per chiudere.");
      showToast("Chiamata attiva", "ok");
      try {
        await runCallLoop(myGen, seedText);
      } catch (err) {
        if (callLive && myGen === callGen) endVoiceCall(err?.message || "Chiamata interrotta");
      }
      return;
    }

    const failStart = async (message, capture) => {
      if (capture) {
        try {
          const pending = await capture;
          if (pending?.stream) releaseMicStream(pending.stream);
        } catch { /* ignore */ }
      }
      if (myGen !== callGen) return;
      hardStop();
      if (message) postChatUpdate(message, "warn");
    };

    if (!window.isSecureContext) {
      const capture = gestureMicPromise;
      gestureMicPromise = null;
      await failStart(micErrorMessage("secure-context"), capture);
      return;
    }
    const capture = gestureMicPromise;
    gestureMicPromise = null;
    if (!capture) {
      await failStart(micErrorMessage("gesture"), null);
      return;
    }
    let perm;
    try {
      perm = await capture;
    } catch (err) {
      await failStart(micErrorMessage(err?.name || "not-allowed"), null);
      return;
    }
    if (myGen !== callGen) {
      if (perm?.stream) releaseMicStream(perm.stream);
      return;
    }
    if (!perm?.ok || !perm.stream) {
      if (perm?.stream) releaseMicStream(perm.stream);
      if (myGen === callGen) hardStop();
      postChatUpdate(micErrorMessage(perm?.code), "warn");
      return;
    }
    micStream = perm.stream;
    pcmTap = startPcmTap(micStream);
    if (!pcmTap && typeof MediaRecorder === "undefined") {
      releaseMicStream(micStream);
      micStream = null;
      if (myGen === callGen) hardStop();
      postChatUpdate(
        `Microfono non disponibile su questo browser (${micDiagHint()}). Su iPad serve Safari aggiornato.`,
        "warn",
      );
      return;
    }
    callLive = true;
    ttsHolding = false;
    segmentDiscard = false;
    starting = false;
    setLiveUi(true);
    postChatUpdate("Chiamata aperta — resto in ascolto. Rispondo a voce. Ritocca END per chiudere.");
    showToast("Chiamata attiva", "ok");
    try {
      await runCallLoop(myGen);
    } catch (err) {
      if (callLive && myGen === callGen) endVoiceCall(err?.message || "Chiamata interrotta");
    }
  };

  const bindRec = (instance) => {
    instance.onstart = () => {
      clearStartWatch();
      starting = false;
      setLiveUi(true);
      postChatUpdate("Ascolto attivo — parla ora…");
    };
    instance.onresult = (ev) => {
      let text = "";
      try {
        for (let i = ev.results.length - 1; i >= 0; i -= 1) {
          const res = ev.results[i];
          const piece = res?.[0]?.transcript || "";
          if (!piece) continue;
          if (res.isFinal || !isAppleWebKit()) {
            text = piece;
            break;
          }
          if (!text) text = piece;
        }
      } catch { text = ""; }
      const finalish = (() => {
        try {
          const last = ev.results?.[ev.results.length - 1];
          return Boolean(last?.isFinal) || !isAppleWebKit();
        } catch { return true; }
      })();
      if (!finalish && isAppleWebKit()) {
        instance._opsLastInterim = text;
        return;
      }
      hardStop();
      const heard = (text || instance._opsLastInterim || "").trim();
      if (heard) {
        postChatUpdate(`Ascoltato: ${heard}`);
        onText(heard);
      } else {
        postChatUpdate(micErrorMessage("no-speech"), "warn");
      }
    };
    instance.onerror = (ev) => {
      const code = ev?.error || "mic";
      hardStop();
      if (code === "aborted") return;
      const msg = micErrorMessage(code);
      if (msg) postChatUpdate(msg, "warn");
    };
    instance.onend = () => {
      const pending = String(instance._opsLastInterim || "").trim();
      if (pending && (state.micLive || starting)) {
        hardStop();
        postChatUpdate(`Ascoltato: ${pending}`);
        onText(pending);
        return;
      }
      if (!state.micLive && !starting) return;
      releaseMicStream(micStream);
      micStream = null;
      stopUi();
      rec = null;
    };
  };

  const startRecognition = () => {
    if (voiceUnlocked) ensureAudioSessionPlayAndRecord();
    markUserInput?.();
    if (callOpen() || starting) {
      dropGestureCapture();
      endVoiceCall("Chiamata chiusa");
      return;
    }
    // Desktop always-on listens for Atlas. iPad / non-desktop falls through to Phase Now.
    if (desktopAlwaysOn()) {
      armAlwaysOnFromGesture();
      return;
    }
    if (mode === "sr" || rec) {
      hardStop();
      postChatUpdate("Ascolto interrotto");
      return;
    }
    silenceVoice();
    // Continuous call. SpeechRecognition stays off on iPad and any touch device.
    if (preferWhisperMic() || typeof MediaRecorder !== "undefined" || !hasSR) {
      document.documentElement.dataset.micEngine = "media-recorder-call";
      startVoiceCall();
      return;
    }
    starting = true;
    mode = "sr";
    document.documentElement.dataset.micEngine = "speech-recognition";
    setLiveUi(true);
    postChatUpdate("Avvio microfono…");
    if (rec) {
      try { rec.abort?.(); } catch { /* ignore */ }
      rec = null;
    }
    rec = createSpeechRecognizer();
    if (!rec) {
      hardStop();
      startVoiceCall();
      return;
    }
    bindRec(rec);
    try {
      rec.start();
    } catch {
      hardStop();
      postChatUpdate("SpeechRecognition fallito — registrazione alternativa…", "warn");
      startVoiceCall();
      return;
    }
    clearStartWatch();
    startWatchTimer = setTimeout(() => {
      if (!starting) return;
      hardStop();
      postChatUpdate("Microfono web non partito. Ritocca MIC.", "warn");
    }, 1000);
    const capture = gestureMicPromise;
    gestureMicPromise = null;
    if (capture) {
      capture.then((perm) => {
        if (!perm?.ok) {
          if (perm?.code) postChatUpdate(micErrorMessage(perm.code), "warn");
          return;
        }
        if (state.micLive || starting) micStream = perm.stream || null;
        else if (perm.stream) releaseMicStream(perm.stream);
      });
    }
  };

  const toggle = () => { startRecognition(); };

  const beginGestureMicCapture = () => {
    // First gesture only: unlock playback and open the mic. Later taps reuse the stream.
    unlockVoiceOutput();
    ensureAudioSessionPlayAndRecord();
    getPrimedAudioContext();
    if (callOpen() || starting || micStream) return;
    if (!gestureMicPromise) gestureMicPromise = beginUserMediaCapture();
  };

  const bargeIn = (reason) => {
    const phase = ttsHolding || document.documentElement.dataset.voicePhase === "tts"
      ? "tts"
      : (document.documentElement.dataset.voicePhase || "listen");
    const decision = reduceCall(
      { open: callLive || mode === "call", phase },
      reason === "speech" ? "speech" : "tap",
    );
    if (decision.action !== "barge") return false;
    cancelPlayback();
    stopBargeWatch();
    ttsEpoch += 1;
    ttsHolding = false;
    segmentDiscard = true;
    try { wakeSegment?.(); } catch { /* ignore */ }
    stopPcmTap();
    setMicTracksEnabled(true);
    document.documentElement.dataset.voicePhase = decision.phase;
    document.documentElement.dataset.voiceDuplex = decision.duplex || VOICE_DUPLEX;
    postChatUpdate("Interrotto — ti ascolto.");
    return true;
  };

  const startBargeWatch = () => {
    stopBargeWatch();
    if (!callLive || !micStream) return;
    setMicTracksEnabled(true);
    const ctx = getPrimedAudioContext();
    if (!ctx?.createMediaStreamSource || !ctx.createAnalyser) return;
    let source;
    let analyser;
    let mute;
    let timer = null;
    const graphStream = micStreamForAudioGraph(micStream);
    try {
      source = ctx.createMediaStreamSource(graphStream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      mute = ctx.createGain();
      mute.gain.value = 0;
      source.connect(analyser);
      analyser.connect(mute);
      mute.connect(ctx.destination);
      const data = new Float32Array(analyser.fftSize);
      const started = Date.now();
      let hotSince = 0;
      timer = setInterval(() => {
        try {
          if (!ttsHolding || !callLive) return;
          if (Date.now() - started < 500) return;
          if (typeof analyser.getFloatTimeDomainData !== "function") return;
          analyser.getFloatTimeDomainData(data);
          let acc = 0;
          for (let i = 0; i < data.length; i += 1) acc += data[i] * data[i];
          const rms = Math.sqrt(acc / data.length);
          const bargeFloor = isIpadLike() || isAppleWebKit() ? 0.07 : 0.12;
          if (rms >= bargeFloor) {
            if (!hotSince) hotSince = Date.now();
            else if (Date.now() - hotSince >= 280) bargeIn("speech");
          } else {
            hotSince = 0;
          }
        } catch {
          /* analyser can fail if the iPad context was closed */
        }
      }, 80);
    } catch {
      if (timer) clearInterval(timer);
      try { source?.disconnect(); } catch { /* ignore */ }
      try { analyser?.disconnect(); } catch { /* ignore */ }
      try { mute?.disconnect(); } catch { /* ignore */ }
      releaseClonedMicStream(graphStream, micStream);
      return;
    }
    bargeWatch = {
      stop() {
        if (timer) clearInterval(timer);
        try { source?.disconnect(); } catch { /* ignore */ }
        try { analyser?.disconnect(); } catch { /* ignore */ }
        try { mute?.disconnect(); } catch { /* ignore */ }
        releaseClonedMicStream(graphStream, micStream);
      },
    };
  };

  const onMicGesture = (e) => {
    if (e.type === "pointerdown" && e.pointerType === "mouse" && e.button !== 0) return;
    if (e.type === "click" && handledByPointer) {
      handledByPointer = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.type === "pointerdown") handledByPointer = true;
    const phase = ttsHolding || document.documentElement.dataset.voicePhase === "tts"
      ? "tts"
      : (document.documentElement.dataset.voicePhase || ((callOpen() || starting) ? "listen" : "idle"));
    const decision = reduceCall({ open: callOpen() || starting, phase }, "tap");
    if (decision.action === "barge") {
      bargeIn("tap");
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    beginGestureMicCapture();
    e.preventDefault();
    e.stopPropagation();
    // Desktop always-on: the first MIC tap arms wake listening and does not open the call.
    if (!callOpen() && !starting && decision.action === "open" && desktopAlwaysOn()) {
      armAlwaysOnFromGesture();
      return;
    }
    toggle();
  };

  button.addEventListener("pointerdown", onMicGesture);
  button.addEventListener("click", onMicGesture);

  const releaseForTts = () => {
    ensureAudioSessionPlayAndRecord();
    if (!(callLive || mode === "call")) {
      if (wakeActive && micStream) {
        const epoch = ++ttsEpoch;
        wakeHold = true;
        segmentDiscard = true;
        try { wakeSegment?.(); } catch { /* ignore */ }
        setMicTracksEnabled(false);
        return epoch;
      }
      hardStop();
      return 0;
    }
    const epoch = ++ttsEpoch;
    ttsHolding = true;
    segmentDiscard = true;
    const decision = reduceCall({ open: true, phase: "reply" }, "tts-start");
    document.documentElement.dataset.voicePhase = decision.phase;
    document.documentElement.dataset.voiceDuplex = VOICE_DUPLEX;
    setMicTracksEnabled(true);
    try { wakeSegment?.(); } catch { /* ignore */ }
    startBargeWatch();
    return epoch;
  };

  const resumeAfterTts = (epoch) => {
    if (!epoch || epoch !== ttsEpoch) return;
    stopBargeWatch();
    ttsHolding = false;
    segmentDiscard = false;
    if (!(callLive || mode === "call") && wakeActive && micStream) {
      wakeHold = false;
      setMicTracksEnabled(true);
      if (!pcmTap) pcmTap = startPcmTap(micStream);
      document.documentElement.dataset.voicePhase = "desktop-always-on";
      document.documentElement.dataset.voiceCall = "0";
      return;
    }
    const back = reduceCall({ open: Boolean(callLive), phase: "tts" }, "tts-end");
    if (!callLive || !micStream) {
      document.documentElement.dataset.voicePhase = callLive ? back.phase : "idle";
      return;
    }
    setMicTracksEnabled(true);
    ensureAudioSessionPlayAndRecord();
    try {
      const ctx = getPrimedAudioContext();
      primeAudioContextInGesture(ctx);
      ctx?.resume?.();
    } catch {
      /* ignore */
    }
    if (!pcmTap) pcmTap = startPcmTap(micStream);
    document.documentElement.dataset.voicePhase = back.phase;
  };

  const status = () => {
    const desk = isDesktopVoiceHost(navigator.userAgent);
    const envOn = document.documentElement.dataset.voiceAlwaysOn === "1";
    const wake = wakeWordStatus(envOn, { desktop: desk });
    return {
      armed: Boolean(wake.armed),
      wakeWord: WAKE_WORD,
      listening: Boolean(wakeActive),
      callOpen: callOpen(),
      phase: callLive ? "in-call" : wakeActive ? "listening" : wake.phase,
    };
  };

  // Boot calls this after /health. It must not call getUserMedia — browsers
  // require a gesture, and the first MIC tap runs armAlwaysOnFromGesture.
  const armAlwaysOn = () => {
    if (!desktopAlwaysOn()) return status();
    if (!alwaysOnState.enabled) applyAlwaysOn("enable");
    document.documentElement.dataset.wakeWordArmed = "1";
    document.documentElement.dataset.wakeWord = "desktop-always-on";
    document.documentElement.dataset.voiceAlwaysOn = "1";
    if (!callLive && document.documentElement.dataset.voiceCall !== "1") {
      document.documentElement.dataset.voicePhase = "desktop-always-on";
    }
    return status();
  };

  const control = {
    toggle,
    stop: () => endVoiceCall("Chiamata chiusa"),
    endCall: () => endVoiceCall("Chiamata chiusa"),
    armAlwaysOn,
    status,
    releaseForTts,
    resumeAfterTts,
    attachButton(btn) {
      if (!btn || uiButtons.has(btn)) return;
      uiButtons.add(btn);
      btn.dataset.micWired = "1";
      paintMicLabel(btn, callOpen());
      btn.title = callOpen()
        ? "Chiamata attiva — ritocca END per chiudere"
        : button.title;
      btn.addEventListener("pointerdown", onMicGesture);
      btn.addEventListener("click", onMicGesture);
    },
  };
  return control;
}
async function loadAiNewsPins() {
  try {
    const data = await fetchAiNews();
    state.news = data.news || [];
    if (state.module === "map" && getViewer()) updateNewsPins(state.news);
  } catch (err) {
    console.warn("[ai] news pins", err?.message || err);
  }
}

async function initPaidAi() {
  wireBriefingForm();
  wireActionRunner((action, raw) => {
    const type = typeof action === "string" ? action : action?.type || raw?.type;
    return runHoloAction(type, { fromVoice: false });
  });
  wireBriefingHandler(async (result) => {
    if (result?.news?.length) {
      state.news = result.news;
      if (getViewer()) updateNewsPins(state.news);
    }
    if (result?.briefing) {
      postChatUpdate(result.briefing, "ok");
      showToast("Briefing pronto");
    }
    if (Array.isArray(result?.suggestions) && result.suggestions.length) {
      const tip = result.suggestions
        .slice(0, 3)
        .map((s) => `· ${s.area || "ops"}: ${s.issue || ""}`)
        .join(" ");
      if (tip) postChatUpdate(`Suggerimenti: ${tip}`, "ok");
    }
  });
  wireProactiveHandlers({
    onEvent: (ev, toast) => {
      postChatUpdate(`[proactive:${ev.kind}] ${toast}`, "ok");
      showToast(toast, "ok");
    },
    speak: (text) => speak(text),
  });
  try {
    state.aiStatus = await fetchAiStatus();
    state.aiPaid = Boolean(state.aiStatus?.paid);
    document.body.dataset.aiPaid = state.aiPaid ? "1" : "0";
    if (state.aiPaid) {
      await loadAiNewsPins();
      await syncClientMemoryToServer().catch(() => {});
      startProactivePolling(45000);
      // Defer briefing so MIC gesture + rail are usable immediately after login.
      // Modal backdrop uses pointer-events:none; Escape / Dopo / backdrop skip the day.
      if (shouldPromptBriefing(state.aiStatus)) {
        setTimeout(() => openBriefingModal(), 1800);
      }
    }
  } catch (err) {
    console.warn("[ai] status", err?.message || err);
    state.aiPaid = false;
  }
}

function wireUi() {
  $("moduleNav").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-module]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    // First-wins: if a switch is already running, ignore this overlapping click.
    if (moduleSwitchLocked) return;
    showModule(btn.dataset.module);
  });
  window.addEventListener("hashchange", () => {
    const fromHash = moduleFromHash();
    if (!fromHash || fromHash === state.module) return;
    if (moduleSwitchLocked) return; // first click still owns the transition
    showModule(fromHash);
  });
  const submitAnalizza = async () => {
    const text = $("chatInput")?.value || "";
    if (!text.trim()) {
      $("chatInput")?.focus();
      return;
    }
    if (state.module !== "chat") await showModule("chat");
    // Atlas: ricerca/mani on-demand prima della chat generica
    try {
      if (typeof window.__opsAgentqHandle === "function") {
        const handled = await window.__opsAgentqHandle(text);
        if (handled) {
          $("chatInput").value = "";
          return;
        }
      }
    } catch (err) {
      postChatUpdate(err?.message || "Atlas errore", "warn");
    }
    await sendChat(text);
  };
  $("sendChat")?.addEventListener("click", submitAnalizza);
  $("chatInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitAnalizza();
  });
  $("chatAttachInput")?.addEventListener("change", async (e) => {
    const file = e.target?.files?.[0];
    if (!file) return;
    if (file.size > 400_000) {
      showToast("Allegato troppo grande (max ~400KB testo)", "warn");
      e.target.value = "";
      return;
    }
    try {
      const text = await file.text();
      state.pendingAttachment = {
        name: file.name.slice(0, 180),
        mime: file.type || "text/plain",
        text: text.slice(0, 50_000),
      };
      const nameEl = $("chatAttachName");
      if (nameEl) nameEl.textContent = file.name;
      showToast(`Allegato pronto: ${file.name}`);
    } catch {
      showToast("Impossibile leggere l'allegato", "bad");
    }
  });
  $("refreshBtn")?.addEventListener("click", async () => {
    try {
      await refresh();
      showToast("Dashboard aggiornata");
    } catch (err) {
      showToast(err.message || "Refresh fallito", "bad");
    }
  });
  $("exportChatBtn")?.addEventListener("click", async () => {
    if (!state.threadId) {
      showToast("Nessuna chat Atlas da esportare", "warn");
      return;
    }
    const { messages } = await api(`/api/chat/threads/${state.threadId}`);
    const text = (messages || [])
      .map((m) => `${chatExportRole(m.role)}: ${presentChatText(m.content || "", m.role)}`)
      .join("\n\n");
    downloadText(`chat-thread-${state.threadId}.txt`, text || "(empty)");
    showToast("Conversazione Atlas esportata");
  });
  window.addEventListener("keydown", (e) => {
    const tag = (e.target?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable) return;
    if (e.key >= "1" && e.key <= "4") {
      if (moduleSwitchLocked) return;
      const mod = MODULES[Number(e.key) - 1];
      if (mod) showModule(mod);
      return;
    }
    if (e.key === "r" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      refresh().then(() => showToast("Dashboard aggiornata"));
      return;
    }
    // Map zoom keys — work on every map altitude (orbit → street), not voice-only.
    const zoomInKey = e.key === "+" || e.key === "=" || e.code === "Equal" || e.key === "Add" || e.code === "NumpadAdd";
    const zoomOutKey = e.key === "-" || e.key === "_" || e.key === "Subtract" || e.code === "Minus" || e.code === "NumpadSubtract";
    if ((zoomInKey || zoomOutKey) && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const runZoom = () => {
        if (getViewer()) {
          const h = zoomByFactor(zoomInKey ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR);
          showToast(`${zoomInKey ? "ZOOM +" : "ZOOM −"}${h ? ` · ${formatAlt(h)}` : ""}`);
          return;
        }
        // Three.js map / pipeline / memory: move camera along the look vector
        if (state.camera && state.controls) {
          const cam = state.camera;
          const target = state.controls.target;
          const dir = cam.position.clone().sub(target);
          dir.multiplyScalar(zoomInKey ? 0.7 : 1.45);
          cam.position.copy(target.clone().add(dir));
          state.controls.update?.();
          showToast(zoomInKey ? "ZOOM +" : "ZOOM −");
          return;
        }
        showToast("Vista non pronta per lo zoom", "warn");
      };
      // Prefer staying on the current module if it already has a camera; else open map.
      if (getViewer() || (state.camera && state.controls)) {
        runZoom();
      } else {
        showModule("map").then(runZoom);
      }
      return;
    }
    if ((e.key === "0" || e.key === "Home") && state.module === "map" && getViewer()) {
      e.preventDefault();
      zoomToHeight(HOME_VIEW.height, { duration: 1.2 });
      showToast("ZOOM · home orbit");
      return;
    }
    if ((e.key === "c" || e.key === "C") && state.module === "map" && state.focusedTopId) {
      e.preventDefault();
      submitCorrection(state.focusedTopId, "correct");
    } else if ((e.key === "i" || e.key === "I") && state.module === "map" && state.focusedTopId) {
      e.preventDefault();
      submitCorrection(state.focusedTopId, "incorrect");
    }
  });
  $("mapPickAnalyze")?.addEventListener("click", () => {
    const title =
      state.lastMapPick?.top?.title ||
      state.lastMapPick?.title ||
      $("mapPickTitle")?.textContent ||
      "";
    if (title && title !== "—") openChatAnalyze(title);
  });
  $("mapPickCompare")?.addEventListener("click", () => {
    if (state.lastMapPick?.top) pinCompare(state.lastMapPick.top);
  });
  $("compareClear")?.addEventListener("click", () => clearCompare());
  $("logoutBtn").onclick = async () => {
    await fetch("/logout", { method: "POST", credentials: "same-origin" }).catch(() => {});
    window.location.href = "/login";
  };

  const searchForm = $("mapSearchForm");
  if (searchForm) {
    searchForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const q = $("mapSearchInput")?.value?.trim();
      if (!q) return;
      try {
        const hit = await searchPlace(q);
        if (!hit) {
          $("mapPickCard").hidden = false;
          $("mapPickTitle").textContent = "No results";
          $("mapPickDetail").textContent = q;
        }
      } catch (err) {
        $("mapPickCard").hidden = false;
        $("mapPickTitle").textContent = "Search failed";
        $("mapPickDetail").textContent = err.message || "Try again";
      }
    });
  }
  $("mapNorthBtn")?.addEventListener("click", () => resetNorth());
  $("mapOrbitBtn")?.addEventListener("click", () => {
    const t0 = state.snapshot?.tops?.[0];
    flyToTop(
      Number.isFinite(t0?.lon) ? t0.lon : 12.5,
      Number.isFinite(t0?.lat) ? t0.lat : 30,
      12_000_000,
    );
  });
  wireHoloPlancia();
  wireTopMenu();
  wireGestureShortcuts();
  wireModuleZoom();
  globalMicControl = setupMic($("globalMic"), (text) => {
    if (handleVoiceCommand(text)) return;
    // The call resumes when speak() reports playback ended, not on a fixed timer.
        return Promise.resolve(window.__opsAgentqHandle?.(text, { fromVoice: true })).then((handled) => {
      if (handled) return;
      // Do NOT auto-switch to chat module: that reloaded the whole thread (concordato +
      // first old user line like «Riassumi i top di oggi») over the plancia. Persist in
      // the background; show a toast; user opens CHAT deliberately when they want history.
      return sendChat(text, { voice: true }).then(() => {
        if (state.module !== "chat") showToast("In chiamata · risposta in corso", "ok");
      });
    });
  });
  window.__opsEndCall = () => globalMicControl?.endCall?.();
  // Same controller for chat MIC — avoids a second SpeechRecognition fighting the first
  const chatMic = $("chatMic");
  if (chatMic && globalMicControl?.attachButton) {
    globalMicControl.attachButton(chatMic);
  }
  tickUtcClock();
  setInterval(tickUtcClock, 1000);
  // Refresh whenever the dashboard is (re)opened: tab shown, network back, bfcache restore.
  const refreshOnOpen = (reason) => {
    const since = Date.now() - (state.lastUpdated?.getTime() || 0);
    if (since < 3000) return;
    document.body.dataset.lastOpenRefresh = reason;
    refresh({ silent: true }).catch(() => {});
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshOnOpen("visible");
  });
  window.addEventListener("online", () => refreshOnOpen("online"));
  // Initial load is handled by boot(); pageshow only matters for back/forward-cache restores.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) refreshOnOpen("pageshow");
  });
}

/** Gesture shortcuts: 2-finger swipe modules · 3-finger tap refresh · side pinch zoom */
function wireGestureShortcuts() {
  const root = $("app") || document.body;
  if (root.dataset.gesturesWired) return;
  root.dataset.gesturesWired = "1";
  let startX = 0;
  let startY = 0;
  let startDist = 0;
  let tracking = false;
  let blocked = false;

  const touchDist = (a, b) => {
    const dx = a.clientX - b.clientX;
    const dy = a.clientY - b.clientY;
    return Math.hypot(dx, dy);
  };

  const isGlobeGestureTarget = (el) =>
    Boolean(
      el?.closest?.(
        "#glCanvas, .cesium-viewer, .cesium-widget, .viewport, #viewport, canvas.cesium-widget-canvas",
      ),
    );

  root.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 3) {
        e.preventDefault();
        tracking = false;
        blocked = true;
        runHoloAction("refresh", { fromVoice: false });
        return;
      }
      // Side-panel pinch is module zoom, not a module swipe.
      if (e.target.closest?.("#sidePanel")) {
        tracking = false;
        blocked = true;
        return;
      }
      // Globe / map pinch-zoom must NEVER be reinterpreted as module navigation
      // (that was opening pipeline/memory/chat while the user zoomed the mappamondo).
      if (isGlobeGestureTarget(e.target) || state.module === "map") {
        tracking = false;
        blocked = true;
        return;
      }
      if (e.touches.length !== 2) {
        tracking = false;
        return;
      }
      blocked = false;
      tracking = true;
      startX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      startY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      startDist = touchDist(e.touches[0], e.touches[1]);
    },
    { passive: false },
  );
  root.addEventListener(
    "touchmove",
    (e) => {
      if (!tracking || blocked || e.touches.length !== 2) return;
      // Pinch (distance change) ≠ horizontal module swipe.
      const dist = touchDist(e.touches[0], e.touches[1]);
      if (Math.abs(dist - startDist) > 28) {
        tracking = false;
        blocked = true;
      }
    },
    { passive: true },
  );
  root.addEventListener(
    "touchend",
    (e) => {
      if (blocked) {
        if (e.touches.length === 0) blocked = false;
        tracking = false;
        return;
      }
      if (!tracking) return;
      tracking = false;
      if (e.changedTouches.length < 1) return;
      // Require a clear horizontal swipe using the gesture midpoint, not a single lifted finger
      // vs an old midpoint (pinch-zoom leftovers used to fire false module switches).
      if (e.touches.length > 0) return; // wait until both fingers are up
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) < 120 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
      const idx = MODULES.indexOf(state.module);
      const next = dx < 0 ? MODULES[(idx + 1) % MODULES.length] : MODULES[(idx - 1 + MODULES.length) % MODULES.length];
      runHoloAction(next, { fromVoice: false });
    },
    { passive: true },
  );
  root.addEventListener(
    "touchcancel",
    () => {
      tracking = false;
      blocked = false;
    },
    { passive: true },
  );
}

function wireModuleZoom() {
  const side = $("sidePanel");
  if (!side || side.dataset.zoomWired) return;
  side.dataset.zoomWired = "1";
  let scale = 1;
  const apply = () => {
    side.style.setProperty("--module-zoom", String(scale));
    side.dataset.zoomed = scale !== 1 ? "1" : "0";
  };
  side.addEventListener(
    "wheel",
    (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      scale = Math.min(1.85, Math.max(0.75, scale + (e.deltaY < 0 ? 0.08 : -0.08)));
      apply();
    },
    { passive: false },
  );
  let pinch0 = 0;
  side.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length !== 2) return;
      const a = e.touches[0];
      const b = e.touches[1];
      pinch0 = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    },
    { passive: true },
  );
  side.addEventListener(
    "touchmove",
    (e) => {
      if (e.touches.length !== 2 || !pinch0) return;
      const a = e.touches[0];
      const b = e.touches[1];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = d / pinch0;
      pinch0 = d;
      scale = Math.min(1.85, Math.max(0.75, scale * ratio));
      apply();
    },
    { passive: true },
  );
}

async function boot() {
  silenceVoice();
  document.documentElement.dataset.tts = "0";
  document.documentElement.dataset.micEngine = "";

  // Auto low-GPU profile + accent restore
  try {
    if (detectLowGpu()) document.documentElement.dataset.lowGpu = "1";
  } catch {
    /* ignore */
  }
  try {
    applyAccentTheme(localStorage.getItem(ACCENT_KEY) || "cyan");
  } catch {
    applyAccentTheme("cyan");
  }

  wireUi();
  // setupMic is inside wireUi. If /health arms desktop always-on, refreshSecretsStatus
  // calls armAlwaysOn() and does not open the mic until the first MIC tap.
  // Quadro 2D: wire panel controls only — opens from «Funzionamento plancia», not on home.
  wireFunctionBoardUi();
  window.__opsAtlasDigest = (line) => {
    if (!line) return;
    postChatUpdate(line, "ok", { trust: "auto", trustLine: "Affidabilità · AUTO · digest" });
    speak(String(line).replace(/\s+/g, " ").slice(0, 420), { ifUnlocked: true, yieldToCall: true });
  };
  wireCockpitUi();
  wireMemoryGraphUi();
  window.addEventListener("ops:function-board-report", () => {
    noteAiFunctionReports([{ type: "report-function" }]);
  });

  // Restore last view when present; otherwise map
  const last = readLastView();
  const fromHash = moduleFromHash();
  const initial = fromHash || last?.module || "map";
  state.module = MODULES.includes(initial) ? initial : "map";
  if (last?.focusedTopId) state.focusedTopId = last.focusedTopId;
  syncHoloActive(state.module);
  flashHoloLabels(7000);

  const bootNote = (e, fallback) => {
    const msg = e?.message || fallback;
    showToast(msg, "warn");
    const legend = $("moduleLegend");
    if (legend) legend.textContent = `Load failed: ${msg}`;
  };
  try {
    await refresh();
  } catch (e) {
    bootNote(e, "Refresh fallito");
  }
  try {
    await initPaidAi();
    startAutoSystems();
    maybeVoiceOnboarding();
    saveLastView(state.module);
  } catch (e) {
    bootNote(e, "Avvio plancia incompleto");
  }
  // Ingress updates must run even when dashboard refresh was rate-limited.
  try {
    await wireAgentqUi({
      postChatUpdate,
      showToast,
      runHoloAction,
      speak,
      module: () => state.module,
      restoreModule: !fromHash && !last?.module,
      applyModule: (mod) => showModule(mod),
    });
  } catch (e) {
    bootNote(e, "Atlas non collegato");
    postChatUpdate(`Atlas ingresso fallito: ${e?.message || e}`, "warn");
  }
}

boot();
