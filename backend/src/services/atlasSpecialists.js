/**
 * J1: thin specialists behind Atlas.
 * The router picks one of state, news, hands, or research.
 * Replies stay in Atlas's voice.
 */
import { asAtlasLine } from "./atlasPersonality.js";
import { routeAtlasTurn } from "./atlasRoute.js";
import { recordDecision } from "./atlasDecisionLog.js";
import { noteToolCall } from "./atlasToolLog.js";
import { isAiPaid } from "../middleware/aiPaidGate.js";
import { searchRefusal } from "./atlasSearchGate.js";

function extractSearchQuery(text) {
  return String(text || "")
    .replace(/^(?:atlas\s+|agent\s*q\s+)?(?:cerca|ricerca|search)\s+/i, "")
    .trim();
}

function memoryQuery(text) {
  return String(text || "")
    .replace(/^(?:memoria|cosa\s+ricordi|leggi\s+memoria|note\s+in\s+memoria)\s*/i, "")
    .replace(/^cerca\s+in\s+memoria\s*/i, "")
    .trim();
}

async function defaultState(text, route) {
  if (route.intent === "problems") {
    const { getAgentqProblems } = await import("./agentqBridge.js");
    const problems = await getAgentqProblems({ limit: 12 });
    const list = Array.isArray(problems?.problems) ? problems.problems : [];
    const count = Number(problems?.count ?? list.length) || 0;
    const lines = list.slice(0, 5).map((row, index) => `${index + 1}. ${row.title || "Problema"}`);
    const body = count
      ? `Problemi aperti: ${count}. ${lines.join(" ")}`
      : "Nessun errore o problema aperto sulla plancia.";
    return {
      ok: true,
      reply: asAtlasLine(body),
      problems,
      actions: [],
      ask: [],
    };
  }
  const { answerPlanciaStateLive } = await import("./atlasStateAnswer.js");
  const answered = await answerPlanciaStateLive({ question: text, module: route.module || "map" });
  return { ...answered, actions: [], ask: [] };
}

async function defaultNews() {
  const { getCachedNews } = await import("./newsIngest.js");
  const { getEntryUpdates } = await import("./agentqBridge.js");
  const { explainNewsForOperator } = await import("./atlasNewsLiteracy.js");
  const news = getCachedNews(6) || [];
  const explained = explainNewsForOperator(news, {});
  const updates = getEntryUpdates({ limit: 4 });
  const text = explained.text || "Nessuna news in cache. Non invento titoli.";
  const updateCount = Array.isArray(updates?.updates) ? updates.updates.length : 0;
  const reply = asAtlasLine(updateCount ? `${text} Aggiornamenti in ingresso: ${updateCount}.` : text);
  return {
    ok: true,
    reply,
    newsLiteracy: explained.text || "",
    actions: explained.auto || [],
    ask: explained.ask || [],
    tagged: [
      ...(explained.auto || []).map((id) => ({ id, mode: "auto", reason: "updates" })),
      ...(explained.ask || []),
    ],
  };
}

async function defaultHands(text, route) {
  if (route.workflowId) {
    const { runWorkflow } = await import("./atlasWorkflows.js");
    return runWorkflow(route.workflowId);
  }
  const local = await handsAreLocal(text);
  if (!local && !isAiPaid()) {
    return {
      ok: false,
      status: 402,
      code: "AI_PAYMENT_REQUIRED",
      reply: asAtlasLine("Questo passo mani usa il modello ed è nel tier a pagamento."),
      actions: [],
      ask: [],
    };
  }
  const { planHandActions } = await import("./agentqBridge.js");
  const plan = await planHandActions(text);
  return {
    ...plan,
    reply: plan.speak ? asAtlasLine(plan.speak) : asAtlasLine("Nessuna azione plancia per questo comando."),
  };
}

