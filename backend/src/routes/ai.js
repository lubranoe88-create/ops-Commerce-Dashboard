import { Router } from "express";
import { requireAiPaid, aiEntitlementPayload, isAiPaid } from "../middleware/aiPaidGate.js";
import { getBudgetStatus } from "../services/aiBudget.js";
import {
  runAiTurn,
  runOpeningAndBriefing,
  runProactiveSuggestions,
} from "../services/aiAgent.js";
import { refreshWorldNews, getCachedNews } from "../services/newsIngest.js";
import { listSuggestions } from "../memory/aiStore.js";
import { budgetDayKey } from "../services/aiBudget.js";
import { ACTION_ALLOWLIST } from "../services/panelCatalog.js";
import { config } from "../config.js";

export const aiRouter = Router();

aiRouter.get("/status", (_req, res) => {
  res.json({
    ...aiEntitlementPayload(),
    budget: getBudgetStatus(),
    browserUse: {
      available: false,
      reason: "sidecar_not_deployed",
      note: "browser-use is scaffolded; actions[] covers plancia commands",
    },
  });
});

aiRouter.get("/budget", requireAiPaid, (_req, res) => {
  res.json(getBudgetStatus());
});

aiRouter.get("/news", async (_req, res) => {
  try {
    const news = await refreshWorldNews({ force: false });
    res.json({ news, mechanical: true });
  } catch (err) {
    res.status(500).json({ error: err.message || "news failed", news: getCachedNews() });
  }
});

aiRouter.get("/suggestions", requireAiPaid, (_req, res) => {
  res.json({ suggestions: listSuggestions(budgetDayKey(), 20) });
});

/** Catalog of first-class actions the client may execute from actions[]. */
aiRouter.get("/actions/catalog", (_req, res) => {
  res.json({ actions: [...ACTION_ALLOWLIST] });
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
    res.json(result);
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

/**
 * browser-use fallback — not wired to a Python sidecar in this deploy.
 * Returns 501 so clients fall back to actions[].
 */
aiRouter.post("/browser-use", requireAiPaid, (req, res) => {
  if (!isAiPaid()) {
    return res.status(402).json({ error: "AI paid tier required" });
  }
  res.status(501).json({
    error: "browser-use sidecar not deployed",
    code: "BROWSER_USE_UNAVAILABLE",
    hint: "Use actions[] for zoom/fly/module; deploy browser-use worker to enable click-anywhere",
    requested: {
      goal: req.body?.goal || null,
      selector: req.body?.selector || null,
    },
  });
});
