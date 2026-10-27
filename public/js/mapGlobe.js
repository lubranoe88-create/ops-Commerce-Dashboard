/**
 * Map globe with progressive 5-level LOD zoom (continent → country → city → streets → detail).
 * Public satellite tiles only (ArcGIS World Imagery + OSM/transport overlays). No Palantir assets.
 */

const CESIUM_VER = "1.125.0";
const CESIUM_BASE = `https://cdn.jsdelivr.net/npm/cesium@${CESIUM_VER}/Build/Cesium`;

let cesiumPromise = null;
let viewer = null;
let heightTick = null;
let onLodCallback = null;

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

/** 5 LOD bands driven by camera height above ellipsoid (meters). */
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

function applyDarkOpsImagery(Cesium, layer) {
  // Dark UI chrome, but landmasses must stay readable (raised vs prior crush)
  layer.brightness = 1.12;
  layer.contrast = 1.22;
  layer.gamma = 1.02;
  layer.saturation = 0.8;
}

function buildImagery(Cesium, viewer) {
  viewer.imageryLayers.removeAll();

  // Base: ArcGIS World Imagery (public tile endpoint, high zoom)
  const sat = viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      maximumLevel: 19,
      credit: "Esri World Imagery (public)",
    }),
  );
  applyDarkOpsImagery(Cesium, sat);

  // Soft reference boundaries (countries / admin)
  const ref = viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      maximumLevel: 16,
      credit: "Esri Boundaries",
    }),
  );
  ref.alpha = 0.7;

  // Transportation / streets — fades in as we descend (toggled by LOD watcher)
  const roads = viewer.imageryLayers.addImageryProvider(
    new Cesium.UrlTemplateImageryProvider({
      url: "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}",
      maximumLevel: 19,
      credit: "Esri Transportation",
    }),
  );
  roads.alpha = 0;
  roads._opsRole = "roads";

  // OSM label-ish fallback for street names at close range (optional overlay)
  const osm = viewer.imageryLayers.addImageryProvider(
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

function setOverlayByLod(viewer, lod) {
  const layers = viewer.imageryLayers;
  for (let i = 0; i < layers.length; i++) {
    const layer = layers.get(i);
    const role = layer._opsRole;
    if (role === "roads") {
      // Streets appear from L3, strong at L4–L5
      if (lod.level >= 5) layer.alpha = 0.85;
      else if (lod.level === 4) layer.alpha = 0.7;
      else if (lod.level === 3) layer.alpha = 0.25;
      else layer.alpha = 0;
    }
    if (role === "osm") {
      // OSM at closest zooms for road/place labels (semi-transparent over sat)
      if (lod.level >= 5) layer.alpha = 0.35;
      else if (lod.level === 4) layer.alpha = 0.18;
      else layer.alpha = 0;
    }
  }
}

function addTopEntities(Cesium, viewer, tops) {
  viewer.entities.removeAll();
  const list = (tops || []).slice(0, 12);
  list.forEach((t, i) => {
    const lat = Number.isFinite(t.lat) ? t.lat : 20 - i * 8;
    const lon = Number.isFinite(t.lon) ? t.lon : -40 + i * 28;
    const verified = Boolean(t.verified);
    const color = verified
      ? Cesium.Color.fromCssColorString("#3dff9a")
      : Cesium.Color.fromCssColorString("#ffc14a");

    viewer.entities.add({
      id: `top-${t.id || i}`,
      name: t.title || t.id,
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
        scaleByDistance: new Cesium.NearFarScalar(2.0e3, 1.05, 6.0e6, 0.15),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#0a1018").withAlpha(0.9),
        backgroundPadding: new Cesium.Cartesian2(8, 5),
      },
      description: `${t.region || ""} · score ${Math.round((t.score || 0) * 100)}%`,
    });

    // Great-circle style polyline to next top (high score only)
    if (i < list.length - 1 && (t.score || 0) > 0.7 && (list[i + 1].score || 0) > 0.7) {
      const lat2 = Number.isFinite(list[i + 1].lat) ? list[i + 1].lat : lat;
      const lon2 = Number.isFinite(list[i + 1].lon) ? list[i + 1].lon : lon + 20;
      viewer.entities.add({
        polyline: {
          positions: Cesium.Cartesian3.fromDegreesArrayHeights([
            lon,
            lat,
            0,
            lon2,
            lat2,
            0,
          ]),
          width: 1.5,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.25,
            color: Cesium.Color.fromCssColorString("#3dd6ff").withAlpha(0.75),
          }),
          arcType: Cesium.ArcType.GEODESIC,
          clampToGround: false,
        },
      });
    }
  });
}

