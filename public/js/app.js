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
} from "./mapGlobe.js?v=holo-pack-6";

const BUILD_ID = "inventory-6";
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

function axisLine(from, to, color, opacity = 0.55) {
  const geo = new THREE.BufferGeometry().setFromPoints([from, to]);
  return new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity }));
}

function buildMemory(root, concepts, links) {
  // 5D encoding:
  // x = topic axis, y = reliability/importance, z = evidence cluster,
  // color hue = semantic dimension (0..4), size = importance, orbit ring = recency
  state.memoryMeshes = new Map();
  state.memoryLinks = links || [];
  const frame = new THREE.Group();
  root.add(frame);

  const L = 3.2;
  frame.add(axisLine(new THREE.Vector3(-L, 0, 0), new THREE.Vector3(L, 0, 0), 0x3dd6ff, 0.45));
  frame.add(axisLine(new THREE.Vector3(0, -L, 0), new THREE.Vector3(0, L, 0), 0x3dff9a, 0.45));
  frame.add(axisLine(new THREE.Vector3(0, 0, -L), new THREE.Vector3(0, 0, L), 0xffc14a, 0.4));
  // 4th/5th suggested as tilted rings (not a lone flat circle)
  const ringA = new THREE.Mesh(
    new THREE.TorusGeometry(2.6, 0.015, 10, 96),
    new THREE.MeshBasicMaterial({ color: 0x7aa7ff, transparent: true, opacity: 0.28 }),
  );
  ringA.rotation.set(Math.PI / 2.7, 0.35, 0.2);
  frame.add(ringA);
  const ringB = new THREE.Mesh(
    new THREE.TorusGeometry(2.1, 0.012, 10, 96),
    new THREE.MeshBasicMaterial({ color: 0xff7ab8, transparent: true, opacity: 0.22 }),
  );
  ringB.rotation.set(0.4, Math.PI / 3, 0.8);
  frame.add(ringB);

  ["topic", "reliability", "cluster", "dimension", "recency"].forEach((name, i) => {
    const spr = makeSprite(`D${i + 1}:${name}`, true);
    const a = (i / 5) * Math.PI * 2;
    spr.position.set(Math.cos(a) * 3.1, Math.sin(a * 0.7) * 1.4, Math.sin(a) * 3.1);
    frame.add(spr);
  });

  const list = concepts?.length
    ? concepts
    : [
        { id: "1", label: "revenue", importance: 0.8, recency: 0.7, dimension: 0 },
        { id: "2", label: "supply", importance: 0.6, recency: 0.4, dimension: 1 },
        { id: "3", label: "filing", importance: 0.9, recency: 0.85, dimension: 2 },
      ];

  const pos = {};
  list.forEach((c, i) => {
    const dim = Number(c.dimension ?? i % 5);
    const imp = Number(c.importance ?? 0.5);
    const rec = Number(c.recency ?? 0.5);
    // Spread in volume (avoid planar ring)
    const x = ((i % 3) - 1) * 1.5 + (dim - 2) * 0.35 + (Math.sin(i * 2.1) * 0.55);
    const y = (imp - 0.5) * 4.2 + Math.cos(i * 1.7) * 0.35;
    const z = (rec - 0.5) * 4.0 + ((i % 2) * 0.8 - 0.4) + Math.sin(dim + i) * 0.5;
    pos[c.id] = new THREE.Vector3(x, y, z);

    const hue = 0.08 + dim * 0.14;
    const color = new THREE.Color().setHSL(hue, 0.7, 0.55);
    const radius = 0.14 + imp * 0.22;
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(radius, 1),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.45,
        metalness: 0.25,
        roughness: 0.35,
      }),
    );
    mesh.position.copy(pos[c.id]);
    mesh.userData = {
      pickable: true,
      kind: "memory-concept",
      concept: c,
      linked: (links || []).filter((l) => l.from === c.id || l.to === c.id),
    };
    frame.add(mesh);
    state.memoryMeshes.set(c.id, mesh);
    state.pulse.push({ mesh, phase: i * 0.7, baseX: 1, baseY: 1 });

    // Recency halo (5th dim)
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.55, 0.012, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x3dd6ff, transparent: true, opacity: 0.25 + rec * 0.45 }),
    );
    halo.position.copy(pos[c.id]);
    halo.lookAt(0, 0, 0);
    frame.add(halo);

    const label = makeSprite(c.label || c.id, true);
    label.position.copy(pos[c.id].clone().add(new THREE.Vector3(0, radius + 0.22, 0)));
    frame.add(label);
  });

  state.memoryLinks = links || [];
  (links || []).forEach((l) => {
    const a = pos[l.from];
    const b = pos[l.to];
    if (!a || !b) return;
    const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, 0.35, 0));
    const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
    const geo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
    frame.add(
      new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x8fa0b3, transparent: true, opacity: 0.55 })),
    );
  });

  state.camera.position.set(4.8, 3.2, 6.4);
  state.controls.target.set(0, 0, 0);
  state.controls.minDistance = 3;
  state.controls.maxDistance = 16;
  state.autoRotate = true;
  state.pickHandler = (data) => {
    if (data?.kind === "memory-concept") orbitMemoryConcept(data.concept, data.linked);
  };
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
  showToast("Chat pronta · analizza");
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

