/**
 * Two-tier (+ Grok power) agent: router → main → optional Grok.
 * Budget hard-cap enforced; unused budget never filled.
 */
import { config } from "../config.js";
import { completeChat } from "./openrouter.js";
import { assertCanCall, recordCompletion, getBudgetStatus } from "./aiBudget.js";
import { PANEL_CATALOG, SYSTEM_CARD, sanitizeActions } from "./panelCatalog.js";
import { getDashboardSnapshot, searchCrossThreadMemory } from "../memory/store.js";
import {
  saveBriefingSession,
  insertSuggestions,
  listSuggestions,
  latestBriefingForDay,
} from "../memory/aiStore.js";
import { refreshWorldNews, getCachedNews } from "./newsIngest.js";
import { budgetDayKey } from "./aiBudget.js";
import { isAiPaid } from "../middleware/aiPaidGate.js";

function extractJsonObject(text) {
  const raw = String(text || "").trim();
  try {
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    return JSON.parse(m[0]);
  } catch {
    return null;
  }
}

async function callTier(tier, { system, prompt, maxTokens, temperature }) {
  assertCanCall(tier);
  const model =
    tier === "router"
      ? config.aiRouterModel
      : tier === "grok"
        ? config.aiGrokModel
        : config.aiMainModel;
  const result = await completeChat({
    system,
    prompt,
    model,
    maxTokens,
    temperature,
  });
  recordCompletion({ tier, model: result.model, usage: result.usage });
  return { ...result, tier };
}

/**
 * Router decides: answer_local | escalate_main | escalate_grok | opening_questions
 * Grok override: when task needs more power, spend from daily hard cap and log reason.
 */
