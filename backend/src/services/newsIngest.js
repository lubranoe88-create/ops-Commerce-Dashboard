/**
 * Mechanized world-news ingest (NO LLM). RSS → SQLite → globe pins.
 */
import { config } from "../config.js";
import { upsertNewsItems, listLatestNews } from "../memory/aiStore.js";

/** Rough capital coords for common BBC world regions / countries in titles. */
const GEO_HINTS = [
  [/ukraine|kyiv|kiev/i, 50.45, 30.52],
  [/russia|moscow/i, 55.75, 37.62],
  [/china|beijing/i, 39.9, 116.4],
  [/taiwan|taipei/i, 25.03, 121.57],
  [/israel|gaza|jerusalem/i, 31.77, 35.22],
  [/iran|tehran/i, 35.69, 51.39],
  [/india|delhi|mumbai/i, 28.61, 77.21],
  [/japan|tokyo/i, 35.68, 139.69],
  [/france|paris/i, 48.86, 2.35],
  [/germany|berlin/i, 52.52, 13.41],
  [/uk\b|britain|london/i, 51.51, -0.13],
  [/usa|united states|washington|white house/i, 38.9, -77.04],
  [/brazil|brasilia|são paulo|sao paulo/i, -15.78, -47.93],
  [/africa|nigeria|lagos/i, 6.45, 3.39],
  [/middle east/i, 29.0, 45.0],
];

function guessLatLon(title) {
  for (const [re, lat, lon] of GEO_HINTS) {
    if (re.test(title)) return { lat, lon };
  }
  return { lat: 20, lon: 10 };
}

function stripTags(html) {
  return String(html || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseRssItems(xml, limit = 12) {
  const items = [];
  const blocks = String(xml).match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks.slice(0, limit)) {
    const title = stripTags((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || "");
    const link = stripTags((block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || "");
    const desc = stripTags(
      (block.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [])[1] || "",
    );
    const pub = stripTags(
      (block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1] || "",
    );
    if (!title) continue;
    const { lat, lon } = guessLatLon(`${title} ${desc}`);
    const external_id = `rss:${Buffer.from(link || title).toString("base64url").slice(0, 48)}`;
    items.push({
      external_id,
      title: title.slice(0, 240),
      summary: desc.slice(0, 400),
      url: link.slice(0, 500),
      source: "bbc-world-rss",
      lat,
      lon,
      published_at: pub || null,
    });
  }
  return items;
}

let lastFetchMs = 0;

export async function refreshWorldNews({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - lastFetchMs < 15 * 60 * 1000) {
    return listLatestNews(12);
  }
  try {
    const res = await fetch(config.newsRssUrl, {
      headers: { "User-Agent": "ops-commerce-dashboard/1.0 (mechanical news)" },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) throw new Error(`RSS HTTP ${res.status}`);
    const xml = await res.text();
    const items = parseRssItems(xml, 12);
    // Changed rows notify the Atlas resident from upsertNewsItems (L2 hook, no poll).
    if (items.length) upsertNewsItems(items);
    lastFetchMs = now;
  } catch (err) {
    console.warn("[news] mechanical ingest failed", err?.message || err);
  }
  return listLatestNews(12);
}

export function getCachedNews(limit = 12) {
  return listLatestNews(limit);
}
