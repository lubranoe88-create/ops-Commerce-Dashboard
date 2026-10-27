import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

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

/** Dark military “satellite” albedo painted procedurally (no external tiles). */
function makeSatelliteTexture() {
  const w = 2048;
  const h = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");

  // Ocean base
  const ocean = ctx.createLinearGradient(0, 0, 0, h);
  ocean.addColorStop(0, "#061018");
  ocean.addColorStop(0.5, "#0a1820");
  ocean.addColorStop(1, "#061018");
  ctx.fillStyle = ocean;
  ctx.fillRect(0, 0, w, h);

  // Speckle / sensor noise
  const img = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 10;
    img.data[i] = Math.max(0, img.data[i] + n);
    img.data[i + 1] = Math.max(0, img.data[i + 1] + n * 1.1);
    img.data[i + 2] = Math.max(0, img.data[i + 2] + n * 0.8);
  }
  ctx.putImageData(img, 0, 0);

  // Simplified landmass blobs (equirectangular-ish)
  const lands = [
    [0.18, 0.38, 0.14, 0.18], [0.28, 0.32, 0.1, 0.12], [0.48, 0.3, 0.22, 0.16],
    [0.62, 0.42, 0.16, 0.2], [0.72, 0.55, 0.08, 0.14], [0.12, 0.62, 0.08, 0.18],
    [0.38, 0.68, 0.1, 0.16], [0.82, 0.28, 0.12, 0.1], [0.55, 0.58, 0.07, 0.08],
  ];
  for (const [cx, cy, rw, rh] of lands) {
    const g = ctx.createRadialGradient(cx * w, cy * h, 0, cx * w, cy * h, Math.max(rw, rh) * w);
    g.addColorStop(0, "#1c3a2a");
    g.addColorStop(0.45, "#143024");
    g.addColorStop(1, "rgba(8,20,18,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx * w, cy * h, rw * w, rh * h, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Macro borders — cyan hairlines
  ctx.strokeStyle = "rgba(61,214,255,0.28)";
  ctx.lineWidth = 1.2;
  for (const [cx, cy, rw, rh] of lands) {
    ctx.beginPath();
    ctx.ellipse(cx * w, cy * h, rw * w * 0.92, rh * h * 0.92, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Lat/lon graticule
  ctx.strokeStyle = "rgba(61,214,255,0.12)";
  ctx.lineWidth = 1;
  for (let i = 1; i < 12; i++) {
    const y = (i / 12) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  for (let i = 1; i < 24; i++) {
    const x = (i / 24) * w;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  // Equator / prime stronger
  ctx.strokeStyle = "rgba(61,255,154,0.22)";
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(61,214,255,0.2)";
  ctx.beginPath();
  ctx.moveTo(w / 2, 0);
  ctx.lineTo(w / 2, h);
  ctx.stroke();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
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

function greatCirclePoints(a, b, radius, segments = 48) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const v = new THREE.Vector3().copy(a).lerp(b, t).normalize().multiplyScalar(radius);
    points.push(v);
  }
  return points;
}

function buildMap(root, tops) {
  const R = 1.85;
  const tex = makeSatelliteTexture();
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(R, 96, 96),
    new THREE.MeshStandardMaterial({
      map: tex,
      color: 0xffffff,
      metalness: 0.18,
      roughness: 0.82,
      emissive: 0x071510,
      emissiveIntensity: 0.25,
    }),
  );
  root.add(globe);

  // Atmosphere shells
  const atmo = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.035, 64, 64),
    new THREE.MeshBasicMaterial({
      color: 0x3dd6ff,
      transparent: true,
      opacity: 0.08,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  root.add(atmo);
  const atmo2 = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.08, 48, 48),
    new THREE.MeshBasicMaterial({
      color: 0x1a6a88,
      transparent: true,
      opacity: 0.045,
      side: THREE.BackSide,
      depthWrite: false,
    }),
  );
  root.add(atmo2);

  // Night terminator sheen
  const sheen = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.002, 64, 64),
    new THREE.MeshBasicMaterial({
      color: 0x3dff9a,
      transparent: true,
      opacity: 0.04,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    }),
  );
  root.add(sheen);

  const markers = [];
  (tops || []).slice(0, 10).forEach((t, i) => {
    const lat = Number.isFinite(t.lat) ? t.lat : (20 - i * 8);
    const lon = Number.isFinite(t.lon) ? t.lon : (-40 + i * 28);
    const pos = latLonToVec3(lat, lon, R * 1.02);
    const color = t.verified ? 0x3dff9a : 0xffc14a;

    const glowMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    });
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.09 + (t.score || 0.5) * 0.08, 16, 16), glowMat);
    glow.position.copy(pos);
    root.add(glow);
    state.pulse.push({ mesh: glow, mat: glowMat, phase: i });

    const core = new THREE.Mesh(
      new THREE.SphereGeometry(0.035 + (t.score || 0.5) * 0.03, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    core.position.copy(pos);
    root.add(core);

    // Beam along surface normal
    const normal = pos.clone().normalize();
    const beamLen = 0.45 + (t.score || 0.5) * 0.25;
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.004, beamLen, 8),
      new THREE.MeshBasicMaterial({ color: 0x3dd6ff, transparent: true, opacity: 0.7 }),
    );
    beam.position.copy(normal.clone().multiplyScalar(R * 1.02 + beamLen / 2));
    beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    root.add(beam);

    const label = makeSprite(t.title || t.id, true);
    label.position.copy(normal.clone().multiplyScalar(R * 1.02 + beamLen + 0.12));
    root.add(label);
    markers.push(pos);
  });

  // Great-circle links between consecutive tops
  for (let i = 0; i < markers.length - 1; i++) {
    const pts = greatCirclePoints(markers[i], markers[i + 1], R * 1.03, 40);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    root.add(
      new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: 0x3dd6ff, transparent: true, opacity: 0.35 }),
      ),
    );
  }

  state.camera.position.set(0, 1.15, 5.2);
  state.controls.target.set(0, 0, 0);
  state.controls.minDistance = 2.6;
  state.controls.maxDistance = 12;
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
    gl.hidden = true;
    chatPanel.hidden = false;
    $("moduleLegend").textContent = "Chat · saved history · voice";
    await loadChat();
  } else {
    chatPanel.hidden = true;
    gl.hidden = false;
    if (mod === "map") {
      $("moduleLegend").textContent = "Map · 3D satellite · dark military · drag to orbit";
      const root = initThree(gl, { autoRotate: true, minDistance: 2.6, maxDistance: 12 });
      buildMap(root, snap.tops);
    } else if (mod === "pipeline") {
      $("moduleLegend").textContent = "Pipeline · 3D graph · zoomable";
      const root = initThree(gl, { autoRotate: false, minDistance: 3, maxDistance: 22 });
      buildPipeline(root, snap.pipeline?.nodes, snap.pipeline?.edges);
    } else if (mod === "memory") {
      $("moduleLegend").textContent = "Memory · 5D rotatable graph · drag / scroll";
      const root = initThree(gl, { autoRotate: true, minDistance: 3, maxDistance: 18 });
      buildMemory(root, snap.memory?.concepts, snap.memory?.links);
    }
  }
  sideForModule(mod, snap);
  renderCoverageMini(snap.coverage);
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
