/**
 * X4: graph over expandable memory.
 * Edges are shared tags and recall-token overlap (the same tokens M1 ranks).
 * Also exposes a live MEMORY snapshot (expandable.json + SQLite concepts) for
 * the plancia panel that polls while open.
 */
import { atlasMemoryPaths, listExpandableMemory } from "./agentqBridge.js";
import { getDashboardSnapshot } from "../memory/store.js";
import { recallTokens } from "./atlasRecall.js";

const GENERIC_TAGS = new Set(["atlas", "agentq", "seed", "voice", "durable", "atlas-session"]);

function meaningfulTags(entry) {
  const tags = new Set();
  for (const tag of Array.isArray(entry?.tags) ? entry.tags : []) {
    const clean = String(tag || "").trim().toLowerCase();
    if (!clean || GENERIC_TAGS.has(clean)) continue;
    tags.add(clean);
  }
  return tags;
}

export function buildMemoryGraph(entries = []) {
  const source = (Array.isArray(entries) ? entries : []).filter((entry) => entry?.id).slice(0, 60);
  const used = new Set();
  const nodes = source.map((entry) => {
    let id = String(entry.id);
    let n = 2;
    while (used.has(id)) {
      id = `${entry.id}-${n}`;
      n += 1;
    }
    used.add(id);
    return {
      id,
      title: String(entry.title || "Nota").slice(0, 120),
      text: String(entry.text || "").slice(0, 240),
      at: entry.at || null,
      tags: [...meaningfulTags(entry)],
    };
  });
  const edges = [];
  const seen = new Set();
  const add = (from, to, reason) => {
    if (!from || !to || from === to) return;
    const key = `${from < to ? from : to}|${from < to ? to : from}|${reason}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ from, to, reason });
  };
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i];
      const b = nodes[j];
      for (const tag of a.tags) {
        if (b.tags.includes(tag)) add(a.id, b.id, `tag:${tag}`);
      }
      const tokensA = new Set(recallTokens(a.title).filter((token) => token.length >= 4));
      const tokensB = new Set(recallTokens(b.title));
      for (const token of tokensA) {
        if (tokensB.has(token)) {
          add(a.id, b.id, `recall:${token}`);
          break;
        }
      }
      const explicit = Array.isArray(source[i]?.links) ? source[i].links : [];
      if (explicit.includes(b.id)) add(a.id, b.id, "link");
    }
  }
  return {
    ok: true,
    name: "Atlas",
    count: nodes.length,
    nodes,
    edges,
  };
}

export function memoryGraph({ limit = 40, query = "" } = {}) {
  const listed = listExpandableMemory({ limit, query });
  const graph = buildMemoryGraph(listed.entries || []);
  return { ...graph, count: listed.count ?? graph.count, shown: graph.nodes.length };
}

/**
 * Live MEMORY feed for the plancia UI. `revision` changes whenever expandable
 * notes or SQLite concept counts move — clients skip re-render when unchanged.
 */
export function memoryLiveSnapshot({ limit = 40, query = "" } = {}) {
  const listed = listExpandableMemory({ limit, query });
  const entries = Array.isArray(listed.entries) ? listed.entries : [];
  let concepts = [];
  let links = [];
  try {
    const snap = getDashboardSnapshot();
    concepts = Array.isArray(snap?.memory?.concepts) ? snap.memory.concepts : [];
    links = Array.isArray(snap?.memory?.links) ? snap.memory.links : [];
  } catch {
    concepts = [];
    links = [];
  }
  const newest = entries[0] || null;
  const revision = [
    listed.count ?? entries.length,
    newest?.id || "",
    newest?.at || "",
    concepts.length,
    links.length,
  ].join(":");
  const paths = atlasMemoryPaths();
  return {
    ok: true,
    name: "Atlas",
    label: "MEMORY",
    revision,
    at: new Date().toISOString(),
    expandable: {
      path: paths.relative || "backend/data/agentq-memory/expandable.json",
      count: listed.count ?? entries.length,
      entries: entries.map((entry) => ({
        id: entry.id,
        at: entry.at || null,
        title: String(entry.title || "Nota").slice(0, 160),
        text: String(entry.text || "").slice(0, 320),
        tags: Array.isArray(entry.tags) ? entry.tags.slice(0, 12) : [],
      })),
    },
    sqlite: {
      path: "backend/data/memory.sqlite",
      conceptCount: concepts.length,
      linkCount: links.length,
      concepts: concepts.slice(0, 24).map((c) => ({
        id: c.id,
        label: c.label || c.slug || c.id,
        importance: c.importance ?? null,
        dimension: c.dimension ?? null,
      })),
    },
    graph: buildMemoryGraph(entries),
  };
}
