import { Router } from "express";
import { requireAiPaid, aiEntitlementPayload, isAiPaid } from "../middleware/aiPaidGate.js";
import {
  getBudgetStatus,
  getUsageAdmin,
  budgetDayKey,
  recordTestSpend,
} from "../services/aiBudget.js";
import {
  runAiTurn,
  runOpeningAndBriefing,
  runProactiveSuggestions,
} from "../services/aiAgent.js";
import { refreshWorldNews, getCachedNews } from "../services/newsIngest.js";
import {
  listSuggestions,
  syncClientMemory,
  getClientMemory,
  upsertUserPref,
} from "../memory/aiStore.js";
import { ACTION_ALLOWLIST, ACTION_CATALOG } from "../services/panelCatalog.js";
import { executeWriteAction, listPrefs } from "../services/actionExecutor.js";
import {
  pollProactive,
  setProactiveTtsOptIn,
  forceIdleNudgeForTest,
} from "../services/proactive.js";
import { browserUseStatus, runBrowserUse, resolveAllowOrigin } from "../services/browserUse.js";
import {
  buildFunctionBoard,
  reportFunctionStatus,
  FUNCTION_CATALOG,
} from "../services/functionBoard.js";
import { config } from "../config.js";
import { transcribeAudio, synthesizeSpeech } from "../services/openrouter.js";
import {
  agentqStatus,
  runAgentqSearch,
  getEntryUpdates,
  appendEntryUpdate,
  readSandboxDocument,
  planHandActions,
  AGENTQ_HAND_ACTIONS,
  listExpandableMemory,
  appendExpandableMemory,
  getAgentqProblems,
} from "../services/agentqBridge.js";
import { recordAskApproval } from "../services/atlasAutonomyPolicy.js";

export const aiRouter = Router();

/** Agent Q — stato integrazione (chiavi da env plancia, mai in chiaro). */
aiRouter.get("/agentq/status", requireAiPaid, async (_req, res) => {
  try {
    res.json(await agentqStatus());
  } catch (err) {
    res.status(500).json({ error: err.message || "agentq status failed" });
  }
});

/**
 * Ricerca Agent Q — SOLO su richiesta esplicita del client.
 * Body: { query, sources?: ["filesystem","database","memory","api","web_hint"] }
 * Filesystem limitato alla sandbox backend/data/agentq-sandbox.
 * Database: solo SELECT su allowlist (concepts, coverage, errors, tops).
 */
aiRouter.post("/agentq/search", requireAiPaid, async (req, res) => {
  try {
    if (!req.body?.query && !req.body?.q) {
      return res.status(400).json({ error: "query richiesta (ricerca solo on-demand)" });
    }
    const result = await runAgentqSearch(req.body.query || req.body.q, {
      sources: req.body.sources || ["filesystem", "database", "memory", "api", "web_hint"],
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "search failed", code: err.code });
  }
});

/** Aggiornamenti recenti all'ingresso plancia. */
aiRouter.get("/agentq/updates", requireAiPaid, (_req, res) => {
  res.json(getEntryUpdates({ limit: Number(_req.query?.limit) || 12 }));
});

aiRouter.post("/agentq/updates", requireAiPaid, (req, res) => {
  res.json(
    appendEntryUpdate({
      title: req.body?.title,
      detail: req.body?.detail,
    }),
  );
});

/** Pop-up documento da sandbox (testo/PDF base64). */
aiRouter.get("/agentq/document", requireAiPaid, (req, res) => {
  try {
    const rel = String(req.query?.path || req.query?.uri || "").replace(/^sandbox:\/\//, "");
    res.json(readSandboxDocument(rel));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "document failed", code: err.code });
  }
});

/** Mani: propone azioni plancia (moduli/zoom/refresh) via modello env. */
aiRouter.post("/agentq/hands", requireAiPaid, async (req, res) => {
  try {
    const objective = String(req.body?.objective || req.body?.goal || "").trim();
    if (!objective) return res.status(400).json({ error: "objective richiesto" });
    res.json(await planHandActions(objective));
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message || "hands failed",
      code: err.code,
      catalog: AGENTQ_HAND_ACTIONS,
    });
  }
});

