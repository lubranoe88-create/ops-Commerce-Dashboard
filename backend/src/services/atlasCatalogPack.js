/**
 * Seed plancia control catalog + world geo hints into sticky durable memory.
 */
import { AGENTQ_HAND_ACTIONS, upsertTaggedMemory } from "./agentqBridge.js";
import { DURABLE_TAG, STICKY_TAG } from "./atlasRecall.js";
import { PANEL_CATALOG, UI_ACTIONS, WRITE_ACTIONS } from "./panelCatalog.js";

export const ATLAS_CONTROL_TAG = "atlas-plancia-control";
export const ATLAS_GEO_TAG = "atlas-world-geo";

/** Compact world landmarks Atlas can use for map / news / fly context. */
export const ATLAS_WORLD_GEO = [
  { name: "Kyiv", region: "Ukraine", lat: 50.45, lon: 30.52 },
  { name: "Moscow", region: "Russia", lat: 55.75, lon: 37.62 },
  { name: "Beijing", region: "China", lat: 39.9, lon: 116.4 },
  { name: "Taipei", region: "Taiwan", lat: 25.03, lon: 121.57 },
  { name: "Jerusalem", region: "Israel", lat: 31.77, lon: 35.22 },
  { name: "Tehran", region: "Iran", lat: 35.69, lon: 51.39 },
  { name: "New Delhi", region: "India", lat: 28.61, lon: 77.21 },
  { name: "Tokyo", region: "Japan", lat: 35.68, lon: 139.69 },
  { name: "Paris", region: "France", lat: 48.86, lon: 2.35 },
  { name: "Berlin", region: "Germany", lat: 52.52, lon: 13.41 },
  { name: "London", region: "UK", lat: 51.51, lon: -0.13 },
  { name: "Washington", region: "USA", lat: 38.9, lon: -77.04 },
  { name: "Brasília", region: "Brazil", lat: -15.78, lon: -47.93 },
  { name: "Lagos", region: "Nigeria", lat: 6.45, lon: 3.39 },
  { name: "Rome", region: "Italy", lat: 41.9, lon: 12.5 },
  { name: "Madrid", region: "Spain", lat: 40.42, lon: -3.7 },
  { name: "Istanbul", region: "Türkiye", lat: 41.01, lon: 28.98 },
  { name: "Dubai", region: "UAE", lat: 25.2, lon: 55.27 },
  { name: "Singapore", region: "Singapore", lat: 1.35, lon: 103.82 },
  { name: "Sydney", region: "Australia", lat: -33.87, lon: 151.21 },
  { name: "Cairo", region: "Egypt", lat: 30.04, lon: 31.24 },
  { name: "Johannesburg", region: "South Africa", lat: -26.2, lon: 28.04 },
  { name: "Mexico City", region: "Mexico", lat: 19.43, lon: -99.13 },
  { name: "Buenos Aires", region: "Argentina", lat: -34.6, lon: -58.38 },
  { name: "Seoul", region: "South Korea", lat: 37.57, lon: 126.98 },
  { name: "Jakarta", region: "Indonesia", lat: -6.21, lon: 106.85 },
].map((row) => `${row.name} (${row.region}) ${row.lat},${row.lon}`).join("\n");

function seedTaggedDurable(tag, title, text, extraTags = []) {
  return upsertTaggedMemory({
    tag,
    title,
    text,
    tags: [tag, DURABLE_TAG, STICKY_TAG, "atlas", ...extraTags],
  });
}

export function ensureAtlasCatalogMemory() {
  const panels = PANEL_CATALOG.map((p) => `${p.id}:${p.label} — ${p.purpose}`).join("\n");
  const hands = AGENTQ_HAND_ACTIONS.map((a) => `${a.id}:${a.label} [${a.group}]`).join("\n");
  const control = seedTaggedDurable(
    ATLAS_CONTROL_TAG,
    "Atlas plancia control catalog",
    [
      "Plancia modules and hands Atlas can drive under L3.",
      "Panels:",
      panels,
      "Hand actions:",
      hands,
      `UI actions: ${UI_ACTIONS.join(", ")}`,
      `Write actions (confirm when needed): ${Object.keys(WRITE_ACTIONS || {}).join(", ")}`,
      "Prefer MAPPA / PIPELINE / MEMORY / CHAT / CONTROLLI / COCKPIT / LIVE MEMORY panel.",
    ].join("\n"),
    ["prompt", "plancia", "controls"],
  );
  const geo = seedTaggedDurable(
    ATLAS_GEO_TAG,
    "Atlas world geo landmarks",
    [
      "Use these lat/lon landmarks for map fly, news pins, and geo questions. Do not invent coords.",
      ATLAS_WORLD_GEO,
    ].join("\n"),
    ["prompt", "geo", "map"],
  );
  return {
    ok: true,
    tags: [ATLAS_CONTROL_TAG, ATLAS_GEO_TAG],
    control: control.entry?.id,
    geo: geo.entry?.id,
  };
}
