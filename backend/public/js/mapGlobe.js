/**
 * Interactive tactical globe (Cesium): 5-level LOD, dark-ops styling,
 * drag/zoom, pick + hover, Nominatim search, compass/reset-north.
 * Public tiles only — no Palantir assets. No API key required for base features.
 */

const CESIUM_VER = "1.125.0";
const CESIUM_BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VER}/Build/Cesium`;
const NOMINATIM = "https://nominatim.openstreetmap.org";

let cesiumPromise = null;
let viewer = null;
let heightTick = null;
let orbitTick = null;
let onLodCallback = null;
let onSelectCallback = null;
let hoverEntity = null;
let selectEntity = null;
let userInteracting = false;
let idleTimer = null;
let topsCache = [];

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(s);
  });
}

function loadCss(href) {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = href;
  document.head.appendChild(l);
}

export function ensureCesium() {
  if (window.Cesium) return Promise.resolve(window.Cesium);
  if (cesiumPromise) return cesiumPromise;
  loadCss(`${CESIUM_BASE}/Widgets/widgets.css`);
  window.CESIUM_BASE_URL = `${CESIUM_BASE}/`;
  cesiumPromise = loadScript(`${CESIUM_BASE}/Cesium.js`).then(() => {
    if (!window.Cesium) throw new Error("Cesium global missing");
    return window.Cesium;
  });
  return cesiumPromise;
}

export function lodFromHeight(meters) {
  if (meters > 4_500_000) {
    return { level: 1, key: "continent", label: "L1 CONTINENT / ORBIT", detail: "macro regions" };
  }
  if (meters > 900_000) {
    return { level: 2, key: "country", label: "L2 COUNTRY / REGION", detail: "borders · states" };
  }
  if (meters > 80_000) {
    return { level: 3, key: "city", label: "L3 CITY / METRO", detail: "urban fabric" };
  }
  if (meters > 4_000) {
    return { level: 4, key: "streets", label: "L4 STREETS / BLOCKS", detail: "roads · parcels" };
  }
  return { level: 5, key: "detail", label: "L5 STREET DETAIL", detail: "max tile LOD" };
}

function applyDarkOpsImagery(layer) {
  layer.brightness = 1.12;
  layer.contrast = 1.22;
  layer.gamma = 1.02;
  layer.saturation = 0.8;
}

function buildImagery(Cesium, v) {
  v.imageryLayers.removeAll();
  const sat = v.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      maximumLevel: 19,
      credit: "Esri World Imagery (public)",
    }),
  );
  applyDarkOpsImagery(sat);

  const ref = v.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      maximumLevel: 16,
      credit: "Esri Boundaries",
    }),
  );
  ref.alpha = 0.7;

  const roads = v.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
      maximumLevel: 19,
      credit: "Esri Transportation",
    }),
  );
  roads.alpha = 0;
  roads._opsRole = "roads";

  const osm = v.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      maximumLevel: 19,
      credit: "© OpenStreetMap",
    }),
  );
  osm.alpha = 0;
  osm._opsRole = "osm";

  return { sat, ref, roads, osm };
}

function setOverlayByLod(v, lod) {
  const layers = v.imageryLayers;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers.get(i);
    const role = layer._opsRole;
    if (role === "roads") {
      if (lod.level >= 5) layer.alpha = 0.85;
      else if (lod.level === 4) layer.alpha = 0.7;
      else if (lod.level === 3) layer.alpha = 0.25;
      else layer.alpha = 0;
    }
    if (role === "osm") {
      if (lod.level >= 5) layer.alpha = 0.35;
      else if (lod.level === 4) layer.alpha = 0.18;
      else layer.alpha = 0;
    }
  }
}

function addTopEntities(Cesium, v, tops) {
  // Keep hover/select helpers; clear data entities
  const keep = new Set([hoverEntity, selectEntity].filter(Boolean));
  const doomed = [];
  for (const e of v.entities.values) {
    if (!keep.has(e)) doomed.push(e);
  }
  doomed.forEach((e) => v.entities.remove(e));

  topsCache = (tops || []).slice(0, 12);
  topsCache.forEach((t, i) => {
    const lat = Number.isFinite(t.lat) ? t.lat : 20 - i * 8;
    const lon = Number.isFinite(t.lon) ? t.lon : -40 + i * 28;
    const verified = Boolean(t.verified);
    const color = verified
      ? Cesium.Color.fromCssColorString("#3dff9a")
      : Cesium.Color.fromCssColorString("#ffc14a");

    v.entities.add({
      id: `top-${t.id || i}`,
      name: t.title || t.id,
      properties: {
        kind: "top",
        topId: t.id,
        score: t.score,
        region: t.region,
        source: t.source,
        lat,
        lon,
      },
      position: Cesium.Cartesian3.fromDegrees(lon, lat),
      point: {
        pixelSize: 14 + (t.score || 0.5) * 10,
        color: Cesium.Color.WHITE,
        outlineColor: color,
        outlineWidth: 4,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(1.5e3, 1.55, 8.0e6, 0.65),
      },
      label: {
        text: t.title || t.id,
        font: "650 13px IBM Plex Sans, sans-serif",
        fillColor: Cesium.Color.fromCssColorString("#f2f6fa"),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 4,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
        scaleByDistance: new Cesium.NearFarScalar(2.0e3, 1.05, 6.0e6, 0.2),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#0a1018").withAlpha(0.9),
        backgroundPadding: new Cesium.Cartesian2(8, 5),
      },
      description: `${t.region || ""} · score ${Math.round((t.score || 0) * 100)}%`,
    });

    if (i < topsCache.length - 1 && (t.score || 0) > 0.7 && (topsCache[i + 1].score || 0) > 0.7) {
      const n = topsCache[i + 1];
      const lat2 = Number.isFinite(n.lat) ? n.lat : lat;
      const lon2 = Number.isFinite(n.lon) ? n.lon : lon + 20;
      v.entities.add({
        id: `arc-${i}`,
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArray([lon, lat, lon2, lat2]),
          width: 1.5,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.25,
            color: Cesium.Color.fromCssColorString("#3dd6ff").withAlpha(0.75),
          }),
          arcType: Cesium.ArcType.GEODESIC,
        },
      });
    }
  });
}

function setEntityPos(Cesium, entity, lon, lat) {
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || !entity) return false;
  const cart = Cesium.Cartesian3.fromDegrees(lon, lat);
  if (!Cesium.defined(cart)) return false;
  entity.position = new Cesium.ConstantPositionProperty(cart);
  return true;
}

function ensureHoverSelect(Cesium, v) {
  // Never park entities at Cartesian3.ZERO (earth center) — breaks ENU / ellipse math.
  const safePos = Cesium.Cartesian3.fromDegrees(12.5, 30.0);
  if (!hoverEntity) {
    hoverEntity = v.entities.add({
      id: "hover-ring",
      show: false,
      position: safePos,
      ellipse: {
        semiMajorAxis: 120000,
        semiMinorAxis: 120000,
        material: Cesium.Color.fromCssColorString("#3dd6ff").withAlpha(0.18),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#3dd6ff").withAlpha(0.85),
        outlineWidth: 2,
        height: 1,
        heightReference: Cesium.HeightReference.NONE,
      },
    });
  }
  if (!selectEntity) {
    selectEntity = v.entities.add({
      id: "select-ring",
      show: false,
      position: safePos,
      ellipse: {
        semiMajorAxis: 180000,
        semiMinorAxis: 180000,
        material: Cesium.Color.fromCssColorString("#ffc14a").withAlpha(0.2),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#ffc14a"),
        outlineWidth: 2,
        height: 1,
        heightReference: Cesium.HeightReference.NONE,
      },
      label: {
        text: "",
        font: "650 13px IBM Plex Sans, sans-serif",
        fillColor: Cesium.Color.WHITE,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#0a1018").withAlpha(0.92),
        pixelOffset: new Cesium.Cartesian2(0, -36),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
  }
}

function ringSizeForHeight(heightM) {
  if (heightM > 4e6) return 650000;
  if (heightM > 9e5) return 280000;
  if (heightM > 8e4) return 60000;
  if (heightM > 4e3) return 8000;
  return 1200;
}

function pickCartesian(Cesium, v, windowPosition) {
  if (
    !windowPosition ||
    !Cesium.defined(windowPosition) ||
    !Number.isFinite(windowPosition.x) ||
    !Number.isFinite(windowPosition.y)
  ) {
    return { picked: undefined, cartesian: null };
  }
  try {
    const scene = v.scene;
    const picked = scene.pick(windowPosition);
    let cartesian = null;
    if (Cesium.defined(picked) && picked.id?.position) {
      const pos = picked.id.position.getValue?.(v.clock.currentTime);
      if (Cesium.defined(pos)) cartesian = pos;
    }
    if (!Cesium.defined(cartesian)) {
      const ray = v.camera.getPickRay(windowPosition);
      if (Cesium.defined(ray)) {
        const hit = scene.globe.pick(ray, scene);
        if (Cesium.defined(hit)) cartesian = hit;
      }
    }
    return { picked, cartesian: Cesium.defined(cartesian) ? cartesian : null };
  } catch {
    return { picked: undefined, cartesian: null };
  }
}

async function reverseGeocode(lat, lon) {
  const url = `${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=10&addressdetails=1`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "Accept-Language": "en" },
  });
  if (!res.ok) throw new Error("reverse geocode failed");
  return res.json();
}

export async function searchPlace(query) {
  if (!viewer || !window.Cesium || !query?.trim()) return null;
  const Cesium = window.Cesium;
  const url = `${NOMINATIM}/search?format=jsonv2&q=${encodeURIComponent(query.trim())}&limit=1&addressdetails=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("search failed");
  const rows = await res.json();
  if (!rows?.length) return null;
  const hit = rows[0];
  const lon = Number(hit.lon);
  const lat = Number(hit.lat);
  const bb = hit.boundingbox?.map(Number);
  userInteracting = true;
  if (bb && bb.length === 4) {
    const [south, north, west, east] = bb;
    await viewer.camera.flyTo({
      destination: Cesium.Rectangle.fromDegrees(west, south, east, north),
      duration: 1.8,
    });
  } else {
    await viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, 250000),
      duration: 1.8,
    });
  }
  showSelection(Cesium, {
    lon,
    lat,
    title: hit.display_name?.split(",")[0] || query,
    detail: hit.display_name || "",
    kind: "search",
  });
  scheduleIdleResume();
  return hit;
}

