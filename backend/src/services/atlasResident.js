/**
 * Atlas resident runtime (plancia, not on-demand chat).
 *
 * L1: one wake per authenticated open. The bundle (snapshot, module, board,
 * news, updates, problems, queued ingress) goes to Atlas in a single request.
 * L2: updates append, news upsert, and proactive writes call the ingress bus
 * immediately. While the resident is awake those events are forwarded to Atlas
 * and pushed on the SSE stream. Nothing here polls.
 *
 * L3: proposed ids go through gateHandActions. AUTO is safe to run. ASK is
 * returned for the plancia confirm path and is not executed here.
 * mic is dropped so a wake never asks for getUserMedia.
 *
 * C10: a news wake or an L2 news ingress explains each item (source, what
 * changed, why it matters on the plancia, summary). The literacy module
 * proposes ids; only a news ingress merges the ones L3 marks AUTO into the
 * actions the client may run. A hard startup-integrity failure gates the
 * wake: the operator gets the warning and no hand runs.
 *
 * C7: wake and news ingress also carry unasked next steps. AUTO ids are
 * safe to run; ASK waits. They stay out of the model action list.
 * C8: integrity or board errors try a functional self-heal (refresh,
 * re-run checks, clear transient flags) and log it on M4. Destructive
 * repairs stay ASK.
 * X5: ingress is scored. Only a score at or above the threshold interrupts.
 * A wake always speaks, because the operator just opened the plancia.
 * P2: an open wake can focus the module the caller uses in this time of day,
 * when L3 marks it AUTO.
 * P3: at most one curiosity observation per cooldown, separate from C7.
 */
import crypto from "node:crypto";
import { config } from "../config.js";
import { isAiPaid } from "../middleware/aiPaidGate.js";
import { getDashboardSnapshot } from "../memory/store.js";
import { getCachedNews, refreshWorldNews } from "./newsIngest.js";
import { getAgentqProblems, getEntryUpdates } from "./agentqBridge.js";
import { assertCanCall, recordCompletion } from "./aiBudget.js";
import { completeChat } from "./openrouter.js";
import { asAtlasLine, withAtlasPersona } from "./atlasPersonality.js";
import { gateHandActions } from "./atlasAutonomyPolicy.js";
import { onResidentIngress } from "./atlasResidentBus.js";
import { explainNewsForOperator } from "./atlasNewsLiteracy.js";
import { runStartupIntegrity } from "./atlasStartupIntegrity.js";
import { answerFromBundle } from "./atlasStateAnswer.js";
import { readAtlasSession, rememberWake, restoredFrom } from "./atlasSessionStore.js";
import { assessLiveSpend } from "./atlasSpend.js";
import { trustLineForResult } from "./atlasTrust.js";
import { RECALL_MARKER, recallForContext, recallQueryFromBundle } from "./atlasRecall.js";
import { decisionStatus, formatDecisionLine, recordDecision } from "./atlasDecisionLog.js";
import { providerStatus } from "./atlasReliability.js";
import { proposeNextSteps } from "./atlasSuggestions.js";
import { classifyUrgency } from "./atlasUrgency.js";
import { preferredFocus } from "./atlasHabits.js";
import { offerCuriosity } from "./atlasCuriosity.js";
import { attemptSelfHeal, healNeeded } from "./atlasSelfHeal.js";

const RESIDENT_RULES = [
  "You are resident inside the plancia: this is not an on-demand chat turn.",
  'Reply with one JSON object only: {"summary":"...","actions":[],"ask":[],"newsLiteracy":""}.',
  "summary: 3-6 short Italian sentences, first person as Atlas, using only counts and titles from this payload and any recalled durable notes.",
  "recalled: durable notes ranked for this payload by keyword and recency. The operator did not ask for a search. Use them only when they match the payload. Do not treat them as a sandbox search.",
  "actions: prefer empty. Include an id only when a safe AUTO step clearly helps: refresh, news, status, problems, read, map, pipeline, memory, chat, zoom-in, zoom-out, zoom-citta, zoom-paese, zoom-continente.",
  "Never put mic, credentials, browser-use, export, destructive writes, or spend in actions. Put those in ask only when the payload shows they are actually required. Prefer ask empty.",
  "Do not request the microphone or any device permission.",
  "newsLiteracy: leave this empty. The server attaches the literacy path (source, what changed, why it matters on the plancia, summary) when news are present. Do not replace that path with a one-line disclaimer.",
  "Do not invent counts, titles, or problems that are not in the payload.",
].join("\n");