export async function runAiTurn({
  message,
  q1 = "",
  q2 = "",
  q3 = "",
  uiState = {},
  forceTier = null,
} = {}) {
  // Free tier: no models at all — mechanical data only
  if (!isAiPaid()) {
    return {
      route: "blocked_free",
      reply: "Piano free: nessun modello AI. Usa i dati meccanici della plancia.",
      actions: [],
      tier: "none",
      model: null,
      escalate_reason: null,
      escalateReason: null,
      budget: getBudgetStatus(),
      blocked: true,
      code: "AI_PAYMENT_REQUIRED",
    };
  }

  const catalogBrief = PANEL_CATALOG.map((p) => `${p.id}:${p.label}`).join(", ");

  if (forceTier === "grok" || forceTier === "main" || forceTier === "router") {
    const tier = forceTier;
    const out = await callTier(tier, {
      system: `${SYSTEM_CARD}\nPanels: ${catalogBrief}`,
      prompt: message || "Status",
      maxTokens: tier === "router" ? 400 : 900,
    });
    return {
      route: `force_${tier}`,
      reply: out.content,
      actions: [],
      tier: out.tier,
      model: out.model,
      escalate_reason: forceTier !== "router" ? `force_${forceTier}` : null,
      escalateReason: forceTier !== "router" ? `force_${forceTier}` : null,
      budget: getBudgetStatus(),
    };
  }

  const routerSystem = [
    "You are the cheap OPS dashboard front-agent.",
    "Reply ONLY with compact JSON:",
    '{"route":"answer_local"|"escalate_main"|"escalate_grok"|"need_questions",',
    '"reply":"italian short text if answer_local",',
    '"actions":["map"|"zoom-in"|...],',
    '"escalate_reason":"why main/grok if escalating",',
    '"questions":{"ask":true|false}}',
    "Use escalate_grok only for hard multi-step analysis / deep advice / complex briefing.",
    "Use escalate_main for normal analysis. Prefer answer_local for greetings and simple nav.",
    `Panels: ${catalogBrief}`,
    `Goals so far: q1=${q1 || "—"} q2=${q2 || "—"} q3=${q3 || "—"}`,
    `UI module=${uiState.module || "map"}`,
  ].join("\n");

  let routerRaw;
  try {
    routerRaw = await callTier("router", {
      system: routerSystem,
      prompt: message || "(empty)",
      maxTokens: 350,
      temperature: 0.1,
    });
  } catch (err) {
    if (err.code === "AI_BUDGET_HARD" || err.code === "NO_OPENROUTER") {
      return {
        route: err.code === "NO_OPENROUTER" ? "no_openrouter" : "budget_hard",
        reply:
          err.code === "NO_OPENROUTER"
            ? "OpenRouter non configurato. Dati meccanici disponibili senza AI."
            : "Cap AI giornaliero raggiunto. Continuo solo con dati meccanici.",
        actions: [],
        tier: "none",
        model: null,
        escalate_reason: null,
        escalateReason: null,
        budget: err.budget || getBudgetStatus(),
        blocked: true,
        code: err.code,
      };
    }
    throw err;
  }

  const parsed = extractJsonObject(routerRaw.content) || {
    route: "answer_local",
    reply: routerRaw.content,
    actions: [],
  };

  const route = parsed.route || "answer_local";
  const actions = sanitizeActions(parsed.actions);

  if (route === "need_questions" || parsed.questions?.ask) {
    return {
      route: "need_questions",
      reply:
        parsed.reply ||
        "Prima di procedere: 1) Cosa vuoi fare oggi? 2) Come vuoi procedere? 3) Qual è l'obiettivo di oggi?",
      actions,
      tier: "router",
      model: routerRaw.model,
      escalate_reason: null,
      escalateReason: null,
      needQuestions: true,
      budget: getBudgetStatus(),
    };
  }

  if (route === "answer_local" || (!route.includes("escalate") && parsed.reply)) {
    return {
      route: "answer_local",
      reply: parsed.reply || routerRaw.content,
      actions,
      tier: "router",
      model: routerRaw.model,
      escalate_reason: null,
      escalateReason: null,
      budget: getBudgetStatus(),
    };
  }

  const wantGrok = route === "escalate_grok";
  const escalateReason =
    parsed.escalate_reason ||
    (wantGrok ? "router_judged_needs_grok" : "router_judged_needs_main");

  let tier = wantGrok ? "grok" : "main";
  try {
    assertCanCall(tier);
  } catch (err) {
    if (err.code === "AI_BUDGET_SOFT" && tier === "grok") {
      // Downgrade grok → main if soft; if main also soft, fall back to router reply
      try {
        assertCanCall("main");
        tier = "main";
      } catch {
        return {
          route: "answer_local",
          reply:
            parsed.reply ||
            routerRaw.content ||
            "Budget AI in fascia soft: resto sull'agente economico. Riprova domani per analisi potenziata.",
          actions,
          tier: "router",
          model: routerRaw.model,
          escalate_reason: `blocked_${err.code}`,
          escalateReason: `blocked_${err.code}`,
          budget: getBudgetStatus(),
          blocked: true,
        };
      }
    } else if (err.code === "AI_BUDGET_SOFT" || err.code === "AI_BUDGET_HARD") {
      return {
        route: "answer_local",
        reply:
          parsed.reply ||
          "Cap/fascia budget: nessuna escalation. Ecco quanto posso dire in locale: " +
            (parsed.reply || "usa i pannelli meccanici."),
        actions,
        tier: "router",
        model: routerRaw.model,
        escalate_reason: `blocked_${err.code}`,
        escalateReason: `blocked_${err.code}`,
        budget: getBudgetStatus(),
        blocked: true,
      };
    } else {
      throw err;
    }
  }

  const snap = getDashboardSnapshot();
  const news = getCachedNews(8);
  const crossMem = searchCrossThreadMemory(message, { limit: 8 });
  const mainSystem = [
    SYSTEM_CARD,
    "Rispondi in italiano, conciso. Analizza solo il contesto fornito.",
    "Puoi proporre improvements come JSON opzionale in coda:",
    '<!--SUGGESTIONS:[{"area":"...","issue":"...","evidence":"...","effort":"l|m|h","action":"refresh"|{}}]-->',
    `Escalate path: ${tier} reason: ${escalateReason}`,
  ].join("\n");

  const context = {
    goals: { q1, q2, q3 },
    ui: uiState,
    day: snap.day_key,
    health: snap.health,
    tops: (snap.tops || []).slice(0, 8),
    errors_open: (snap.errors || []).filter((e) => e.status === "open").slice(0, 8),
    coverage: snap.coverage,
    consistency: (snap.consistency || []).slice(0, 6),
    memory_concepts: (snap.memory?.concepts || []).slice(0, 12),
    cross_thread_memory: crossMem.map((m) => ({
      thread: m.thread_title,
      role: m.role,
      content: String(m.content || "").slice(0, 280),
      attachment: m.attachment_name || null,
    })),
    news: news.map((n) => ({
      id: n.id,
      title: n.title,
      lat: n.lat,
      lon: n.lon,
      source: n.source,
    })),
    panels: PANEL_CATALOG,
  };

  const powered = await callTier(tier, {
    system: mainSystem,
    prompt: `Contesto:\n${JSON.stringify(context)}\n\nMessaggio utente:\n${message}`,
    maxTokens: tier === "grok" ? 1200 : 900,
    temperature: 0.25,
  });

  console.info(`[ai] escalate ${routerRaw.model} → ${powered.model} (${tier}): ${escalateReason}`);

  return {
    route: wantGrok ? "escalate_grok" : "escalate_main",
    reply: powered.content,
    actions,
    tier: powered.tier,
    model: powered.model,
    escalate_reason: escalateReason,
    escalateReason,
    budget: getBudgetStatus(),
  };
}