function orbitMemoryConcept(concept, linked) {
  if (!concept || !state.controls) return;
  const mesh = state.memoryMeshes.get(concept.id);
  if (mesh) {
    // Pull selected concept toward origin (orbit center)
    mesh.position.lerp(new THREE.Vector3(0, 0.4, 0), 0.85);
    state.controls.target.copy(mesh.position);
    state.camera.position.set(mesh.position.x + 2.8, mesh.position.y + 1.6, mesh.position.z + 3.2);
  }
  const linkIds = new Set();
  (linked || []).forEach((l) => {
    if (l.from !== concept.id) linkIds.add(l.from);
    if (l.to !== concept.id) linkIds.add(l.to);
  });
  state.pulse.forEach((p) => {
    const id = p.mesh?.userData?.concept?.id;
    if (id === concept.id || linkIds.has(id)) {
      p.baseX = 1.55;
      p.baseY = 1.55;
    } else {
      p.baseX = 0.85;
      p.baseY = 0.85;
    }
  });
  const body = $("sideBody");
  if (body) {
    let panel = body.querySelector(".inspect-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "card inspect-panel";
      body.prepend(panel);
    }
    const defs = [...linkIds]
      .map((id) => state.snapshot?.memory?.concepts?.find((c) => c.id === id))
      .filter(Boolean)
      .map((c) => `· ${c.label || c.id} (dim ${c.dimension ?? "—"})`)
      .join("<br/>");
    panel.innerHTML = `<strong>Memory · ${escapeHtml(concept.label || concept.id)}</strong>
      <div class="muted">importanza ${(concept.importance || 0).toFixed(2)} · recency ${(concept.recency || 0).toFixed(2)}</div>
      <div class="muted">${defs || "Nessun link diretto"}</div>`;
  }
  showToast(`Orbita · ${concept.label || concept.id}`);
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
  document.querySelectorAll("#holoVoicePlancia .holo-node").forEach((node) => {
    const a = node.getAttribute("data-holo-action");
    node.classList.toggle("is-active", a === mod || a === actionOrModule);
  });
}

function speak(text) {
  const synth = window.speechSynthesis;
  const line = String(text || "").trim();
  if (!synth || !line) return;
  try {
    synth.cancel();
    const utter = new SpeechSynthesisUtterance(line.slice(0, 420));
    utter.lang = "it-IT";
    utter.rate = 1.02;
    utter.volume = 0.9;
    synth.speak(utter);
  } catch {
    /* TTS unavailable */
  }
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
    "Benvenuto nella plancia. Di’ MAPPA, PIPELINE, MEMORY o CHAT.",
    "Di’ ORBIT, NORD o ZOOM CITTÀ per il globo. Di’ ANALIZZA per la chat.",
    "Di’ AGGIORNA per i dati freschi. Di’ FILTRO o COVERAGE per i controlli mappa.",
  ];
  let i = 0;
  const step = () => {
    if (i >= lines.length) return;
    showToast(lines[i], "ok");
    speak(lines[i]);
    i += 1;
    setTimeout(step, 3200);
  };
  setTimeout(step, 900);
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
  lastView: readLastView(),
  globe: getGlobeState(),
});

window.__opsVoice = (text) => handleVoiceCommand(text);
window.__opsRun = (action) => runHoloAction(action, { fromVoice: false });

