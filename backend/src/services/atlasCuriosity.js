/**
 * P3 proactive curiosity.
 *
 * One unasked observation about a news item or a state anomaly. It is not a
 * task list (that is C7). A cooldown stops the same wake/ingress stream
 * from repeating it.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { asAtlasLine } from "./atlasPersonality.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, "../../data/agentq-memory/atlas-curiosity.json");

export const CURIOSITY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

const STOP = new Set([
  "the", "and", "for", "con", "del", "della", "delle", "dei", "sul", "sulla",
  "una", "uno", "che", "non", "per", "sono", "from", "with",
]);

let pathOverride = "";
let clockFn = null;
let memory = null;

export function setCuriosityFileForTests(filePath) {
  pathOverride = filePath ? path.resolve(filePath) : "";
  memory = null;
}

export function setCuriosityClockForTests(fn) {
  clockFn = typeof fn === "function" ? fn : null;
}

export function resetCuriosityForTests() {
  pathOverride = "";
  clockFn = null;
  memory = null;
}

function curiosityNow() {
  return clockFn ? new Date(clockFn()).getTime() : Date.now();
}

function curiosityPath() {
  return pathOverride || DEFAULT_PATH;
}

function load() {
  if (memory) return memory;
  try {
    const raw = JSON.parse(fs.readFileSync(curiosityPath(), "utf8"));
    memory = {
      lastAt: Number(raw?.lastAt) || 0,
      lastKey: String(raw?.lastKey || ""),
    };
  } catch {
    memory = { lastAt: 0, lastKey: "" };
  }
  return memory;
}

function persist(state) {
  memory = { lastAt: Number(state.lastAt) || 0, lastKey: String(state.lastKey || "") };
  try {
    const dest = curiosityPath();
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const tmp = path.join(path.dirname(dest), `.atlas-curiosity.${process.pid}.tmp`);
    fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, ...memory }, null, 2)}\n`, "utf8");
    fs.renameSync(tmp, dest);
  } catch {
    /* the in-memory cooldown still applies in this process */
  }
  return memory;
}

function tokens(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2 && !STOP.has(word));
}

function overlaps(item, tops) {
  const bag = new Set(tokens(`${item?.title || ""} ${item?.summary || ""}`));
  if (!bag.size) return false;
  return (tops || []).some((top) => tokens(top?.title || top?.display_name || "").some((word) => bag.has(word)));
}

function countLabel(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

export function findAnomalies({ bundle = null, newsItems = null } = {}) {
  const out = [];
  const health = String(bundle?.health?.status || "").toLowerCase();
  const boardErr = Number(bundle?.board?.error) || 0;
  const problemCount = Number(bundle?.problemCount ?? bundle?.problems?.length) || 0;
  const tops = Array.isArray(bundle?.tops) ? bundle.tops : [];
  const news = Array.isArray(newsItems) ? newsItems : Array.isArray(bundle?.news) ? bundle.news : [];

  if (health === "ok" && boardErr > 0) {
    out.push({
      kind: "state",
      key: `health-ok-board-${boardErr}`,
      text: `Osservo un'anomalia: la salute è ok ma il quadro funzioni segna ${countLabel(boardErr, "errore", "errori")}.`,
    });
  } else if (health === "ok" && problemCount > 0 && boardErr === 0) {
    out.push({
      kind: "state",
      key: `health-ok-problems-${problemCount}`,
      text: `Osservo un'anomalia: la salute è ok mentre i problemi aperti sono ${problemCount}.`,
    });
  }

  if (tops.length) {
    for (const item of news) {
      const title = String(item?.title || "").trim();
      if (!title || overlaps(item, tops)) continue;
      const source = String(item?.source || "fonte esterna").trim();
      out.push({
        kind: "news",
        key: `news-unlinked:${title}`,
        text: `Osservo che «${title}» (${source}) non tocca i top in plancia. Non è un compito.`,
      });
      break;
    }
  }

  for (const item of news) {
    if (item?.change === "updated" && item?.previousTitle && item.previousTitle !== item.title) {
      out.push({
        kind: "news",
        key: `news-changed:${item.previousTitle}->${item.title}`,
        text: `Osservo che un titolo è cambiato da «${item.previousTitle}» a «${item.title}», senza che nessuno lo chiedesse.`,
      });
      break;
    }
  }

  return out;
}

export function offerCuriosity({ bundle = null, newsItems = null, at } = {}) {
  const anomalies = findAnomalies({ bundle, newsItems });
  if (!anomalies.length) return null;
  const now = at != null ? new Date(at).getTime() : curiosityNow();
  const when = Number.isFinite(now) ? now : Date.now();
  const state = load();
  if (state.lastAt && when - state.lastAt < CURIOSITY_COOLDOWN_MS) return null;
  const pick = anomalies[0];
  persist({ lastAt: when, lastKey: pick.key });
  return {
    kind: pick.kind,
    key: pick.key,
    text: asAtlasLine(pick.text),
    offered: true,
  };
}