const BLOCKED_RESIDENT = new Set(["mic"]);

let session = emptySession();
let pending = [];
let ring = [];
let seq = 0;
let hold = 0;
let running = false;
let drainChain = Promise.resolve();
let wakePromise = null;
let installed = false;
let listenerSet = new Set();
let completerOverride = null;
let paidCheck = () => isAiPaid();
let newsLoader = defaultNewsLoader;
let collectOverride = null;
let integrityCheck = null;

function emptySession() {
  return {
    id: null,
    awake: false,
    lastWakeAt: null,
    lastBundle: null,
  };
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

function clip(value, max) {
  const text = String(value ?? "").trim();
  if (text.length <= max) return text;
  return text.slice(0, max);
}

async function defaultNewsLoader() {
  try {
    return await refreshWorldNews({ force: false });
  } catch {
    return getCachedNews(8);
  }
}

function extractJson(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export function newsItemsFrom(value) {
  if (!value) return [];
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) {
      if (!item || typeof item !== "object") continue;
      if (item.kind === "news" && Array.isArray(item.items)) out.push(...item.items);
      else if (item.title && !item.kind) out.push(item);
    }
    return out.slice(0, 6);
  }
  if (Array.isArray(value.items)) return value.items.slice(0, 6);
  if (value.title) return [value];
  return [];
}

function literacyContext(bundle) {
  return {
    module: bundle?.module || "map",
    tops: bundle?.tops || [],
    problems: bundle?.problems || [],
    problemCount: bundle?.problemCount || 0,
  };
}

function literacyFor(kind, bundle, batch) {
  const news = kind === "wake" ? bundle?.news : batch;
  return explainNewsForOperator(news, literacyContext(bundle));
}

export function mechanicalWakeSummary(bundle) {
  const health = bundle?.health || {};
  const board = bundle?.board || {};
  const mod = bundle?.module || "map";
  const updates = bundle?.updates?.length || 0;
  const news = bundle?.news?.length || 0;
  const problems = bundle?.problemCount ?? bundle?.problems?.length ?? 0;
  const score = health.score == null || health.score === "" ? "n/d" : String(health.score);
  const status = health.status || "n/d";
  const boardErr = board.error == null ? 0 : board.error;
  const queued = bundle?.queuedIngress?.length || 0;
  const extra = queued ? ` ${queued} ingressi erano in coda prima del risveglio.` : "";
  return `Plancia aperta sul modulo ${mod}. Salute ${status} (${score}). Quadro funzioni: ${boardErr} errori. Aggiornamenti ${updates}, news ${news}, problemi aperti ${problems}.${extra}`;
}

export function mechanicalIngressSummary(batch) {
  const parts = [];
  for (const ev of asList(batch)) {
    if (!ev || typeof ev !== "object") continue;
    if (ev.kind === "news") {
      const title = ev.items?.[0]?.title || "nuova news";
      parts.push(`News in ingresso: ${title}`);
    } else if (ev.kind === "updates") {
      parts.push(`Aggiornamento: ${ev.update?.title || ev.title || "ingresso"}`);
    } else if (ev.kind === "proactive") {
      parts.push(ev.toast || `Segnale ${ev.eventKind || "proattivo"}`);
    }
  }
  return parts.slice(0, 4).join(" · ") || "Nuovo ingresso in plancia.";
}

