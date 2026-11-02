/**
 * Atlas hand → plancia effect.
 *
 * runHoloAction calls this for globe zoom, module navigation, the briefing
 * popup, and sandbox documents. Tests call it with fake deps and assert the
 * globe and popup functions actually run. Unknown ids return null so the
 * rest of the holo switch keeps its own cases.
 */

export const ZOOM_IN_FACTOR = 0.55;
export const ZOOM_OUT_FACTOR = 1.85;
export const ZOOM_CITY_HEIGHT = 80_000;
export const ZOOM_COUNTRY_HEIGHT = 1_500_000;
export const ZOOM_CONTINENT_HEIGHT = 12_000_000;
export const ZOOM_WORLD_HEIGHT = 20_000_000;

function sourceLabel(opts) {
  return opts?.fromVoice ? "voce" : "tocco";
}

export function dispatchAtlasHand(action, deps = {}, opts = {}) {
  const id = String(action || "").trim().toLowerCase();
  const src = sourceLabel(opts);
  const showMap = () => Promise.resolve(deps.showModule?.("map"));
  switch (id) {
    case "zoom-in":
      return showMap().then(() => {
        const height = deps.zoomByFactor?.(ZOOM_IN_FACTOR) ?? null;
        deps.showToast?.(`ZOOM IN · ${src}${height ? ` · ${height}` : ""}`);
        return { ran: "zoom-in", height };
      });
    case "zoom-out":
      return showMap().then(() => {
        const height = deps.zoomByFactor?.(ZOOM_OUT_FACTOR) ?? null;
        deps.showToast?.(`ZOOM OUT · ${src}${height ? ` · ${height}` : ""}`);
        return { ran: "zoom-out", height };
      });
    case "zoom-citta":
      return showMap().then(() => {
        const height = Number(deps.cityHeight) || ZOOM_CITY_HEIGHT;
        deps.flyToTop?.(deps.lon, deps.lat, height);
        deps.showToast?.(`ZOOM CITTÀ · ${src}`);
        return { ran: "zoom-citta", height };
      });
    case "zoom-paese":
      return showMap().then(() => {
        deps.flyToTop?.(deps.lon, deps.lat, ZOOM_COUNTRY_HEIGHT);
        deps.showToast?.(`ZOOM PAESE · ${src}`);
        return { ran: "zoom-paese", height: ZOOM_COUNTRY_HEIGHT };
      });
    case "zoom-continente":
      return showMap().then(() => {
        deps.flyToTop?.(deps.lon, deps.lat, ZOOM_CONTINENT_HEIGHT);
        deps.showToast?.(`ZOOM CONTINENTE · ${src}`);
        return { ran: "zoom-continente", height: ZOOM_CONTINENT_HEIGHT };
      });
    case "zoom-world":
      return showMap().then(() => {
        const height = deps.zoomToHeight?.(ZOOM_WORLD_HEIGHT, { duration: 1.1 });
        if (height == null) deps.flyToTop?.(deps.lon, deps.lat, ZOOM_WORLD_HEIGHT);
        deps.showToast?.(`ZOOM MONDO · ${src}`);
        return { ran: "zoom-world", height: height ?? ZOOM_WORLD_HEIGHT };
      });
    case "map":
    case "pipeline":
    case "memory":
    case "chat":
      deps.syncHoloActive?.(id);
      return Promise.resolve(deps.showModule?.(id)).then(() => {
        deps.saveLastView?.(id);
        deps.showToast?.(`${id.toUpperCase()} · ${src}`);
        return { ran: id };
      });
    case "briefing":
      deps.openBriefingModal?.();
      deps.showToast?.(`BRIEFING · ${src}`);
      return Promise.resolve({ ran: "briefing" });
    case "document": {
      const rel = String(opts.hand?.path || opts.path || "").trim();
      if (!rel) {
        deps.showToast?.("Documento: indica il file nella sandbox", "warn");
        return Promise.resolve({ ran: "document", opened: false, path: "" });
      }
      return Promise.resolve(deps.openDocument?.(rel)).then(() => ({
        ran: "document",
        opened: true,
        path: rel,
      }));
    }
    case "news":
      return Promise.resolve(deps.refreshNews?.()).then(() => {
        deps.showToast?.(`NEWS · ${src}`);
        return { ran: "news" };
      });
    default:
      return null;
  }
}
