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

function initThree(container) {
  disposeScene();
  const w = container.clientWidth || 800;
  const h = container.clientHeight || 500;
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x070a0f, 0.035);
  const camera = new THREE.PerspectiveCamera(48, w / h, 0.1, 200);
  camera.position.set(0, 2.2, 6.5);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.setClearColor(0x070a0f, 1);
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = 2.2;
  controls.maxDistance = 18;
  const amb = new THREE.AmbientLight(0x6688aa, 0.55);
  const dir = new THREE.DirectionalLight(0x3dd6ff, 0.85);
  dir.position.set(4, 8, 2);
  scene.add(amb, dir);
  const root = new THREE.Group();
  scene.add(root);
  state.scene = scene;
  state.camera = camera;
  state.renderer = renderer;
  state.controls = controls;
  state.rootGroup = root;

  const onResize = () => {
    if (!state.renderer) return;
    const nw = container.clientWidth;
    const nh = container.clientHeight;
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
    renderer.setSize(nw, nh);
  };
  window.addEventListener("resize", onResize);

  const tick = () => {
    state.animId = requestAnimationFrame(tick);
    if (state.rootGroup) state.rootGroup.rotation.y += 0.0015;
    controls.update();
    renderer.render(scene, camera);
  };
  tick();
  return root;
}

function buildMap(root, tops) {
  // Dark military satellite globe
  const globeGeo = new THREE.SphereGeometry(1.8, 64, 64);
  const globeMat = new THREE.MeshStandardMaterial({
    color: 0x0b1a14,
    emissive: 0x0a2a1a,
    emissiveIntensity: 0.35,
    metalness: 0.4,
    roughness: 0.7,
    wireframe: false,
  });
  const globe = new THREE.Mesh(globeGeo, globeMat);
  root.add(globe);

  const wire = new THREE.Mesh(
    new THREE.SphereGeometry(1.82, 36, 18),
    new THREE.MeshBasicMaterial({ color: 0x1f4a3a, wireframe: true, transparent: true, opacity: 0.35 })
  );
  root.add(wire);

  const grid = new THREE.Mesh(
    new THREE.SphereGeometry(1.85, 24, 12),
    new THREE.MeshBasicMaterial({ color: 0x3dd6ff, wireframe: true, transparent: true, opacity: 0.12 })
  );
  root.add(grid);

  const fallbackLatLon = [
    [41.9, 12.5], [40.7, -74], [35.7, 139.7], [51.5, -0.1],
    [22.3, 114.2], [-33.9, 18.4], [55.7, 37.6], [1.3, 103.8],
  ];
  (tops || []).slice(0, 8).forEach((t, i) => {
    const lat = Number.isFinite(t.lat) ? t.lat : fallbackLatLon[i % fallbackLatLon.length][0];
    const lon = Number.isFinite(t.lon) ? t.lon : fallbackLatLon[i % fallbackLatLon.length][1];
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lon + 180) * (Math.PI / 180);
    const r = 1.9;
    const x = -r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.cos(phi);
    const z = r * Math.sin(phi) * Math.sin(theta);
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.05 + (t.score || 0.5) * 0.06, 12, 12),
      new THREE.MeshBasicMaterial({ color: t.verified ? 0x3dff9a : 0xffc14a })
    );
    marker.position.set(x, y, z);
    root.add(marker);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.008, 0.008, 0.35, 6),
      new THREE.MeshBasicMaterial({ color: 0x3dd6ff, transparent: true, opacity: 0.55 })
    );
    beam.position.set(x, y + 0.2, z);
    root.add(beam);
  });
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

function makeSprite(text) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(7,10,15,0.75)";
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = "#d7e0ea";
  ctx.font = "22px IBM Plex Sans";
  ctx.fillText(text.slice(0, 22), 10, 40);
  const tex = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const spr = new THREE.Sprite(mat);
  spr.scale.set(1.2, 0.3, 1);
  return spr;
}

function buildMemory(root, concepts, links) {
  // 5D: x,y,z spatial + hue(time/recency) + size(importance)
  const pos = {};
  (concepts || []).forEach((c, i) => {
    const angle = (i / Math.max(concepts.length, 1)) * Math.PI * 2;
    const r = 1.2 + (c.importance || 0.5);
    const x = Math.cos(angle) * r;
    const y = ((c.recency || 0.5) - 0.5) * 3;
    const z = Math.sin(angle) * r * 0.85;
    pos[c.id] = new THREE.Vector3(x, y, z);
    const hue = 0.45 + (c.dimension || 0) * 0.08;
    const color = new THREE.Color().setHSL(hue, 0.65, 0.55);
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.12 + (c.importance || 0.4) * 0.2, 1),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, metalness: 0.2, roughness: 0.45 })
    );
    mesh.position.copy(pos[c.id]);
    root.add(mesh);
  });
  (links || []).forEach((l) => {
    const a = pos[l.from];
    const b = pos[l.to];
    if (!a || !b) return;
    const geo = new THREE.BufferGeometry().setFromPoints([a, b]);
    root.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x7f8b9a, transparent: true, opacity: 0.45 })));
  });
  // ring axes suggesting 5th dim (time ring)
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(2.4, 0.02, 8, 64),
    new THREE.MeshBasicMaterial({ color: 0x3dd6ff, transparent: true, opacity: 0.25 })
  );
  ring.rotation.x = Math.PI / 2.4;
  root.add(ring);
  state.camera.position.set(0, 2.5, 7.5);
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
    const root = initThree(gl);
    if (mod === "map") {
      $("moduleLegend").textContent = "Map · 3D satellite · dark military";
      buildMap(root, snap.tops);
    } else if (mod === "pipeline") {
      $("moduleLegend").textContent = "Pipeline · 3D graph · zoomable";
      buildPipeline(root, snap.pipeline?.nodes, snap.pipeline?.edges);
    } else if (mod === "memory") {
      $("moduleLegend").textContent = "Memory · 5D rotatable graph";
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