aiRouter.get("/agentq/hands/catalog", requireAiPaid, (_req, res) => {
  res.json({ ok: true, actions: AGENTQ_HAND_ACTIONS });
});

/**
 * X1: one explicit confirm of an ASK action id.
 * The third confirm of that same id promotes it into the AUTO overlay.
 */
aiRouter.post("/agentq/autonomy/approve", requireAiPaid, (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const actionId = body.actionId ?? body.id ?? body.action;
    if (actionId == null || (typeof actionId === "string" && !actionId.trim())) {
      return res.status(400).json({ error: "actionId richiesto" });
    }
    const result = recordAskApproval(actionId);
    if (!result.ok) return res.status(400).json(result);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "autonomy approve failed" });
  }
});

/** Memoria espandibile Agent Q — lista / append nel tempo. */
aiRouter.get("/agentq/memory", requireAiPaid, (req, res) => {
  res.json(
    listExpandableMemory({
      limit: Number(req.query?.limit) || 40,
      query: String(req.query?.q || req.query?.query || ""),
    }),
  );
});

aiRouter.post("/agentq/memory", requireAiPaid, (req, res) => {
  const text = String(req.body?.text || req.body?.note || "").trim();
  if (!text) return res.status(400).json({ error: "text richiesto" });
  res.json(
    appendExpandableMemory({
      title: req.body?.title,
      text,
      tags: req.body?.tags,
    }),
  );
});

/** Monitoraggio errori/problemi da sistemare (function-board + pipeline open). */
aiRouter.get("/agentq/problems", requireAiPaid, async (req, res) => {
  try {
    res.json(await getAgentqProblems({ limit: Number(req.query?.limit) || 24 }));
  } catch (err) {
    res.status(500).json({ error: err.message || "problems failed" });
  }
});

/** Entitlement probe — readable without paid gate so free clients see paid:false. */
aiRouter.get("/status", (req, res) => {
  const bu = browserUseStatus();
  bu.allowOrigin = resolveAllowOrigin(req);
  res.json({
    ...aiEntitlementPayload(),
    budget: getBudgetStatus(),
    browserUse: bu,
    proactiveTts: config.aiProactiveTts,
    models: isAiPaid()
      ? {
          router: config.aiRouterModel,
          main: config.aiMainModel,
          grok: config.aiGrokModel,
        }
      : null,
  });
});

/** Mechanical news — zero AI. Still behind site password; not a paid gate. */
aiRouter.get("/news", async (_req, res) => {
  try {
    const news = await refreshWorldNews({ force: false });
    res.json({ news, mechanical: true });
  } catch (err) {
    res.status(500).json({ error: err.message || "news failed", news: getCachedNews() });
  }
});

aiRouter.get("/budget", requireAiPaid, (_req, res) => {
  res.json(getBudgetStatus());
});

/** Admin usage: remaining under cap — never "to burn". */
aiRouter.get("/usage", requireAiPaid, (_req, res) => {
  res.json(getUsageAdmin());
});

aiRouter.get("/suggestions", requireAiPaid, (_req, res) => {
  res.json({ suggestions: listSuggestions(budgetDayKey(), 20) });
});

aiRouter.get("/actions/catalog", requireAiPaid, (_req, res) => {
  res.json({
    actions: [...ACTION_ALLOWLIST],
    catalog: ACTION_CATALOG,
  });
});

aiRouter.post("/actions/execute", requireAiPaid, (req, res) => {
  try {
    const body = req.body || {};
    const action = body.action || body;
    const result = executeWriteAction(action, {
      confirmed: Boolean(body.confirmed || action?.confirmed),
    });
    res.status(result.needsConfirm ? 409 : 200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message || "action failed",
      code: err.code,
    });
  }
});

