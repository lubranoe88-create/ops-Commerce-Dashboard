/**
 * C2 plancia state Q&A.
 * Answers only from the facts passed in (snapshot, board, tops, pins, problems, updates).
 * No model call. Missing numbers stay "n/d".
 */
import { asAtlasLine } from "./atlasPersonality.js";
import { trustLineForResult } from "./atlasTrust.js";
import { getDashboardSnapshot } from "../memory/store.js";
import { getAgentqProblems, getEntryUpdates } from "./agentqBridge.js";
import { getCachedNews } from "./newsIngest.js";

const BLOCKED_PREFIX =
  /^(cerca|ricerca|search|memorizza|ricorda|salva\s+in\s+memoria|problemi|errori|monitoraggio|risolvi|sistema|apri|vai|mostra|zoom)\b/;

const STATE_HINT =
  /\b(stato|istantanea|snapshot|salute|health|come\s+sta|quadro(?:\s+funzioni)?|function\s*board|pins?|tops?|classifica|problemi\s+aperti|quanti\s+problemi|numero\s+di\s+problemi|quanti\s+errori|errori\s+aperti|aggiornamenti|modulo\s+aperto|quale\s+modulo|che\s+modulo|modulo\s+è\s+aperto|modulo\s+e\s+aperto)\b/i;

const QUESTIONISH =
  /[?]|(?:^|\s)(qual[ei]|quanti|quante|come|dimmi|stato|salute|riepilogo|snapshot|istantanea|tops?|pins?|quadro|aggiornamenti|classifica)\b/i;

export function isPlanciaStateQuestion(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t || t.length > 500) return false;
  if (BLOCKED_PREFIX.test(t)) return false;
  if (!STATE_HINT.test(t)) return false;
  if (!QUESTIONISH.test(t)) return false;
  return true;
}

export function stateFacets(text) {
  const t = String(text || "").toLowerCase();
  const broad = /\b(stato|istantanea|snapshot|riepilogo|come\s+sta)\b/.test(t);
  return {
    module: broad || /modulo/.test(t),
    health: broad || /salute|health|snapshot|istantanea/.test(t),
    board: broad || /quadro|function\s*board|\bboard\b/.test(t),
    tops: broad || /\btops?\b|classifica/.test(t),
    pins: broad || /\bpins?\b/.test(t),
    problems: broad || /problem|errori\s+aperti|quanti\s+errori/.test(t),
    updates: broad || /aggiornament/.test(t),
  };
}

function shown(value) {
  if (value == null || value === "") return "n/d";
  return String(value);
}

function listTitles(rows, pick) {
  return (Array.isArray(rows) ? rows : [])
    .map((row, index) => {
      const title = String(pick(row) || "").trim();
      if (!title) return "";
      const rank = row?.rank || index + 1;
      const score = row?.score == null || row?.score === "" ? "" : ` (${row.score})`;
      return `${rank}. ${title}${score}`;
    })
    .filter(Boolean);
}

/**
 * @param {string} question
 * @param {object} facts compact plancia facts, never invented
 */