/** Dual control: same actions for voice keywords and holographic touch targets. */
function runHoloAction(action, { fromVoice = false } = {}) {
  const t0 = state.focusedTopId
    ? findTop(state.focusedTopId)
    : state.snapshot?.tops?.[0];
  const lon = Number.isFinite(t0?.lon) ? t0.lon : 12.5;
  const lat = Number.isFinite(t0?.lat) ? t0.lat : 42;
  const src = fromVoice ? "voce" : "tocco";
  playHoloTick();
  if (fromVoice) {
    const label = document.querySelector(`.holo-node[data-holo-action="${action}"] .holo-label`);
    speak(label?.textContent || String(action).replace(/-/g, " "));
  }

  switch (action) {
    case "map":
      syncHoloActive("map");
      return showModule("map").then(() => {
        saveLastView("map");
        showToast(`MAPPA · ${src}`);
      });
    case "pipeline":
      syncHoloActive("pipeline");
      return showModule("pipeline").then(() => {
        saveLastView("pipeline");
        showToast(`PIPELINE · ${src}`);
      });
    case "memory":
      syncHoloActive("memory");
      return showModule("memory").then(() => {
        saveLastView("memory");
        showToast(`MEMORY · ${src}`);
      });
    case "chat":
      syncHoloActive("chat");
      return showModule("chat").then(() => {
        saveLastView("chat");
        showToast(`CHAT · ${src}`);
      });
    case "mic":
      $("globalMic")?.click();
      showToast(`MIC · ${src}`);
      return Promise.resolve();
    case "orbit":
      return showModule("map").then(() => {
        flyToTop(lon, lat, HOME_VIEW.height);
        setOrbitEnabled(true);
        syncHoloActive("orbit");
        showToast(`ORBIT · ${src}`);
      });
    case "nord":
      return showModule("map").then(() => {
        resetNorth();
        syncHoloActive("nord");
        showToast(`NORD · ${src}`);
      });
    case "zoom-citta":
      return showModule("map").then(() => {
        flyToTop(lon, lat, CITY_FLY_HEIGHT);
        syncHoloActive("zoom-citta");
        showToast(`ZOOM CITTÀ · ${src}`);
      });
    case "zoom-paese":
      return showModule("map").then(() => {
        flyToTop(lon, lat, 1_500_000);
        showToast(`ZOOM PAESE · ${src}`);
      });
    case "zoom-continente":
      return showModule("map").then(() => {
        flyToTop(lon, lat, 12_000_000);
        showToast(`ZOOM CONTINENTE · ${src}`);
      });
    case "analizza": {
      const title =
        state.lastMapPick?.top?.title ||
        state.lastMapPick?.title ||
        t0?.title ||
        "questa azienda";
      syncHoloActive("analizza");
      return openChatAnalyze(title).then(() => showToast(`ANALIZZA · ${src}`));
    }
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
    case "strumenti": {
      const on = setToolsOpen();
      showToast(`STRUMENTI ${on ? "ON" : "OFF"} · ${src}`);
      return Promise.resolve();
    }
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
  const lower = String(text || "").toLowerCase().trim();
  const rules = [
    [/aggiorna|refresh|ricalcola/, "refresh"],
    [/filtro\s*(score|punti)|score\s*75|filtro alto/, "filtro-score"],
    [/filtri?\s*(off|reset|tutti)|reset filtri/, "filtro-reset"],
    [/coverage|copertura|scrub/, "coverage-next"],
    [/confronta|compare/, "confronta"],
    [/fly|vola|vai l[iì]/, "fly"],
    [/(zoom\s*)?citt[aà]|city/, "zoom-citta"],
    [/zoom\s*paese|country/, "zoom-paese"],
    [/zoom\s*continente|continente/, "zoom-continente"],
    [/orbit|orbita/, "orbit"],
    [/nord|north/, "nord"],
    [/\bmappa\b|\bmap\b|globo/, "map"],
    [/pipeline/, "pipeline"],
    [/memory|memoria/, "memory"],
    [/analizza|analyze/, "analizza"],
    [/\bchat\b|assistente/, "chat"],
    [/\bmic\b|microfono|ascolta/, "mic"],
    [/strumenti|controlli|tools/, "strumenti"],
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
  host.querySelectorAll(".holo-node").forEach((node) => {
    const hx = parseFloat(node.style.getPropertyValue("--hx")) || 0;
    if (hx > 58) node.classList.add("label-flip");
  });
  host.addEventListener("click", (e) => {
    const node = e.target.closest(".holo-node[data-holo-action]");
    if (!node) return;
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
    zoomHelp.innerHTML = `<div class="muted">Globo a zoom fisso: usa i salti qui, «zoom città», «orbit», «nord» o Fly sul top.</div>
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
    title.textContent = "Memory 5D · concepts";
    const hint = document.createElement("div");
    hint.className = "card muted";
    hint.textContent = "Clicca un concetto 3D per centrarlo e pulsare i collegati.";
    body.appendChild(hint);
    (snap.memory?.concepts || []).forEach((c) => {
      const el = document.createElement("div");
      el.className = "card";
      el.innerHTML = `<div class="row"><strong>${escapeHtml(c.label || c.id)}</strong><span class="mono">i${(c.importance || 0).toFixed(2)}</span></div>
        <div class="muted">dim ${c.dimension ?? "—"} · recency ${(c.recency || 0).toFixed(2)}</div>`;
      el.addEventListener("click", () => {
        const linked = (snap.memory?.links || []).filter((l) => l.from === c.id || l.to === c.id);
        orbitMemoryConcept(c, linked);
      });
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
  disposeScene();
  destroyMapGlobe();
  const gl = $("glCanvas");
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
  if (hud) hud.hidden = isChat;
  if (pickCard && !isMap) pickCard.hidden = true;
  const compare = $("compareStrip");
  if (compare && !isMap) compare.hidden = true;
  else if (isMap) updateCompareStrip();
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
      setExclusivePanels(mod);

      if (mod === "chat") {
        $("moduleLegend").textContent = "Chat · saved history · voice";
        sideForModule(mod, snap);
        await loadChat();
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
        $("moduleLegend").textContent = "Pipeline · 3D graph · zoomable";
        const root = initThree(gl, { autoRotate: false, minDistance: 3, maxDistance: 22 });
        buildPipeline(root, snap.pipeline?.nodes, snap.pipeline?.edges);
        if (!stillCurrent(epoch, mod)) {
          disposeScene();
          return;
        }
      } else if (mod === "memory") {
        $("moduleLegend").textContent = "Memory · 5D rotatable graph · drag / scroll";
        const root = initThree(gl, { autoRotate: true, minDistance: 3, maxDistance: 18 });
        buildMemory(root, snap.memory?.concepts, snap.memory?.links);
        if (!stillCurrent(epoch, mod)) {
          disposeScene();
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

async function loadChat() {
  await ensureChatModelSelect();
  renderChatSuggestions();
  const { threads } = await api("/api/chat/threads");
  const list = $("threadList");
  list.innerHTML = "";
  const neu = document.createElement("button");
  neu.className = "pill-btn primary";
  neu.textContent = "New";
  neu.onclick = async () => {
    const t = await api("/api/chat/threads", { method: "POST", body: JSON.stringify({ title: "Session" }) });
    state.threadId = t.id;
    showToast("Nuova sessione chat");
    await loadChat();
  };
  list.appendChild(neu);
  (threads || []).forEach((t) => {
    const b = document.createElement("button");
    b.className = "pill-btn" + (t.id === state.threadId ? " primary" : "");
    b.textContent = t.title || t.id;
    b.onclick = async () => {
      state.threadId = t.id;
      await loadChat();
    };
    list.appendChild(b);
  });
  if (!state.threadId && threads?.[0]) state.threadId = threads[0].id;
  const msgs = $("messageList");
  msgs.innerHTML = "";
  if (!state.threadId) return;
  const { messages } = await api(`/api/chat/threads/${state.threadId}`);
  (messages || []).forEach((m) => {
    const d = document.createElement("div");
    d.className = `bubble ${m.role}`;
    d.textContent = m.content;
    msgs.appendChild(d);
  });
  msgs.scrollTop = msgs.scrollHeight;
}

async function sendChat(text, { voice = false } = {}) {
  if (!text.trim()) return;
  if (!state.threadId) {
    const t = await api("/api/chat/threads", { method: "POST", body: JSON.stringify({ title: "Session" }) });
    state.threadId = t.id;
  }
  await ensureChatModelSelect();
  const model = getSelectedChatModel();
  try {
    await api(`/api/chat/threads/${state.threadId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content: text, model }),
    });
    $("chatInput").value = "";
    await loadChat();
    if (voice) {
      const replies = document.querySelectorAll("#messageList .bubble.assistant");
      const last = replies[replies.length - 1];
      if (last?.textContent) speak(last.textContent);
    }
  } catch (err) {
    showToast(err.message || "Chat fallita", "bad");
  }
}