export async function runOpeningAndBriefing({ q1, q2, q3, uiState = {} } = {}) {
  const dayKey = budgetDayKey();
  // Mechanical news first (no AI)
  const news = await refreshWorldNews({ force: false });
  const existing = latestBriefingForDay(dayKey);
  if (existing && q1 && existing.q1 === q1 && existing.q2 === q2 && existing.q3 === q3) {
    return {
      briefing: existing.briefing_text,
      suggestions: listSuggestions(dayKey, 8),
      news,
      reused: true,
      budget: getBudgetStatus(),
    };
  }

  const turn = await runAiTurn({
    message: [
      "Genera il briefing di login personalizzato.",
      "Includi: salute pipeline, tops rilevanti, errori aperti, 3-5 news collegate al globo,",
      "e 2-4 improvement suggestions allineate agli obiettivi.",
      'Alla fine aggiungi <!--SUGGESTIONS:[{"area":"...","issue":"...","evidence":"...","effort":"l|m|h","action":"refresh"}]-->',
    ].join(" "),
    q1,
    q2,
    q3,
    uiState,
    // Briefing is analysis-heavy: allow router to pick; prefer main unless router says grok
  });

  let suggestions = [];
  const sugMatch = turn.reply?.match(/<!--SUGGESTIONS:([\s\S]*?)-->/);
  if (sugMatch) {
    try {
      suggestions = JSON.parse(sugMatch[1]);
    } catch {
      suggestions = [];
    }
  }
  if (!Array.isArray(suggestions)) suggestions = [];
  if (suggestions.length) insertSuggestions(dayKey, suggestions);

  const briefingText = (turn.reply || "").replace(/<!--SUGGESTIONS:[\s\S]*?-->/, "").trim();
  saveBriefingSession({
    dayKey,
    q1,
    q2,
    q3,
    briefingText,
    suggestions,
    newsIds: news.map((n) => n.id),
  });

  return {
    briefing: briefingText,
    suggestions: listSuggestions(dayKey, 8),
    news,
    tier: turn.tier,
    model: turn.model,
    escalateReason: turn.escalateReason,
    actions: turn.actions || [],
    budget: turn.budget,
    reused: false,
  };
}

export async function runProactiveSuggestions({ q1 = "", q2 = "", q3 = "" } = {}) {
  const dayKey = budgetDayKey();
  const turn = await runAiTurn({
    message:
      "Proponi 3 miglioramenti proattivi al dashboard (JSON only array in <!--SUGGESTIONS:[...]-->). Usa memoria SQLite e news.",
    q1,
    q2,
    q3,
  });
  let suggestions = [];
  const sugMatch = turn.reply?.match(/<!--SUGGESTIONS:([\s\S]*?)-->/);
  if (sugMatch) {
    try {
      suggestions = JSON.parse(sugMatch[1]);
    } catch {
      suggestions = [];
    }
  }
  if (suggestions.length) insertSuggestions(dayKey, suggestions);
  return {
    reply: turn.reply,
    suggestions: listSuggestions(dayKey, 8),
    tier: turn.tier,
    model: turn.model,
    escalateReason: turn.escalateReason,
    budget: turn.budget,
  };
}