aiRouter.post("/turn", requireAiPaid, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await runAiTurn({
      message: String(body.message || body.content || "").slice(0, config.maxPromptChars),
      q1: String(body.q1 || "").slice(0, 500),
      q2: String(body.q2 || "").slice(0, 500),
      q3: String(body.q3 || "").slice(0, 500),
      uiState: body.uiState || {},
      forceTier: body.forceTier || null,
    });
    // Canonical JSON: route / reply / actions / escalate_reason
    res.json({
      route: result.route || result.tier || "answer_local",
      reply: result.reply,
      actions: result.actions || [],
      escalate_reason: result.escalate_reason ?? result.escalateReason ?? null,
      tier: result.tier,
      model: result.model,
      needQuestions: result.needQuestions || false,
      blocked: result.blocked || false,
      code: result.code,
      budget: result.budget || getBudgetStatus(),
    });
  } catch (err) {
    res.status(err.status || 502).json({
      error: err.message || "AI turn failed",
      code: err.code,
      budget: err.budget || getBudgetStatus(),
    });
  }
});

aiRouter.post("/briefing", requireAiPaid, async (req, res) => {
  try {
    const body = req.body || {};
    const q1 = String(body.q1 || "").trim();
    const q2 = String(body.q2 || "").trim();
    const q3 = String(body.q3 || "").trim();
    if (!q1 || !q2 || !q3) {
      return res.status(400).json({
        error: "q1, q2, q3 required",
        needQuestions: true,
        questions: [
          "Cosa vuoi fare oggi?",
          "Come vuoi procedere?",
          "Qual è l'obiettivo di oggi?",
        ],
      });
    }
    upsertUserPref("goals", { q1, q2, q3 });
    const result = await runOpeningAndBriefing({
      q1,
      q2,
      q3,
      uiState: body.uiState || {},
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 502).json({
      error: err.message || "Briefing failed",
      code: err.code,
      budget: err.budget || getBudgetStatus(),
    });
  }
});

aiRouter.post("/suggestions/refresh", requireAiPaid, async (req, res) => {
  try {
    const body = req.body || {};
    const result = await runProactiveSuggestions({
      q1: String(body.q1 || ""),
      q2: String(body.q2 || ""),
      q3: String(body.q3 || ""),
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 502).json({
      error: err.message || "Suggestions failed",
      code: err.code,
      budget: err.budget || getBudgetStatus(),
    });
  }
});

aiRouter.post("/suggestions/:id/accept", requireAiPaid, (req, res) => {
  try {
    const id = Number(req.params.id);
    const result = executeWriteAction(
      {
        type: "accept-suggestion",
        id,
        track: req.body?.track !== false,
        confirmed: Boolean(req.body?.confirmed),
      },
      { confirmed: Boolean(req.body?.confirmed) },
    );
    res.status(result.needsConfirm ? 409 : 200).json(result);
  } catch (err) {
    res.status(err.status || 500).json({
      error: err.message || "accept failed",
      code: err.code,
    });
  }
});

aiRouter.post("/client-memory", requireAiPaid, (req, res) => {
  try {
    const dayKey = budgetDayKey();
    const payload = req.body?.payload || req.body || {};
    const id = syncClientMemory(dayKey, payload);
    res.json({ ok: true, id, memory: getClientMemory(dayKey) });
  } catch (err) {
    res.status(500).json({ error: err.message || "client-memory failed" });
  }
});

aiRouter.get("/client-memory", requireAiPaid, (_req, res) => {
  res.json(getClientMemory(budgetDayKey()));
});

aiRouter.get("/prefs", requireAiPaid, (_req, res) => {
  res.json({ prefs: listPrefs() });
});

aiRouter.get("/proactive/poll", requireAiPaid, (_req, res) => {
  res.json(pollProactive({ mark: true }));
});

aiRouter.post("/proactive/tts", requireAiPaid, (req, res) => {
  const on = Boolean(req.body?.enabled ?? req.body?.on);
  res.json(setProactiveTtsOptIn(on));
});

/** Live 2D function board — probes + AI/client overlays. */
aiRouter.get("/function-board", requireAiPaid, async (_req, res) => {
  try {
    res.json(await buildFunctionBoard());
  } catch (err) {
    res.status(500).json({ error: err.message || "function-board failed" });
  }
});

aiRouter.get("/function-board/catalog", requireAiPaid, (_req, res) => {
  res.json({ catalog: FUNCTION_CATALOG });
});

aiRouter.post("/function-board/report", requireAiPaid, (req, res) => {
  try {
    const result = reportFunctionStatus({
      functionId: req.body?.functionId || req.body?.function_id || req.body?.id,
      status: req.body?.status,
      errorType: req.body?.errorType || req.body?.error_type || req.body?.code || "",
      detail: req.body?.detail || req.body?.message || req.body?.error || "",
      source: req.body?.source || "client",
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 400).json({ error: err.message || "report failed" });
  }
});

/**
 * browser-use: Python headless Chrome worker.
 * Off on free tier (requireAiPaid) and when remaining < €3.
 */
aiRouter.post("/browser-use", requireAiPaid, async (req, res) => {
  try {
    const cookie = req.headers.cookie || "";
    const result = await runBrowserUse({
      goal: req.body?.goal || "",
      selector: req.body?.selector || "",
      path: req.body?.path || "/",
      url: req.body?.url || "",
      maxSteps: req.body?.maxSteps,
      cookie,
      allowOrigin: resolveAllowOrigin(req),
    });
    if (!result.ok) {
      const status =
        result.code === "PAYMENT_BLOCKED" || result.code === "ORIGIN_BLOCKED"
          ? 403
          : result.code === "PLAYWRIGHT_MISSING"
            ? 501
            : 502;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(err.status || 502).json({
      error: err.message || "browser-use failed",
      code: err.code,
      budget: err.budget || getBudgetStatus(),
      status: browserUseStatus(),
    });
  }
});

/**
 * Safari/iPad server TTS → client plays via primed AudioContext.
 * Body: { text } → { ok, mime, audioBase64, model }
 */
aiRouter.post("/speak", requireAiPaid, async (req, res) => {
  try {
    const text = String(req.body?.text || req.body?.input || "").trim();
    if (!text) return res.status(400).json({ error: "text richiesto" });
    const result = await synthesizeSpeech({
      text,
      model: req.body?.model || config.openRouterTtsModel,
      voice: req.body?.voice || config.openRouterTtsVoice,
      responseFormat: "mp3",
    });
    res.json({
      ok: true,
      mime: result.mime,
      audioBase64: result.buffer.toString("base64"),
      model: result.model,
      voice: result.voice,
    });
  } catch (err) {
    const status = err.status && Number.isInteger(err.status) ? err.status : 502;
    res.status(status).json({
      error: err.message || "speak failed",
      code: err.code || null,
    });
  }
});

/**
 * Safari/iOS mic fallback: browser records audio, server transcribes via Whisper.
 * Body: { audioBase64, mimeType?, filename? }
 */
aiRouter.post("/transcribe", requireAiPaid, async (req, res) => {
  try {
    const b64 = String(req.body?.audioBase64 || req.body?.audio || "").replace(
      /^data:[^;]+;base64,/,
      "",
    );
    if (!b64) {
      return res.status(400).json({ error: "audioBase64 richiesto" });
    }
    const buffer = Buffer.from(b64, "base64");
    const mimeType = String(req.body?.mimeType || req.body?.mime || "audio/webm");
    const filename =
      String(req.body?.filename || "") ||
      (mimeType.includes("mp4") ? "mic.mp4" : mimeType.includes("ogg") ? "mic.ogg" : "mic.webm");
    const result = await transcribeAudio({
      buffer,
      mimeType,
      filename,
      language: req.body?.language || "it",
    });
    res.json({ text: result.text, model: result.model, ok: true });
  } catch (err) {
    const status = err.status && Number.isInteger(err.status) ? err.status : 502;
    res.status(status).json({
      error: err.message || "transcribe failed",
      code: err.code || null,
    });
  }
});

/** Test-only helpers (no secrets). Disabled unless AI_TEST_HOOKS=1. */
aiRouter.post("/test/spend", requireAiPaid, (req, res) => {
  if (process.env.AI_TEST_HOOKS !== "1") {
    return res.status(404).json({ error: "Not found" });
  }
  const eur = Number(req.body?.eur || 0);
  recordTestSpend(eur, { note: req.body?.note || "test_hook" });
  res.json(getBudgetStatus());
});

aiRouter.post("/test/idle-nudge", requireAiPaid, (req, res) => {
  if (process.env.AI_TEST_HOOKS !== "1") {
    return res.status(404).json({ error: "Not found" });
  }
  forceIdleNudgeForTest();
  res.json(pollProactive({ mark: false }));
});