function setupMic(button, onText) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    button.title = "Speech recognition not supported in this browser";
    return;
  }
  const rec = new SR();
  rec.continuous = false;
  rec.interimResults = false;
  rec.lang = "it-IT";
  rec.onresult = (ev) => {
    const text = ev.results[0][0].transcript;
    onText(text);
  };
  rec.onend = () => {
    state.micLive = false;
    button.classList.remove("live");
    document.body.classList.remove("mic-live");
  };
  button.addEventListener("click", () => {
    if (state.micLive) {
      rec.stop();
      return;
    }
    state.micLive = true;
    button.classList.add("live");
    document.body.classList.add("mic-live");
    try {
      rec.start();
    } catch {
      state.micLive = false;
      button.classList.remove("live");
      document.body.classList.remove("mic-live");
    }
  });
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
    await sendChat(text);
  };
  $("sendChat")?.addEventListener("click", submitAnalizza);
  $("chatInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submitAnalizza();
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
      showToast("Nessun thread da esportare", "warn");
      return;
    }
    const { messages } = await api(`/api/chat/threads/${state.threadId}`);
    const text = (messages || [])
      .map((m) => `${(m.role || "msg").toUpperCase()}: ${m.content || ""}`)
      .join("\n\n");
    downloadText(`chat-thread-${state.threadId}.txt`, text || "(empty)");
    showToast("Chat esportata");
  });
  window.addEventListener("keydown", (e) => {
    const tag = (e.target?.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable) return;
    if (e.key >= "1" && e.key <= "4") {
      if (moduleSwitchLocked) return;
      const mod = MODULES[Number(e.key) - 1];
      if (mod) showModule(mod);
    } else if (e.key === "r" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      refresh().then(() => showToast("Dashboard aggiornata"));
    } else if ((e.key === "c" || e.key === "C") && state.module === "map" && state.focusedTopId) {
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
  setupMic($("globalMic"), (text) => {
    if (handleVoiceCommand(text)) return;
    // Fallback: free-form → chat, then speak the assistant reply
    runHoloAction("chat", { fromVoice: true }).then(() => sendChat(text, { voice: true }));
  });
  const chatMic = $("chatMic");
  if (chatMic) {
    setupMic(chatMic, (text) => {
      $("chatInput").value = text;
      sendChat(text);
    });
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
  let tracking = false;
  root.addEventListener(
    "touchstart",
    (e) => {
      if (e.touches.length === 3) {
        e.preventDefault();
        runHoloAction("refresh", { fromVoice: false });
        return;
      }
      // Side-panel pinch is module zoom, not a module swipe.
      if (e.target.closest?.("#sidePanel")) return;
      if (e.touches.length !== 2) return;
      tracking = true;
      startX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      startY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    },
    { passive: false },
  );
  root.addEventListener(
    "touchend",
    (e) => {
      if (!tracking) return;
      tracking = false;
      if (e.changedTouches.length < 1) return;
      // Approximate end midpoint from remaining/changed touches
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy)) return;
      const idx = MODULES.indexOf(state.module);
      const next = dx < 0 ? MODULES[(idx + 1) % MODULES.length] : MODULES[(idx - 1 + MODULES.length) % MODULES.length];
      runHoloAction(next, { fromVoice: false });
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

  // Restore last view when present; otherwise map
  const last = readLastView();
  const fromHash = moduleFromHash();
  const initial = fromHash || last?.module || "map";
  state.module = MODULES.includes(initial) ? initial : "map";
  if (last?.focusedTopId) state.focusedTopId = last.focusedTopId;
  syncHoloActive(state.module);
  flashHoloLabels(7000);

  try {
    // Always refresh latest data on open
    await refresh();
    startAutoSystems();
    maybeVoiceOnboarding();
    saveLastView(state.module);
  } catch (e) {
    $("moduleLegend").textContent = `Load failed: ${e.message}`;
  }
}

boot();
