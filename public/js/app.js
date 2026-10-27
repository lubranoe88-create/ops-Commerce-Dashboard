import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { destroyMapGlobe, mountMapGlobe } from "./mapGlobe.js";

const state = {
  module: "map",
  snapshot: null,
  threadId: null,
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
};

const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
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
  el.className = `health ${healthClass(health.status)}`;
  el.textContent = `HEALTH ${String(health.status || "—").toUpperCase()}`;
  $("footerRight").textContent = `errs ${health.openErrors ?? 0} · thr ${(health.verificationThreshold ?? 0.72) * 100 | 0}% · cov ${Math.round((health.coverageAvg ?? 0) * 100)}%`;
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
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(w, h, false);
  renderer.setClearColor(0x05080d, 1);
  container.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style, { width: "100%", height: "100%", display: "block" });

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = minDistance;
  controls.maxDistance = maxDistance;
  controls.rotateSpeed = 0.65;
  controls.zoomSpeed = 0.9;
  controls.addEventListener("start", () => {
    state.autoRotate = false;
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
    if (state.autoRotate && state.rootGroup) state.rootGroup.rotation.y += 0.0022;
    for (const p of state.pulse) {
      const s = 1 + Math.sin(t * 0.004 + p.phase) * 0.18;
      p.mesh.scale.setScalar(s);
      if (p.mat) p.mat.opacity = 0.35 + (Math.sin(t * 0.004 + p.phase) + 1) * 0.2;
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
 * Gotham/AIP-like dark ops grade: near-black oceans, muted continents,
 * hairline cyan graticule. Public Blue Marble only — no Palantir tiles.
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

  // Optional topo modulate for continental relief read
  if (topoTex?.image) {
    ctx.globalCompositeOperation = "overlay";
    ctx.globalAlpha = 0.35;
    ctx.drawImage(topoTex.image, 0, 0, w, h);
    ctx.globalAlpha = 1;
  }

  // Crush to near-black COP grade
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  for (let i = 0; i < px.length; i += 4) {
    let r = px[i];
    let g = px[i + 1];
    let b = px[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    // Oceans (low green relative / blue-dominant low lum) → near black with teal whisper
    const isOcean = lum < 78 && b >= g * 0.92;
    if (isOcean) {
      px[i] = 4 + lum * 0.04;
      px[i + 1] = 8 + lum * 0.06;
      px[i + 2] = 12 + lum * 0.1;
    } else {
      // Continents: desaturate, darken, keep relief
      const des = lum;
      r = des * 0.28 + r * 0.12;
      g = des * 0.34 + g * 0.18;
      b = des * 0.26 + b * 0.1;
      // Lift ridges slightly
      const lift = Math.max(0, lum - 90) * 0.15;
      px[i] = Math.min(255, r * 0.55 + 18 + lift);
      px[i + 1] = Math.min(255, g * 0.62 + 28 + lift * 1.1);
      px[i + 2] = Math.min(255, b * 0.5 + 22 + lift * 0.7);
    }
  }
  ctx.putImageData(data, 0, 0);

  // Soft teal grade pass
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "rgba(70, 110, 105, 0.55)";
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";

  // Hairline graticule baked into albedo (screen-space thin)
  ctx.strokeStyle = "rgba(90, 190, 220, 0.11)";
  ctx.lineWidth = Math.max(1, w / 2200);
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
  // Equator / prime slightly stronger
  ctx.strokeStyle = "rgba(61, 214, 255, 0.2)";
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
    color: 0x5ec8e6,
    transparent: true,
    opacity: 0.14,
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
  const g = ctx.createRadialGradient(64, 64, 8, 64, 64, 60);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.18, color);
  g.addColorStop(0.45, color.replace(")", ",0.35)").replace("rgb", "rgba"));
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(64, 64, 28, 0, Math.PI * 2);
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
    color: 0xc5d0cc,
    metalness: 0.12,
    roughness: 0.88,
    bumpMap: maps.topo || null,
    bumpScale: maps.topo ? 0.085 : 0,
    displacementMap: maps.topo || null,
    displacementScale: maps.topo ? 0.028 : 0,
    emissiveMap: maps.night || null,
    emissive: maps.night ? new THREE.Color(0x1c4a5c) : new THREE.Color(0x050a0c),
    emissiveIntensity: maps.night ? 1.05 : 0.15,
  });

  const globe = new THREE.Mesh(new THREE.SphereGeometry(R, 160, 160), mat);
  root.add(globe);

  // Near-black oceans with faint cyan specular glow (water mask)
  if (maps.water) {
    root.add(
      new THREE.Mesh(
        new THREE.SphereGeometry(R * 1.0012, 128, 128),
        new THREE.MeshStandardMaterial({
          map: maps.water,
          color: 0x020608,
          transparent: true,
          opacity: 0.55,
          metalness: 0.92,
          roughness: 0.18,
          emissive: new THREE.Color(0x0a2a33),
          emissiveIntensity: 0.22,
          depthWrite: false,
        }),
      ),
    );
  }

  // Thin atmosphere — Palantir-like subtle limb glow
  root.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.028, 64, 64),
      new THREE.MeshBasicMaterial({
        color: 0x4db8d4,
        transparent: true,
        opacity: 0.07,
        side: THREE.BackSide,
        depthWrite: false,
      }),
    ),
  );
  root.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(R * 1.07, 48, 48),
      new THREE.MeshBasicMaterial({
        color: 0x0d3a48,
        transparent: true,
        opacity: 0.045,
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
    const scale = 0.28 + (t.score || 0.5) * 0.22;
    ring.scale.set(scale, scale, 1);
    ring.position.copy(pos);
    root.add(ring);
    state.pulse.push({ mesh: ring, phase: i });

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
}

function makeSprite(text, compact = false) {
  const canvas = document.createElement("canvas");
  canvas.width = compact ? 320 : 256;
  canvas.height = compact ? 48 : 64;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(5,10,16,0.72)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(61,214,255,0.35)";
  ctx.strokeRect(0.5, 0.5, canvas.width - 1, canvas.height - 1);
  ctx.fillStyle = "#d7e0ea";
  ctx.font = compact ? "20px IBM Plex Sans" : "22px IBM Plex Sans";
  ctx.fillText(String(text).slice(0, compact ? 28 : 22), 10, compact ? 30 : 40);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(compact ? 1.05 : 1.2, compact ? 0.16 : 0.3, 1);
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
    frame.add(mesh);
    state.pulse.push({ mesh, phase: i * 0.7 });

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
}

function sideForModule(mod, snap) {
  const body = $("sideBody");
  const title = $("sideTitle");
  body.innerHTML = "";
  if (mod === "map") {
    title.textContent = "Daily tops · correct";
    (snap.tops || []).forEach((t) => {
      const el = document.createElement("div");
      el.className = "card";
      el.innerHTML = `
        <div class="row"><strong>${escapeHtml(t.title)}</strong><span class="mono">${Math.round((t.score || 0) * 100)}%</span></div>
        <div class="muted">${escapeHtml(t.region || "")} · ${escapeHtml(t.source || "")}</div>
        <input type="text" placeholder="Correction note (optional)" data-note="${t.id}" />
        <div class="actions">
          <button class="pill-btn" data-correct="1" data-id="${t.id}">Correct</button>
          <button class="pill-btn" data-correct="0" data-id="${t.id}">Incorrect</button>
        </div>`;
      body.appendChild(el);
    });
    body.querySelectorAll("[data-correct]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const note = body.querySelector(`input[data-note="${id}"]`)?.value || "";
        await api("/api/corrections", {
          method: "POST",
          body: JSON.stringify({
            targetType: "top",
            targetId: id,
            verdict: btn.getAttribute("data-correct") === "1" ? "correct" : "incorrect",
            note,
          }),
        });
        await refresh();
      });
    });
    // Zoom affordances for 5-level LOD globe
    const zoomHelp = document.createElement("div");
    zoomHelp.className = "card";
    zoomHelp.innerHTML = `<strong>5D zoom</strong>
      <div class="muted">Scroll: orbita → continente → paese → città → strade → dettaglio. Tile satellitari fino a Z19 + overlay vie.</div>
      <div class="actions" id="lodJumps"></div>`;
    body.appendChild(zoomHelp);
    const jumps = [
      ["Continente", 12_000_000],
      ["Paese", 1_500_000],
      ["Città", 80_000],
      ["Strade", 8_000],
      ["Dettaglio", 600],
    ];
    const box = zoomHelp.querySelector("#lodJumps");
    jumps.forEach(([label, h]) => {
      const b = document.createElement("button");
      b.className = "pill-btn";
      b.textContent = label;
      b.onclick = () => {
        if (!window.Cesium) return;
        const v = window.Cesium;
        // fly relative to first top or Europe
        const t0 = (state.snapshot?.tops || [])[0];
        const lon = Number.isFinite(t0?.lon) ? t0.lon : 12.5;
        const lat = Number.isFinite(t0?.lat) ? t0.lat : 42;
        import("./mapGlobe.js").then(({ flyToTop }) => flyToTop(lon, lat, h));
      };
      box.appendChild(b);
    });
  } else if (mod === "pipeline") {
    title.textContent = "Pipeline · errors";
    (snap.pipeline?.nodes || []).forEach((n) => {
      const el = document.createElement("div");
      el.className = "card";
      el.innerHTML = `<div class="row"><strong>${escapeHtml(n.label || n.id)}</strong><span class="mono">${escapeHtml(n.health || "—")}</span></div>
        <div class="muted">${escapeHtml(n.kind || "")}</div>`;
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
    (snap.memory?.concepts || []).forEach((c) => {
      const el = document.createElement("div");
      el.className = "card";
      el.innerHTML = `<div class="row"><strong>${escapeHtml(c.label || c.id)}</strong><span class="mono">i${(c.importance || 0).toFixed(2)}</span></div>
        <div class="muted">dim ${c.dimension ?? "—"} · recency ${(c.recency || 0).toFixed(2)}</div>`;
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

async function showModule(mod) {
  state.module = mod;
  document.querySelectorAll("#moduleNav button").forEach((b) => {
    b.classList.toggle("active", b.dataset.module === mod);
  });
  const chatPanel = $("chatPanel");
  const gl = $("glCanvas");
  const snap = state.snapshot || {};
  if (mod === "chat") {
    disposeScene();
    destroyMapGlobe();
    gl.hidden = true;
    chatPanel.hidden = false;
    $("moduleLegend").textContent = "Chat · saved history · voice";
    await loadChat();
  } else {
    chatPanel.hidden = true;
    gl.hidden = false;
    if (mod === "map") {
      // Progressive 5-level LOD satellite globe (Cesium). Falls back to Three.js Blue Marble.
      disposeScene();
      $("moduleLegend").textContent = "Map · loading 5-level satellite LOD…";
      try {
        await mountMapGlobe(gl, {
          tops: snap.tops,
          onLod: (lod, heightM) => {
            if (state.module !== "map") return;
            const km = heightM > 1000 ? `${(heightM / 1000).toFixed(0)} km` : `${Math.round(heightM)} m`;
            $("moduleLegend").textContent = `GLOBE 5D ZOOM · ${lod.label} · alt ${km}`;
            $("coverageMini").textContent = `${lod.detail} · scroll to descend · L${lod.level}/5`;
          },
        });
        state.mapEngine = "cesium";
      } catch (err) {
        console.warn("Cesium LOD globe failed, Three.js fallback", err);
        state.mapEngine = "three";
        destroyMapGlobe();
        gl.innerHTML = "";
        $("moduleLegend").textContent = "Map · Three.js satellite fallback…";
        const root = initThree(gl, { autoRotate: true, minDistance: 2.6, maxDistance: 12 });
        await buildMap(root, snap.tops);
      }
    } else if (mod === "pipeline") {
      destroyMapGlobe();
      gl.innerHTML = "";
      $("moduleLegend").textContent = "Pipeline · 3D graph · zoomable";
      const root = initThree(gl, { autoRotate: false, minDistance: 3, maxDistance: 22 });
      buildPipeline(root, snap.pipeline?.nodes, snap.pipeline?.edges);
    } else if (mod === "memory") {
      destroyMapGlobe();
      gl.innerHTML = "";
      $("moduleLegend").textContent = "Memory · 5D rotatable graph · drag / scroll";
      const root = initThree(gl, { autoRotate: true, minDistance: 3, maxDistance: 18 });
      buildMemory(root, snap.memory?.concepts, snap.memory?.links);
    }
  }
  sideForModule(mod, snap);
  if (mod !== "map") renderCoverageMini(snap.coverage);
  if (snap.health) setHealth(snap.health);
}

async function refresh() {
  const snap = await api("/api/dashboard/snapshot");
  state.snapshot = snap;
  await showModule(state.module);
}

async function loadChat() {
  const { threads } = await api("/api/chat/threads");
  const list = $("threadList");
  list.innerHTML = "";
  const neu = document.createElement("button");
  neu.className = "pill-btn primary";
  neu.textContent = "New";
  neu.onclick = async () => {
    const t = await api("/api/chat/threads", { method: "POST", body: JSON.stringify({ title: "Session" }) });
    state.threadId = t.id;
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

async function sendChat(text) {
  if (!text.trim()) return;
  if (!state.threadId) {
    const t = await api("/api/chat/threads", { method: "POST", body: JSON.stringify({ title: "Session" }) });
    state.threadId = t.id;
  }
  await api(`/api/chat/threads/${state.threadId}/messages`, {
    method: "POST",
    body: JSON.stringify({ content: text }),
  });
  $("chatInput").value = "";
  await loadChat();
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
  rec.lang = "en-US";
  rec.onresult = (ev) => {
    const text = ev.results[0][0].transcript;
    onText(text);
  };
  rec.onend = () => {
    state.micLive = false;
    button.classList.remove("live");
  };
  button.addEventListener("click", () => {
    if (state.micLive) {
      rec.stop();
      return;
    }
    state.micLive = true;
    button.classList.add("live");
    rec.start();
  });
}

function wireUi() {
  $("moduleNav").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-module]");
    if (!btn) return;
    showModule(btn.dataset.module);
  });
  $("sendChat").onclick = () => sendChat($("chatInput").value);
  $("chatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendChat($("chatInput").value);
  });
  $("logoutBtn").onclick = async () => {
    await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => {});
    window.location.href = "/login";
  };
  setupMic($("globalMic"), (text) => {
    const lower = text.toLowerCase();
    if (lower.includes("map")) showModule("map");
    else if (lower.includes("pipeline")) showModule("pipeline");
    else if (lower.includes("memory")) showModule("memory");
    else if (lower.includes("chat")) {
      showModule("chat").then(() => sendChat(text));
    } else {
      showModule("chat").then(() => sendChat(text));
    }
  });
  setupMic($("chatMic"), (text) => {
    $("chatInput").value = text;
    sendChat(text);
  });
}

async function boot() {
  wireUi();
  try {
    await refresh();
  } catch (e) {
    $("moduleLegend").textContent = `Load failed: ${e.message}`;
  }
}

boot();