async function defaultResearch(text, route) {
  if (route.intent === "refused") {
    return { ok: false, searched: false, onDemand: false, reply: searchRefusal(), actions: [], ask: [] };
  }
  if (route.intent === "memory-recall") {
    const { listExpandableMemory } = await import("./agentqBridge.js");
    const listed = listExpandableMemory({ limit: 8, query: memoryQuery(text) });
    const entries = listed.entries || [];
    const body = entries.length
      ? `Memoria (${listed.count ?? entries.length}). ${entries
          .slice(0, 4)
          .map((entry) => entry.title || "Nota")
          .join("; ")}.`
      : "La memoria non ha ancora note per questa richiesta.";
    return { ok: true, searched: false, onDemand: false, reply: asAtlasLine(body), entries, actions: [], ask: [] };
  }
  if (route.intent === "memory-write") {
    const note = text.replace(/^(?:memorizza|ricorda|salva\s+in\s+memoria)\s*/i, "").trim();
    if (!note) {
      return { ok: false, reply: asAtlasLine("Per espandere la memoria indica cosa salvare."), actions: [], ask: [] };
    }
    const { rememberDurableNote } = await import("./atlasRecall.js");
    const saved = rememberDurableNote({ title: note.slice(0, 80), text: note, tags: ["voice"] });
    return {
      ok: true,
      searched: false,
      reply: asAtlasLine(`Memoria aggiornata (${saved.count} note).`),
      entry: saved.entry,
      actions: [],
      ask: [],
    };
  }
  if (!isAiPaid()) {
    return {
      ok: false,
      status: 402,
      code: "AI_PAYMENT_REQUIRED",
      searched: false,
      reply: asAtlasLine("La ricerca è nel tier a pagamento."),
      actions: [],
      ask: [],
    };
  }
  const { runAgentqSearch } = await import("./agentqBridge.js");
  const query = extractSearchQuery(text);
  if (!query) {
    return { ok: false, searched: false, reply: asAtlasLine("Dimmi cosa cercare."), actions: [], ask: [] };
  }
  const result = await runAgentqSearch(query);
  const count = result.hits?.length || 0;
  return {
    ...result,
    reply: asAtlasLine(count ? `Ricerca «${query}»: ${count} risultati.` : `Nessun risultato per «${query}».`),
    actions: [],
    ask: [],
  };
}

let localPlan = null;
async function handsAreLocal(text) {
  if (!localPlan) {
    const mod = await import("./atlasHandsPlan.js");
    localPlan = mod.planHandsFromUtterance;
  }
  return localPlan(text).matched === true;
}

/**
 * Run exactly one specialist. `deps` may replace a specialist for tests.
 * The others are not called.
 */
export async function dispatchAtlasTurn(text, deps = {}) {
  const route = routeAtlasTurn(text);
  if (deps.module) route.module = deps.module;
  const base = {
    name: "Atlas",
    speaker: "Atlas",
    route,
    specialist: route.specialist,
    fanout: false,
  };
  if (!route.specialist) {
    return { ...base, ok: true, handled: false, reply: "" };
  }
  const table = {
    state: deps.state || defaultState,
    news: deps.news || defaultNews,
    hands: deps.hands || defaultHands,
    research: deps.research || defaultResearch,
  };
  const result = await table[route.specialist](text, route);
  noteToolCall({
    name: `atlas.${route.specialist}`,
    mode: result?.ask?.length ? "ask" : "auto",
    stub: false,
    ok: result?.ok !== false,
    detail: route.workflowId || route.intent || route.specialist,
  });
  recordDecision({
    source: "route",
    choices: [
      {
        action: route.specialist,
        mode: "auto",
        reason: route.intent || "route",
        because: `Router: un solo specialista (${route.specialist}) per questo turno.`,
      },
    ],
  });
  return {
    ...base,
    ...result,
    name: "Atlas",
    speaker: "Atlas",
    route,
    specialist: route.specialist,
    fanout: false,
    handled: true,
  };
}