function showSelection(Cesium, { lon, lat, title, detail, kind, top }) {
  if (!selectEntity || !viewer) return;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
  const h = viewer.camera.positionCartographic?.height || 1e6;
  const r = ringSizeForHeight(h);
  if (!setEntityPos(Cesium, selectEntity, lon, lat)) return;
  selectEntity.ellipse.semiMajorAxis = new Cesium.ConstantProperty(r);
  selectEntity.ellipse.semiMinorAxis = new Cesium.ConstantProperty(r);
  selectEntity.label.text = title || "";
  selectEntity.show = true;
  const payload = {
    kind: kind || "place",
    title,
    detail,
    lat,
    lon,
    top: top || null,
  };
  onSelectCallback?.(payload);
}

export function resetNorth() {
  if (!viewer || !window.Cesium) return;
  const Cesium = window.Cesium;
  const carto = viewer.camera.positionCartographic;
  if (!carto) return;
  userInteracting = true;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, carto.height),
    orientation: {
      heading: 0,
      pitch: viewer.camera.pitch,
      roll: 0,
    },
    duration: 0.85,
  });
  scheduleIdleResume();
}

export function flyToTop(lon, lat, height = 25000) {
  if (!viewer || !window.Cesium) return;
  userInteracting = true;
  viewer.camera.flyTo({
    destination: window.Cesium.Cartesian3.fromDegrees(lon, lat, height),
    duration: 2.0,
  });
  scheduleIdleResume();
}