function compactFromParts({ module, generatedAt, snapshot, problems, updates, news, queuedIngress }) {
  const snap = snapshot && !snapshot.error ? snapshot : {};
  const health = snap.health || {};
  const board = problems?.functionBoard || {};
  const problemList = asList(problems?.problems).slice(0, 6).map((p) => ({
    severity: p.severity || "",
    title: clip(p.title, 140),
    detail: clip(p.detail, 160),
    kind: p.kind || "",
  }));
  return {
    compact: true,
    module: module || "map",
    generatedAt: generatedAt || new Date().toISOString(),
    health: {
      status: health.status || (snapshot?.error ? "unknown" : "n/d"),
      score: health.score ?? null,
      openErrors: health.openErrors ?? null,
    },
    pipelineHealth: snap.pipeline_health ?? null,
    tops: asList(snap.tops).slice(0, 5).map((t) => ({
      title: clip(t.title || t.display_name, 80),
      score: t.score ?? null,
      rank: t.rank ?? null,
    })),
    openErrors: asList(snap.errors)
      .filter((e) => e.status === "open")
      .slice(0, 5)
      .map((e) => ({
        severity: e.severity || "",
        message: clip(e.message, 160),
        source: clip(e.source, 60),
      })),
    board: {
      ok: board.ok ?? null,
      error: board.error ?? null,
      unverified: board.unverified ?? null,
      total: board.total ?? null,
    },
    updates: asList(updates?.updates).slice(0, 6).map((u) => ({
      at: u.at || "",
      title: clip(u.title, 120),
      detail: clip(u.detail, 180),
    })),
    problems: problemList,
    problemCount: Number(problems?.count ?? problemList.length) || 0,
    news: asList(news).slice(0, 6).map((n) => ({
      title: clip(n.title, 180),
      source: clip(n.source || "bbc-world-rss", 80),
      summary: clip(n.summary, 220),
      change: n.change || "",
      previousTitle: clip(n.previousTitle || n.previous_title || "", 180),
    })),
    queuedIngress: asList(queuedIngress).slice(0, 8),
  };
}

export async function collectWakeBundleLive({ module = "map", queuedIngress = [] } = {}) {
  const moduleName = clip(module || "map", 40) || "map";
  const generatedAt = new Date().toISOString();
  let snapshot = null;
  try {
    snapshot = getDashboardSnapshot();
  } catch (err) {
    snapshot = { error: err?.message || "snapshot failed" };
  }
  let problems = { ok: false, count: 0, problems: [], functionBoard: null };
  try {
    problems = await getAgentqProblems({ limit: 8 });
  } catch (err) {
    problems = {
      ok: false,
      count: 1,
      problems: [{ title: "Problemi non letti", detail: err?.message || "", severity: "high", kind: "resident" }],
      functionBoard: null,
    };
  }
  let updates = { updates: [] };
  try {
    updates = getEntryUpdates({ limit: 8 });
  } catch {
    updates = { updates: [] };
  }
  let news = [];
  try {
    news = await newsLoader();
  } catch {
    news = [];
  }
  if (!Array.isArray(news)) news = [];
  return compactFromParts({
    module: moduleName,
    generatedAt,
    snapshot,
    problems,
    updates,
    news,
    queuedIngress,
  });
}

export async function collectWakeBundle(input = {}) {
  if (collectOverride) return collectOverride(input);
  return collectWakeBundleLive(input);
}

function mergeQueued(bundle, queued) {
  const seen = new Set((bundle?.news || []).map((n) => n.title).filter(Boolean));
  return asList(queued).filter((ev) => {
    if (!ev || ev.kind !== "news") return true;
    const titles = newsItemsFrom(ev).map((n) => n.title).filter(Boolean);
    if (!titles.length) return true;
    return titles.some((title) => !seen.has(title));
  }).slice(0, 8);
}

/**
 * AUTO ids stay in actions. ASK ids are flagged and not executed here.
 * mic is removed so the resident cannot open the microphone.
 */
