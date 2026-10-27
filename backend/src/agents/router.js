import { listAgents } from "./registry.js";

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * Rule-based router: pick only agents whose keywords/domains match the
 * conversation context. Never fans out to the whole pool.
 *
 * @param {object} context
 * @param {string} [context.message]
 * @param {string[]} [context.sources] research lead keys
 * @param {string[]} [context.tags]
 * @param {object} [options]
 * @param {number} [options.minScore=1]
 * @param {number} [options.maxAgents=4]
 */
export function selectAgents(context = {}, options = {}) {
  const minScore = options.minScore ?? 1;
  const maxAgents = options.maxAgents ?? 4;
  const haystack = normalizeText(
    [
      context.message,
      ...(context.sources || []),
      ...(context.tags || []),
      context.topic,
    ]
      .filter(Boolean)
      .join(" \n "),
  );

  const scored = [];
  for (const agent of listAgents()) {
    let score = 0;
    const hits = [];

    for (const kw of agent.keywords || []) {
      const needle = normalizeText(kw);
      if (needle && haystack.includes(needle)) {
        score += 1;
        hits.push(kw);
      }
    }
    for (const domain of agent.domains || []) {
      const needle = normalizeText(domain);
      if (needle && haystack.includes(needle)) {
        score += 0.5;
        hits.push(`domain:${domain}`);
      }
    }

    if (score >= minScore) {
      scored.push({ agent, score, hits });
    }
  }

  scored.sort((a, b) => b.score - a.score || a.agent.id.localeCompare(b.agent.id));

  // Safe fallback: if nothing matched, use a tiny default pair for commerce core
  let selected = scored.slice(0, maxAgents);
  if (selected.length === 0) {
    const fallbackIds = ["financial-analysis", "failure-detection"];
    selected = listAgents()
      .filter((a) => fallbackIds.includes(a.id))
      .map((agent) => ({
        agent,
        score: 0,
        hits: ["fallback:default-commerce"],
      }));
  }

  return {
    strategy: "keyword_context_v1",
    inputPreview: String(context.message || "").slice(0, 240),
    selected: selected.map(({ agent, score, hits }) => ({
      id: agent.id,
      name: agent.name,
      score,
      hits,
      description: agent.description,
    })),
    rejectedCount: Math.max(listAgents().length - selected.length, 0),
  };
}