function scheduleIdleResume() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    userInteracting = false;
  }, 5000);
}

function wireInteraction(Cesium, v) {
  const handler = new Cesium.ScreenSpaceEventHandler(v.scene.canvas);
  v._opsHandler = handler;

  const markInteract = () => {
    userInteracting = true;
    scheduleIdleResume();
  };

  handler.setInputAction(markInteract, Cesium.ScreenSpaceEventType.LEFT_DOWN);
  handler.setInputAction(markInteract, Cesium.ScreenSpaceEventType.RIGHT_DOWN);
  handler.setInputAction(markInteract, Cesium.ScreenSpaceEventType.MIDDLE_DOWN);
  handler.setInputAction(markInteract, Cesium.ScreenSpaceEventType.WHEEL);
  handler.setInputAction(markInteract, Cesium.ScreenSpaceEventType.PINCH_START);

  // Hover highlight (guard undefined endPosition — common on iPad)
  handler.setInputAction((movement) => {
    try {
      if (!hoverEntity) return;
      const pos = movement?.endPosition || movement?.startPosition;
      const { picked, cartesian } = pickCartesian(Cesium, v, pos);
      if (!cartesian) {
        hoverEntity.show = false;
        v.canvas.style.cursor = "grab";
        return;
      }
      const carto = Cesium.Cartographic.fromCartesian(cartesian);
      if (!Cesium.defined(carto)) return;
      const lon = Cesium.Math.toDegrees(carto.longitude);
      const lat = Cesium.Math.toDegrees(carto.latitude);
      const h = v.camera.positionCartographic?.height || 1e6;
      const r = ringSizeForHeight(h) * 0.85;
      if (!setEntityPos(Cesium, hoverEntity, lon, lat)) return;
      hoverEntity.ellipse.semiMajorAxis = new Cesium.ConstantProperty(r);
      hoverEntity.ellipse.semiMinorAxis = new Cesium.ConstantProperty(r);
      hoverEntity.show = true;
      const kind =
        picked?.id?.properties?.kind?.getValue?.(v.clock.currentTime) ??
        picked?.id?.properties?.kind;
      v.canvas.style.cursor = kind === "top" ? "pointer" : "crosshair";
    } catch (err) {
      console.warn("hover pick skipped", err);
      if (hoverEntity) hoverEntity.show = false;
    }
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

  // Click / tap select
  handler.setInputAction(async (click) => {
    markInteract();
    const pos = click?.position;
    const { picked, cartesian } = pickCartesian(Cesium, v, pos);
    if (!cartesian) return;
    const carto = Cesium.Cartographic.fromCartesian(cartesian);
    if (!Cesium.defined(carto)) return;
    const lon = Cesium.Math.toDegrees(carto.longitude);
    const lat = Cesium.Math.toDegrees(carto.latitude);

    const propVal = (p, key) => {
      if (!p || p[key] == null) return undefined;
      const v = p[key];
      return typeof v?.getValue === "function" ? v.getValue(viewer.clock.currentTime) : v;
    };
    if (picked?.id && propVal(picked.id.properties, "kind") === "top") {
      const props = picked.id.properties;
      const title = picked.id.name;
      const score = propVal(props, "score") || 0;
      const detail = `${propVal(props, "region") || ""} · score ${Math.round(score * 100)}%`;
      showSelection(Cesium, {
        lon: propVal(props, "lon") ?? lon,
        lat: propVal(props, "lat") ?? lat,
        title,
        detail,
        kind: "top",
        top: topsCache.find((t) => t.id === propVal(props, "topId")),
      });
      return;
    }

    try {
      const geo = await reverseGeocode(lat, lon);
      const addr = geo.address || {};
      const title =
        addr.city ||
        addr.town ||
        addr.village ||
        addr.municipality ||
        addr.state ||
        addr.country ||
        geo.name ||
        "Location";
      const detail = geo.display_name || `${lat.toFixed(3)}, ${lon.toFixed(3)}`;
      showSelection(Cesium, {
        lon,
        lat,
        title,
        detail,
        kind: "place",
      });
    } catch {
      showSelection(Cesium, {
        lon,
        lat,
        title: `${lat.toFixed(2)}°, ${lon.toFixed(2)}°`,
        detail: "Reverse geocode unavailable",
        kind: "coords",
      });
    }
  }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function startLodWatcher(Cesium, v) {
  stopLodWatcher();
  let lastLevel = -1;
  const tick = () => {
    if (!viewer || viewer.isDestroyed?.()) return;
    const carto = viewer.camera.positionCartographic;
    if (carto) {
      const h = carto.height;
      const lod = lodFromHeight(h);
      if (lod.level !== lastLevel) {
        lastLevel = lod.level;
        setOverlayByLod(viewer, lod);
        onLodCallback?.(lod, h);
      }
      // Scale selection rings with altitude
      if (selectEntity?.show && selectEntity.ellipse) {
        const r = ringSizeForHeight(h);
        selectEntity.ellipse.semiMajorAxis = r;
        selectEntity.ellipse.semiMinorAxis = r;
      }
    }
    heightTick = requestAnimationFrame(tick);
  };
  heightTick = requestAnimationFrame(tick);
}

function stopLodWatcher() {
  if (heightTick) cancelAnimationFrame(heightTick);
  heightTick = null;
}

/** Slow orbital drift so the globe never looks like a frozen still. */
function startOrbitDrift(Cesium, v) {
  stopOrbitDrift();
  const tick = () => {
    if (!viewer || viewer.isDestroyed?.()) return;
    try {
      if (!userInteracting && Cesium.defined(v.camera?.positionWC)) {
        // Rotate about world Z only when camera position is valid
        v.camera.rotate(Cesium.Cartesian3.UNIT_Z, -0.00035);
      }
    } catch (err) {
      console.warn("orbit drift skipped", err);
    }
    orbitTick = requestAnimationFrame(tick);
  };
  orbitTick = requestAnimationFrame(tick);
}

function stopOrbitDrift() {
  if (orbitTick) cancelAnimationFrame(orbitTick);
  orbitTick = null;
}

export async function mountMapGlobe(container, { tops, onLod, onSelect } = {}) {
  onLodCallback = onLod || null;
  onSelectCallback = onSelect || null;
  const Cesium = await ensureCesium();

  if (viewer && !viewer.isDestroyed?.() && viewer.container === container) {
    addTopEntities(Cesium, viewer, tops);
    return viewer;
  }

  destroyMapGlobe();
  onLodCallback = onLod || null;
  onSelectCallback = onSelect || null;

  container.innerHTML = "";
  container.classList.add("cesium-ops");

  const viewerOpts = {
    animation: false,
    timeline: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: true,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    infoBox: true,
    selectionIndicator: true,
    shouldAnimate: true,
    requestRenderMode: false,
    orderIndependentTranslucency: true,
    contextOptions: { webgl: { alpha: false } },
  };
  if ("baseLayer" in (Cesium.Viewer.defaultOptions || {}) || Cesium.VERSION) {
    viewerOpts.baseLayer = false;
  } else {
    viewerOpts.imageryProvider = false;
  }

  viewer = new Cesium.Viewer(container, viewerOpts);
  hoverEntity = null;
  selectEntity = null;

  // Soften Cesium crash panel; log instead of hard-stopping UX when possible
  if (viewer.cesiumWidget) {
    viewer.cesiumWidget.showErrorPanel = (title, message, error) => {
      console.error("[cesium]", title, message, error);
    };
  }
  viewer.scene.rethrowRenderErrors = false;

  // Live render loop + sun motion (avoids "frozen still" look)
  viewer.clock.shouldAnimate = true;
  viewer.clock.multiplier = 1;
  viewer.useDefaultRenderLoop = true;
  viewer.scene.requestRenderMode = false;
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#05080d");
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#05080d");
  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.atmosphereLightIntensity = 5.0;
  viewer.scene.globe.atmosphereBrightnessShift = -0.12;
  viewer.scene.fog.enabled = true;
  viewer.scene.fog.density = 8.0e-5;

  const ctrl = viewer.scene.screenSpaceCameraController;
  ctrl.minimumZoomDistance = 120;
  ctrl.maximumZoomDistance = 2.8e7;
  ctrl.enableCollisionDetection = true;
  ctrl.inertiaSpin = 0.9;
  ctrl.inertiaTranslate = 0.9;
  ctrl.inertiaZoom = 0.8;
  ctrl.zoomEventTypes = [
    Cesium.CameraEventType.WHEEL,
    Cesium.CameraEventType.PINCH,
  ];
  ctrl.rotateEventTypes = [Cesium.CameraEventType.LEFT_DRAG];
  ctrl.tiltEventTypes = [
    Cesium.CameraEventType.RIGHT_DRAG,
    Cesium.CameraEventType.PINCH,
    {
      eventType: Cesium.CameraEventType.LEFT_DRAG,
      modifier: Cesium.KeyboardEventModifier.CTRL,
    },
  ];

  buildImagery(Cesium, viewer);
  ensureHoverSelect(Cesium, viewer);
  addTopEntities(Cesium, viewer, tops);
  wireInteraction(Cesium, viewer);

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(12.5, 28.0, 14_000_000),
  });

  // Force layout after CSS settles (iPad / tunnel)
  requestAnimationFrame(() => {
    try {
      viewer.resize();
      viewer.scene.requestRender();
    } catch {
      /* ignore */
    }
  });

  startLodWatcher(Cesium, viewer);
  startOrbitDrift(Cesium, viewer);
  const initial = lodFromHeight(14_000_000);
  setOverlayByLod(viewer, initial);
  onLodCallback?.(initial, 14_000_000);

  viewer.homeButton.viewModel.command.beforeExecute.addEventListener((e) => {
    e.cancel = true;
    userInteracting = true;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(12.5, 42.0, 12_000_000),
      orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
      duration: 1.6,
    });
    scheduleIdleResume();
  });

  viewer.canvas.style.cursor = "grab";
  return viewer;
}

export function destroyMapGlobe() {
  stopLodWatcher();
  stopOrbitDrift();
  clearTimeout(idleTimer);
  onLodCallback = null;
  onSelectCallback = null;
  hoverEntity = null;
  selectEntity = null;
  topsCache = [];
  if (viewer && !viewer.isDestroyed?.()) {
    try {
      viewer._opsHandler?.destroy?.();
      viewer.destroy();
    } catch {
      /* ignore */
    }
  }
  viewer = null;
}

export function getViewer() {
  return viewer;
}