export function gateResidentProposal(actions, ask) {
  const proposed = [];
  const seen = new Set();
  for (const item of [...asList(actions), ...asList(ask)]) {
    const id = String(typeof item === "string" ? item : item?.id || item?.action || item?.type || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-");
    if (!id || BLOCKED_RESIDENT.has(id) || seen.has(id)) continue;
    seen.add(id);
    proposed.push(id);
  }
  return gateHandActions(proposed);
}

function mechanicalAsk(kind, bundle, batch, fallback) {
  const summary = kind === "wake" ? mechanicalWakeSummary(bundle) : mechanicalIngressSummary(batch);
  const brief = literacyFor(kind, bundle, batch);
  return {
    summary,
    actions: [],
    ask: [],
    newsLiteracy: brief.text,
    literacy: brief,
    model: null,
    fallback,
  };
}

function normalizeModel(result) {
  if (!result) return null;
  if (typeof result.summary === "string" || Array.isArray(result.actions)) {
    return {
      summary: result.summary || "",
      actions: result.actions || [],
      ask: result.ask || [],
      newsLiteracy: result.newsLiteracy || "",
      model: result.model || null,
    };
  }
  const parsed = extractJson(result.content);
  if (!parsed || typeof parsed !== "object") {
    return {
      summary: clip(result.content, 700),
      actions: [],
      ask: [],
      newsLiteracy: "",
      model: result.model || null,
    };
  }
  return {
    summary: parsed.summary || "",
    actions: parsed.actions || [],
    ask: parsed.ask || [],
    newsLiteracy: parsed.newsLiteracy || "",
    model: result.model || null,
  };
}

function safeRecall(query) {
  try {
    return recallForContext(query, { limit: 4 });
  } catch {
    return { facts: [], line: "", automatic: true, searched: false, onDemand: false };
  }
}

function recallQueryFor(kind, bundle, batch) {
  if (kind === "wake") return recallQueryFromBundle(bundle);
  const events = asList(batch);
  return recallQueryFromBundle({
    module: bundle?.module,
    health: bundle?.health,
    news: events.flatMap((event) => newsItemsFrom(event)),
    updates: events
      .filter((event) => event?.kind === "updates")
      .map((event) => event.update || event),
    problems: bundle?.problems,
  });
}

function decisionLines(entries) {
  return entries.map((entry) => formatDecisionLine(entry)).filter(Boolean).join(" | ");
}

function logResidentDecisions(kind, gated, brief, asked) {
  const place = kind === "wake" ? "Risveglio" : "Ingresso";
  const tags = asList(gated?.tagged);
  const choices = tags.length
    ? tags.map((step) => {
        const mode = step?.mode === "ask" ? "ask" : "auto";
        const reason = step?.reason || "unspecified";
        return {
          action: step.id,
          mode,
          reason,
          because:
            mode === "auto"
              ? `${place}: «${step.id}» è AUTO (${reason}) e può partire.`
              : `${place}: «${step.id}» resta ASK (${reason}) e non parte da solo.`,
        };
      })
    : [
        {
          action: "none",
          mode: "auto",
          reason: asked?.fallback || "empty",
          because: asked?.fallback
            ? `${place}: nessuna mano, la risposta è ${asked.fallback}.`
            : `${place}: nessun passo utile, lascio le azioni vuote.`,
        },
      ];
  const wakeEntry = recordDecision({ source: "wake", choices });
  let newsEntry = null;
  if (brief?.items?.length) {
    const auto = asList(brief.auto).includes("news");
    const ran = kind !== "wake" && asList(gated?.actions).includes("news");
    newsEntry = recordDecision({
      source: "news",
      choices: [
        {
          action: "news",
          mode: auto ? "auto" : "ask",
          reason: kind === "wake" ? "wake-literacy" : "ingress-literacy",
          because:
            kind === "wake"
              ? "Risveglio: spiego le news e non eseguo il passo news salvo che il modello lo abbia chiesto."
              : ran
                ? "News in ingresso e L3 marca news AUTO: lo aggiungo alle azioni."
                : "News in ingresso: non eseguo news finché L3 non lo marca AUTO.",
        },
      ],
    });
  }
  return decisionLines([wakeEntry, newsEntry]);
}

async function askAtlas(kind, bundle, batch) {
  const recalled = safeRecall(recallQueryFor(kind, bundle, batch));
  if (!paidCheck()) return { ...mechanicalAsk(kind, bundle, batch, "free"), recallLine: recalled.line };
  const system = withAtlasPersona(RESIDENT_RULES);
  const recallNote = recalled.facts.length ? RECALL_MARKER : "";
  const prompt = JSON.stringify(
    kind === "wake"
      ? {
          kind,
          instruction: "Risveglio unico all'apertura della plancia. Un solo riepilogo.",
          bundle,
          recalled: recalled.facts,
          recallNote,
        }
      : {
          kind: "ingress",
          instruction: "Ingresso appena arrivato. Reagisci una volta. Preferisci nessuna azione.",
          events: asList(batch).slice(0, 8),
          context: {
            module: bundle?.module || "map",
            health: bundle?.health || null,
            problemCount: bundle?.problemCount || 0,
          },
          recalled: recalled.facts,
          recallNote,
        },
  );
  if (!completerOverride) {
    try {
      assertCanCall("router");
    } catch (err) {
      return { ...mechanicalAsk(kind, bundle, batch, err.code || "budget"), recallLine: recalled.line };
    }
  }
  try {
    const result = completerOverride
      ? await completerOverride({ system, prompt, kind })
      : await completeChat({
          system,
          prompt,
          model: config.aiRouterModel,
          maxTokens: 420,
          temperature: 0.2,
        });
    if (!completerOverride && result) {
      try {
        recordCompletion({ tier: "router", model: result.model, usage: result.usage });
      } catch {
        /* the summary still stands if the ledger write fails */
      }
    }
    const parsed = normalizeModel(result) || mechanicalAsk(kind, bundle, batch, "empty");
    return {
      ...parsed,
      fallback: result?.fallback || (parsed.summary ? null : "empty"),
      recallLine: recalled.line,
    };
  } catch (err) {
    return { ...mechanicalAsk(kind, bundle, batch, err.code || "model"), recallLine: recalled.line };
  }
}

function reactionExtras(kind, bundle, batch) {
  const newsItems = kind === "wake" ? asList(bundle?.news) : newsItemsFrom(batch);
  let suggestions = {
    text: "",
    steps: [],
    auto: [],
    ask: [],
    tagged: [],
    held: session.integrityOk === false,
  };
  try {
    suggestions = proposeNextSteps({
      kind,
      bundle,
      newsItems,
      integrityOk: session.integrityOk !== false,
    });
  } catch {
    /* the wake still returns without a proposal */
  }
  let urgency = null;
  try {
    urgency = classifyUrgency({
      kind,
      bundle,
      batch,
      integrity: { ok: session.integrityOk !== false },
    });
  } catch {
    urgency = null;
  }
  let curiosity = null;
  try {
    curiosity = offerCuriosity({ bundle, newsItems });
  } catch {
    curiosity = null;
  }
  return { suggestions, urgency, curiosity };
}

function safeFocus(prepare) {
  try {
    return preferredFocus({ prepare: Boolean(prepare) });
  } catch {
    return null;
  }
}

async function maybeHeal(integrity, bundle) {
  if (!healNeeded(integrity, bundle)) return null;
  try {
    return await attemptSelfHeal({
      integrity,
      bundle,
      deps: {
        rerunChecks: async () => {
          if (integrityCheck) return integrityCheck();
          const mod = await import("./atlasStartupIntegrity.js");
          return mod.runStartupIntegrity({ reason: "heal", force: true });
        },
      },
    });
  } catch {
    return null;
  }
}

function publicHeal(heal) {
  if (!heal?.attempted) return null;
  return {
    attempted: true,
    recovered: Boolean(heal.recovered),
    repairs: heal.repairs || [],
    cleared: heal.cleared || [],
    ask: heal.ask || [],
    executed: heal.executed || [],
  };
}

function publicLiteracy(brief) {
  if (!brief?.items?.length) return null;
  return {
    text: brief.text,
    items: brief.items,
    proposed: brief.proposed,
    auto: brief.auto,
    ask: brief.ask,
  };
}

async function createReaction(kind, bundle, batch) {
  const asked = await askAtlas(kind, bundle, batch);
  const brief = asked.literacy?.items ? asked.literacy : literacyFor(kind, bundle, batch);
  // The model may return a one-line disclaimer. The operator path is the
  // literacy brief: source, what changed, why it matters, summary.
  const literacyText = brief.text || "";
  // L2 news may act only on ids L3 already marked AUTO. Wake explains and
  // proposes, and does not add those ids unless the model asked for them.
  const newsIngress = kind === "ingress" && brief.items.length > 0 && session.integrityOk !== false;
  const gated = session.integrityOk === false
    ? { actions: [], ask: [], tagged: [] }
    : gateResidentProposal(
        [...asList(asked.actions), ...(newsIngress ? brief.auto : [])],
        [...asList(asked.ask), ...(newsIngress ? brief.ask : [])],
      );
  const summary = asAtlasLine(clip(asked.summary, 900) || (kind === "wake" ? mechanicalWakeSummary(bundle) : mechanicalIngressSummary(batch)));
  const decisionLine = logResidentDecisions(kind, gated, brief, asked);
  const extras = reactionExtras(kind, bundle, batch);
  seq += 1;
  return {
    id: `atlas-${kind}-${seq}`,
    seq,
    kind,
    summary,
    recallLine: asked.recallLine || "",
    decisionLine,
    newsLiteracy: literacyText,
    literacy: publicLiteracy(brief),
    suggestions: extras.suggestions,
    urgency: extras.urgency,
    curiosity: extras.curiosity,
    actions: gated.actions,
    ask: gated.ask,
    tagged: gated.tagged,
    fallback: asked.fallback || null,
    model: asked.model || null,
    at: new Date().toISOString(),
  };
}

function toPublic(reaction) {
  return {
    ok: true,
    resident: true,
    awake: true,
    name: "Atlas",
    sessionId: session.id,
    id: reaction.id,
    seq: reaction.seq,
    kind: reaction.kind,
    summary: reaction.summary,
    recallLine: reaction.recallLine || "",
    decisionLine: reaction.decisionLine || "",
    newsLiteracy: reaction.newsLiteracy || "",
    literacy: reaction.literacy || null,
    integrity: reaction.integrity || null,
    suggestions: reaction.suggestions || null,
    urgency: reaction.urgency || null,
    curiosity: reaction.curiosity || null,
    heal: reaction.heal || null,
    focus: reaction.focus || null,
    actions: reaction.actions || [],
    ask: reaction.ask || [],
    tagged: reaction.tagged || [],
    trustLine: trustLineForResult(reaction.tagged, { empty: "lettura" }),
    fallback: reaction.fallback || null,
    model: reaction.model || null,
    at: reaction.at,
  };
}

function attachContinuity(row, collected, { requested = "", preferStored = false } = {}) {
  let previous = null;
  try {
    previous = readAtlasSession();
  } catch {
    previous = null;
  }
  row.restored = restoredFrom(previous, {
    applyModule: Boolean(preferStored && !requested && previous?.module),
  });
  try {
    row.stateReply = answerFromBundle("stato della plancia", collected || {}).reply;
  } catch {
    row.stateReply = "";
  }
  try {
    const spend = assessLiveSpend({ tier: "router" });
    row.budgetLine = spend.relevant ? asAtlasLine(spend.line) : "";
  } catch {
    row.budgetLine = "";
  }
  try {
    rememberWake({
      wakeSummary: row.summary,
      module: collected?.module || requested || previous?.module || "map",
      pendingAsk: row.ask || [],
    });
  } catch {
    /* the wake still returns if the session file cannot be written */
  }
  return row;
}

export function answerResidentState(question, { module } = {}) {
  if (!session.lastBundle) return null;
  const answered = answerFromBundle(question, session.lastBundle, {
    module: module || session.lastBundle.module,
  });
  return { ...answered, source: "resident", live: false };
}

function publicState(bundle) {
  return {
    module: bundle?.module || "map",
    generatedAt: bundle?.generatedAt || null,
    health: bundle?.health || null,
    board: {
      ok: bundle?.board?.ok ?? null,
      error: bundle?.board?.error ?? null,
      unverified: bundle?.board?.unverified ?? null,
    },
    updates: bundle?.updates?.length || 0,
    news: bundle?.news?.length || 0,
    problems: bundle?.problemCount || 0,
  };
}

function publish(row) {
  ring.push(row);
  if (ring.length > 40) ring.shift();
  const packet = `id: ${row.seq}\ndata: ${JSON.stringify(row)}\n\n`;
  for (const res of listenerSet) {
    try {
      res.write(packet);
    } catch {
      listenerSet.delete(res);
    }
  }
}

function kick() {
  // Model turns wait for an open plancia stream. With no listener the raw
  // event stays queued for the next wake or the next subscribe.
  if (hold > 0 || !session.awake || listenerSet.size === 0) return;
  drainChain = drainChain
    .then(runDrain)
    .catch((err) => {
      console.warn("[atlas-resident]", err?.message || err);
    });
}

async function runDrain() {
  if (hold > 0 || !session.awake || running || listenerSet.size === 0) return;
  running = true;
  try {
    while (pending.length && hold === 0 && session.awake && listenerSet.size > 0) {
      const batch = pending.splice(0, pending.length);
      const reaction = await createReaction("ingress", session.lastBundle, batch);
      publish(toPublic(reaction));
    }
  } finally {
    running = false;
  }
}

function enqueueIngress(event) {
  pending.push(event);
  if (pending.length > 30) pending.splice(0, pending.length - 30);
  kick();
}

export function installAtlasResident() {
  if (installed) return residentStatus();
  installed = true;
  onResidentIngress(enqueueIngress);
  return residentStatus();
}

export function residentStatus() {
  return {
    ok: true,
    name: "Atlas",
    resident: true,
    installed,
    awake: session.awake,
    sessionId: session.id,
    listeners: listenerSet.size,
    lastWakeAt: session.lastWakeAt,
    pending: pending.length,
    decisions: decisionStatus({ limit: 5 }),
    providers: providerStatus(),
  };
}

async function readWakeIntegrity() {
  if (integrityCheck) return integrityCheck();
  try {
    return await runStartupIntegrity({ reason: "wake" });
  } catch (err) {
    return {
      ok: false,
      hardFail: true,
      failures: [{ id: "integrity-runner", detail: err?.message || "integrità non eseguita" }],
      checks: [],
    };
  }
}

function integrityStamp(integrity, gated) {
  return {
    ok: integrity?.ok !== false,
    wakeGated: Boolean(gated),
    failures: integrity?.failures || [],
    at: integrity?.at || null,
  };
}

async function doWake(input = {}) {
  session.awake = true;
  if (!session.id) session.id = crypto.randomUUID();
  // Hold before the integrity check so a failure update cannot drain as a
  // second model turn while this wake is still reading the report.
  hold += 1;
  let integrity;
  try {
    integrity = await readWakeIntegrity();
    const requested = clip(input.module || input.uiState?.module || "", 40);
    const preferStored = input.preferStored === true || input.preferStoredModule === true;
    const prepareHabits = input.prepareHabits === true;
    let storedModule = "";
    if (!requested) {
      try {
        storedModule = readAtlasSession().module || "";
      } catch {
        storedModule = "";
      }
    }
    const focus = safeFocus(prepareHabits);
    let moduleName = requested || (preferStored ? storedModule : "") || "map";
    if (focus?.apply && focus.module) moduleName = focus.module;
    const collected = await collectWakeBundle({ module: moduleName });
    if (!Array.isArray(collected.news)) collected.news = [];
    const queued = mergeQueued(collected, pending.splice(0, pending.length));
    const kept = [];
    const seenNews = new Set(collected.news.map((n) => n.title).filter(Boolean));
    for (const ev of queued) {
      if (ev?.kind === "news") {
        for (const item of newsItemsFrom(ev)) {
          if (!item?.title || seenNews.has(item.title) || collected.news.length >= 6) continue;
          collected.news.push({
            title: clip(item.title, 180),
            source: clip(item.source || "fonte esterna", 80),
            summary: clip(item.summary, 220),
            change: item.change || "",
            previousTitle: clip(item.previousTitle || "", 180),
          });
          seenNews.add(item.title);
        }
        continue;
      }
      kept.push(ev);
    }
    collected.queuedIngress = kept;
    session.lastBundle = collected;
    let heal = null;
    if (healNeeded(integrity, collected)) {
      heal = await maybeHeal(integrity, collected);
      if (heal?.recovered && heal.integrity) integrity = heal.integrity;
    }
    session.integrityOk = integrity?.ok !== false;
    if (!session.integrityOk) {
      const brief = literacyFor("wake", collected, null);
      const detail = (integrity.failures || []).map((failure) => `${failure.id}: ${failure.detail}`).join("; ");
      const recalled = safeRecall(recallQueryFromBundle(collected));
      const wakeEntry = recordDecision({
        source: "wake",
        choices: [
          {
            action: "none",
            mode: "ask",
            reason: "integrity",
            because: "Integrità di avvio non superata: non eseguo passi sulla plancia.",
          },
        ],
      });
      const newsEntry = brief.items?.length
        ? recordDecision({
            source: "news",
            choices: [
              {
                action: "news",
                mode: "ask",
                reason: "integrity",
                because: "Integrità non superata: spiego le news e non eseguo il passo news.",
              },
            ],
          })
        : null;
      const extras = reactionExtras("wake", collected, null);
      seq += 1;
      const reaction = {
        id: `atlas-wake-${seq}`,
        seq,
        kind: "wake",
        summary: asAtlasLine(
          `Integrità di avvio non superata. Non eseguo passi sulla plancia finché i controlli non tornano interi. ${detail}`,
        ),
        recallLine: recalled.line,
        decisionLine: [decisionLines([wakeEntry, newsEntry]), heal?.decisionLine].filter(Boolean).join(" | "),
        newsLiteracy: brief.text,
        literacy: publicLiteracy(brief),
        suggestions: extras.suggestions,
        urgency: extras.urgency,
        curiosity: extras.curiosity,
        heal: publicHeal(heal),
        focus: focus || null,
        actions: [],
        ask: [],
        tagged: [],
        fallback: "integrity",
        model: null,
        integrity: integrityStamp(integrity, true),
        at: new Date().toISOString(),
      };
      session.lastWakeAt = reaction.at;
      const row = attachContinuity(
        { ...toPublic(reaction), shot: "once", state: publicState(collected) },
        collected,
        { requested, preferStored },
      );
      publish(row);
      return row;
    }
    const reaction = await createReaction("wake", collected, null);
    reaction.integrity = integrityStamp(integrity, false);
    reaction.heal = publicHeal(heal);
    reaction.focus = focus || null;
    if (heal?.decisionLine) {
      reaction.decisionLine = [reaction.decisionLine, heal.decisionLine].filter(Boolean).join(" | ");
    }
    session.lastWakeAt = reaction.at;
    const row = attachContinuity(
      { ...toPublic(reaction), shot: "once", state: publicState(collected) },
      collected,
      { requested, preferStored },
    );
    publish(row);
    return row;
  } finally {
    hold -= 1;
    kick();
  }
}

/** One in-flight wake. A second caller joins it instead of starting another model request. */
export function wakeResident(input = {}) {
  if (wakePromise) return wakePromise;
  wakePromise = doWake(input).finally(() => {
    wakePromise = null;
  });
  return wakePromise;
}

export function subscribeResidentStream(req, res, { after = 0 } = {}) {
  // Disable the socket idle timer. This is not a poll; events are written only from hooks.
  try {
    req?.setTimeout?.(0);
  } catch {
    /* ignore */
  }
  try {
    res.setTimeout?.(0);
  } catch {
    /* ignore */
  }
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 4000\n\n");
  const from = Number(after) || 0;
  for (const row of ring) {
    if (row.seq > from) res.write(`id: ${row.seq}\ndata: ${JSON.stringify(row)}\n\n`);
  }
  listenerSet.add(res);
  kick();
  const close = () => {
    listenerSet.delete(res);
  };
  res.on?.("close", close);
  req?.on?.("close", close);
}

export function residentIdle() {
  return drainChain;
}

export function resetResidentForTests() {
  pending = [];
  ring = [];
  seq = 0;
  hold = 0;
  running = false;
  wakePromise = null;
  session = emptySession();
  listenerSet = new Set();
  completerOverride = null;
  paidCheck = () => isAiPaid();
  newsLoader = defaultNewsLoader;
  collectOverride = null;
  integrityCheck = null;
}

export function setResidentCompleterForTests(fn) {
  completerOverride = typeof fn === "function" ? fn : null;
}

export function setResidentPaidCheckForTests(fn) {
  paidCheck = typeof fn === "function" ? fn : () => isAiPaid();
}

export function setResidentNewsLoaderForTests(fn) {
  newsLoader = typeof fn === "function" ? fn : defaultNewsLoader;
}

export function setResidentCollectorForTests(fn) {
  collectOverride = typeof fn === "function" ? fn : null;
}

export function setResidentIntegrityCheckForTests(fn) {
  integrityCheck = typeof fn === "function" ? fn : null;
}

export function setResidentAwakeForTests(on = true) {
  session.awake = Boolean(on);
  if (session.awake && !session.id) session.id = "test-session";
  if (session.awake && !session.lastBundle) {
    session.lastBundle = {
      compact: true,
      module: "map",
      generatedAt: new Date().toISOString(),
      health: { status: "ok", score: 80, openErrors: 0 },
      pipelineHealth: 80,
      tops: [],
      openErrors: [],
      board: { ok: 1, error: 0, unverified: 0, total: 1 },
      updates: [],
      problems: [],
      problemCount: 0,
      news: [],
      queuedIngress: [],
    };
  }
}

installAtlasResident();
