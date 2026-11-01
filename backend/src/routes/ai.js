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
import { transcribeAudio } from "../services/openrouter.js";

export const aiRouter = Router();

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