function startLodWatcher(Cesium, viewer) {
  stopLodWatcher();
  let lastLevel = -1;
  heightTick = () => {
    if (!viewer || viewer.isDestroyed?.()) return;
    const carto = viewer.camera.positionCartographic;
    if (!carto) {
      heightTick = requestAnimationFrame(heightTick);
      return;
    }
    const h = carto.height;
    const lod = lodFromHeight(h);
    if (lod.level !== lastLevel) {
      lastLevel = lod.level;
      setOverlayByLod(viewer, lod);
      onLodCallback?.(lod, h);
    }
    heightTick = requestAnimationFrame(heightTick);
  };
  heightTick = requestAnimationFrame(heightTick);
}

function stopLodWatcher() {
  if (heightTick) {
    cancelAnimationFrame(heightTick);
    heightTick = null;
  }
}

export async function mountMapGlobe(container, { tops, onLod } = {}) {
  onLodCallback = onLod || null;
  const Cesium = await ensureCesium();

  // Reuse viewer if container matches
  if (viewer && !viewer.isDestroyed?.() && viewer.container === container) {
    addTopEntities(Cesium, viewer, tops);
    return viewer;
  }

  destroyMapGlobe();

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
    orderIndependentTranslucency: true,
    contextOptions: { webgl: { alpha: false } },
  };
  // Cesium 1.104+ uses baseLayer; older builds used imageryProvider
  if ("baseLayer" in Cesium.Viewer.defaultOptions || Cesium.VERSION) {
    viewerOpts.baseLayer = false;
  } else {
    viewerOpts.imageryProvider = false;
  }
  viewer = new Cesium.Viewer(container, viewerOpts);

  // Dark chrome — hide Cesium credits clutter slightly via CSS; keep attribution in HUD
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#05080d");
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#05080d");
  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.atmosphereLightIntensity = 3.0;
  viewer.scene.globe.atmosphereHueShift = -0.05;
  viewer.scene.globe.atmosphereSaturationShift = -0.2;
  viewer.scene.globe.atmosphereBrightnessShift = -0.25;
  viewer.scene.fog.enabled = true;
  viewer.scene.fog.density = 1.2e-4;
  if (viewer.scene.skyAtmosphere) {
    viewer.scene.skyAtmosphere.show = true;
    viewer.scene.skyAtmosphere.hueShift = -0.08;
    viewer.scene.skyAtmosphere.saturationShift = -0.15;
    viewer.scene.skyAtmosphere.brightnessShift = -0.2;
  }
  viewer.scene.screenSpaceCameraController.minimumZoomDistance = 80;
  viewer.scene.screenSpaceCameraController.maximumZoomDistance = 2.5e7;
  viewer.scene.screenSpaceCameraController.enableCollisionDetection = true;

  buildImagery(Cesium, viewer);
  addTopEntities(Cesium, viewer, tops);

  // Start from orbital COP view, then user can zoom through all 5 LOD bands
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(12.5, 30.0, 12_000_000),
  });

  startLodWatcher(Cesium, viewer);
  const initial = lodFromHeight(12_000_000);
  setOverlayByLod(viewer, initial);
  onLodCallback?.(initial, 12_000_000);

  // Smooth home → Europe mid zoom demo affordance
  viewer.homeButton.viewModel.command.beforeExecute.addEventListener((e) => {
    e.cancel = true;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(12.5, 42.0, 12_000_000),
      duration: 1.6,
    });
  });

  return viewer;
}

export function destroyMapGlobe() {
  stopLodWatcher();
  onLodCallback = null;
  if (viewer && !viewer.isDestroyed?.()) {
    try {
      viewer.destroy();
    } catch {
      /* ignore */
    }
  }
  viewer = null;
}

export function flyToTop(lon, lat, height = 25000) {
  if (!viewer || !window.Cesium) return;
  viewer.camera.flyTo({
    destination: window.Cesium.Cartesian3.fromDegrees(lon, lat, height),
    duration: 2.2,
  });
}