export function answerPlanciaState(question, facts = {}) {
  const facets = stateFacets(question);
  const lines = [];
  if (facts.snapshotError) lines.push("Snapshot non letto. Non invento i conteggi.");

  if (facets.module) lines.push(`Modulo aperto: ${shown(facts.module)}.`);

  if (facets.health) {
    const health = facts.health || {};
    lines.push(
      `Salute plancia: ${shown(health.status)} (${shown(health.score)}). Errori aperti nello snapshot: ${shown(health.openErrors)}.`,
    );
  }

  if (facets.board) {
    const board = facts.board;
    if (!board || (board.ok == null && board.error == null && board.total == null)) {
      lines.push("Quadro funzioni: non disponibile.");
    } else {
      lines.push(
        `Quadro funzioni: ${shown(board.ok)} ok, ${shown(board.error)} errori, ${shown(board.unverified)} non verificati, totale ${shown(board.total)}.`,
      );
    }
  }

  if (facets.tops) {
    const tops = listTitles(facts.tops, (row) => row?.title || row?.display_name);
    if (!tops.length) lines.push("Tops: nessuno nello snapshot di oggi.");
    else lines.push(`Tops (${tops.length} in elenco): ${tops.join("; ")}.`);
  }

  if (facets.pins) {
    const pins = listTitles(facts.pins, (row) => row?.title);
    if (!pins.length) lines.push("Pin: nessuno.");
    else lines.push(`Pin (${pins.length}): ${pins.join("; ")}.`);
  }

  if (facets.problems) lines.push(`Problemi aperti: ${shown(facts.problemCount)}.`);

  if (facets.updates) {
    const updates = Array.isArray(facts.updates) ? facts.updates : [];
    const count = facts.updateCount == null ? updates.length : facts.updateCount;
    if (!count) lines.push("Aggiornamenti: nessuno.");
    else {
      const titles = updates
        .slice(0, 5)
        .map((row) => String(row?.title || "").trim())
        .filter(Boolean);
      lines.push(`Aggiornamenti: ${count}.${titles.length ? ` ${titles.join("; ")}.` : ""}`);
    }
  }

  if (!lines.length) lines.push("Non ho un dato di stato per questa domanda.");

  const reply = asAtlasLine(lines.join(" "));
  return {
    ok: true,
    answered: true,
    name: "Atlas",
    route: "state",
    reply,
    facets,
    facts: {
      module: facts.module || "",
      health: facts.health || null,
      board: facts.board || null,
      tops: Array.isArray(facts.tops) ? facts.tops : [],
      pins: Array.isArray(facts.pins) ? facts.pins : [],
      problemCount: facts.problemCount ?? null,
      updateCount: facts.updateCount ?? (Array.isArray(facts.updates) ? facts.updates.length : 0),
      generatedAt: facts.generatedAt || null,
    },
    trust: { mode: "auto", reason: "status" },
    trustLine: trustLineForResult([], { empty: "stato plancia" }),
    model: null,
  };
}

export function factsFromBundle(bundle = {}, { module } = {}) {
  const news = Array.isArray(bundle.news) ? bundle.news : [];
  const updates = Array.isArray(bundle.updates) ? bundle.updates : [];
  return {
    module: module || bundle.module || "",
    generatedAt: bundle.generatedAt || null,
    health: bundle.health || null,
    board: bundle.board || null,
    tops: Array.isArray(bundle.tops) ? bundle.tops : [],
    pins: news.map((item) => ({ title: item?.title || "" })).filter((item) => item.title),
    problemCount: bundle.problemCount ?? (Array.isArray(bundle.problems) ? bundle.problems.length : null),
    updates,
    updateCount: updates.length,
  };
}

export function answerFromBundle(question, bundle, options = {}) {
  const answered = answerPlanciaState(question, factsFromBundle(bundle, options));
  return { ...answered, source: "resident" };
}

function topFacts(snapshot) {
  return (Array.isArray(snapshot?.tops) ? snapshot.tops : []).slice(0, 8).map((row) => ({
    title: row?.title || row?.display_name || "",
    score: row?.score ?? null,
    rank: row?.rank ?? null,
  }));
}

export async function answerPlanciaStateLive({ question, module = "map" } = {}) {
  let snapshot = null;
  try {
    snapshot = getDashboardSnapshot();
  } catch (err) {
    snapshot = { error: err?.message || "snapshot failed" };
  }
  let problems = null;
  try {
    problems = await getAgentqProblems({ limit: 24 });
  } catch (err) {
    problems = { count: null, functionBoard: null, error: err?.message || "problems failed" };
  }
  let updates = { updates: [] };
  try {
    updates = getEntryUpdates({ limit: 8 });
  } catch {
    updates = { updates: [] };
  }
  let news = [];
  try {
    news = getCachedNews(8) || [];
  } catch {
    news = [];
  }
  const updateRows = Array.isArray(updates?.updates) ? updates.updates : [];
  const facts = {
    module: module || "map",
    generatedAt: new Date().toISOString(),
    snapshotError: snapshot?.error || problems?.error || "",
    health: snapshot?.error ? null : snapshot?.health || null,
    board: problems?.functionBoard || null,
    tops: snapshot?.error ? [] : topFacts(snapshot),
    pins: (Array.isArray(news) ? news : []).slice(0, 8).map((item) => ({ title: item?.title || "" })),
    problemCount: problems?.count ?? null,
    updates: updateRows,
    updateCount: updateRows.length,
  };
  const answered = answerPlanciaState(question, facts);
  return { ...answered, source: "live" };
}
