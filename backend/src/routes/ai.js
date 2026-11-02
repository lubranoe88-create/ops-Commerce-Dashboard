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
  getAgentqProblems,
} from "../services/agentqBridge.js";
import { recordAskApproval } from "../services/atlasAutonomyPolicy.js";
import {
  installAtlasResident,
  residentStatus,
  subscribeResidentStream,
  wakeResident,
  answerResidentState,
} from "../services/atlasResident.js";
import { readIntegrityReport } from "../services/atlasIntegrityStore.js";
import { isPlanciaStateQuestion, answerPlanciaStateLive } from "../services/atlasStateAnswer.js";
import { searchRefusal } from "../services/atlasSearchGate.js";
import { patchAtlasSession, publicAtlasSession, readAtlasSession } from "../services/atlasSessionStore.js";
import { asAtlasLine } from "../services/atlasPersonality.js";
import { rememberDurableNote } from "../services/atlasRecall.js";
import { dispatchAtlasTurn } from "../services/atlasSpecialists.js";
import { handleMcpBatch } from "../services/atlasMcp.js";
import {
  ensureDefaultSchedule,
  installAtlasSchedule,
  publicSchedule,
  runScheduledJob,
  saveJob,
} from "../services/atlasSchedule.js";
import { buildCockpit } from "../services/atlasCockpit.js";
import { memoryGraph } from "../services/atlasMemoryGraph.js";
import { listWorkflows, resumeInterruptedWorkflows, resumeWorkflowRun, runWorkflow } from "../services/atlasWorkflows.js";
import { listOpenRuns, listRuns } from "../services/atlasRuns.js";

installAtlasResident();
try {
  installAtlasSchedule();
} catch (err) {
  console.warn("[atlas-schedule]", err?.message || err);
}
resumeInterruptedWorkflows().catch((err) => {
  console.warn("[atlas-runs]", err?.message || err);
});

export const aiRouter = Router();

/** Agent Q — stato integrazione (chiavi da env plancia, mai in chiaro). */
aiRouter.get("/agentq/status", requireAiPaid, async (_req, res) => {
  try {
    const status = await agentqStatus();
    status.resident = residentStatus();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message || "agentq status failed" });
  }
});

/**
 * Resident runtime. Password gate (mounted in server.js) is the auth check.
 * The model turn is paid-only inside wakeResident; otherwise the summary is mechanical.
 * One POST is the L1 wake. The SSE stream only forwards events the hooks already pushed.
 */
aiRouter.get("/agentq/resident", (_req, res) => {
  res.json(residentStatus());
});

aiRouter.get("/agentq/integrity", (_req, res) => {
  const report = readIntegrityReport();
  res.json({ ok: true, report });
});

aiRouter.post("/agentq/resident/wake", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const raw = body.module ?? body.uiState?.module ?? "";
    const named = String(raw || "").trim();
    const preparing = body.prepareHabits === true || body.preferStored === true;
    const result = await wakeResident({
      module: named || (preparing ? "" : "map"),
      uiState: body.uiState || {},
      preferStored: body.preferStored === true,
      prepareHabits: body.prepareHabits === true,
    });
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "resident wake failed" });
  }
});

aiRouter.get("/agentq/resident/events", (req, res) => {
  const header = req.headers["last-event-id"];
  const after =
    header != null && header !== ""
      ? Number(header) || 0
      : Number(req.query?.after || 0) || 0;
  subscribeResidentStream(req, res, { after });
});

/**
 * Ricerca Agent Q — SOLO su richiesta esplicita del client.
 * Body: { query, sources?: ["filesystem","database","memory","api","web_hint"] }
 * Filesystem limitato alla sandbox backend/data/agentq-sandbox.
 * Database: solo SELECT su allowlist (concepts, coverage, errors, tops).
 */
aiRouter.post("/agentq/search", requireAiPaid, async (req, res) => {
  try {
    if (req.body?.explicit === false) {
      const reply = searchRefusal();
      return res.status(409).json({
        ok: false,
        searched: false,
        name: "Atlas",
        onDemand: true,
        reply,
        error: reply,
      });
    }
    if (!req.body?.query && !req.body?.q) {
      return res.status(400).json({
        ok: false,
        searched: false,
        name: "Atlas",
        error: "query richiesta (ricerca solo on-demand)",
      });
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
    rememberDurableNote({
      title: req.body?.title,
      text,
      tags: req.body?.tags,
    }),
  );
});

/** X4: expandable memory as a graph of notes and recall links. */
aiRouter.get("/agentq/memory/graph", (req, res) => {
  try {
    res.json(
      memoryGraph({
        limit: Number(req.query?.limit) || 40,
        query: String(req.query?.q || req.query?.query || ""),
      }),
    );
  } catch (err) {
    res.status(500).json({ ok: false, name: "Atlas", error: err.message || "memory graph failed" });
  }
});

/**
 * J1: one specialist per turn. The user-facing name stays Atlas.
 */
aiRouter.post("/agentq/route", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const message = String(body.message || body.text || "").trim();
    if (!message) return res.status(400).json({ ok: false, name: "Atlas", error: "message richiesto" });
    const result = await dispatchAtlasTurn(message, { module: body.module || "" });
    const status = Number(result?.status) || (result?.code === "AI_PAYMENT_REQUIRED" ? 402 : 200);
    res.status(status).json(result);
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, name: "Atlas", error: err.message || "route failed" });
  }
});

/** J3: JSON-RPC tool bus (initialize, tools/list, tools/call, tools/register). */
aiRouter.post("/agentq/mcp", async (req, res) => {
  try {
    const result = await handleMcpBatch(req.body);
    if (result == null) return res.status(202).end();
    if (Array.isArray(result) && result.length === 0) return res.status(202).end();
    res.json(result);
  } catch (err) {
    res.status(500).json({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32603, message: err.message || "mcp failed" },
    });
  }
});

/** J6: live tool calls, pending ASK, decision tail, resident status. */
aiRouter.get("/agentq/cockpit", (_req, res) => {
  try {
    res.json(buildCockpit());
  } catch (err) {
    res.status(500).json({ ok: false, name: "Atlas", error: err.message || "cockpit failed" });
  }
});

/** J5: persisted cron/interval jobs. */
aiRouter.get("/agentq/schedule", (_req, res) => {
  try {
    ensureDefaultSchedule();
    res.json(publicSchedule());
  } catch (err) {
    res.status(500).json({ error: err.message || "schedule failed" });
  }
});

aiRouter.post("/agentq/schedule", (req, res) => {
  try {
    const job = saveJob(req.body || {});
    res.json({ ok: true, name: "Atlas", job });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "schedule save failed" });
  }
});

aiRouter.post("/agentq/schedule/:id/run", async (req, res) => {
  try {
    res.json(await runScheduledJob(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || "schedule run failed" });
  }
});

/** X2: named playbooks. */
aiRouter.get("/agentq/workflows", (_req, res) => {
  res.json({ ok: true, name: "Atlas", workflows: listWorkflows() });
});

aiRouter.post("/agentq/workflows/run", async (req, res) => {
  try {
    const id = String(req.body?.id || req.body?.workflow || "").trim();
    if (!id) return res.status(400).json({ ok: false, name: "Atlas", error: "id richiesto" });
    res.json(await runWorkflow(id));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, name: "Atlas", error: err.message || "workflow failed" });
  }
});

/** J2: checkpointed runs and resume after a restart. */
aiRouter.get("/agentq/runs", (_req, res) => {
  res.json({ ok: true, name: "Atlas", runs: listRuns(), open: listOpenRuns() });
});

aiRouter.post("/agentq/runs/:id/resume", async (req, res) => {
  try {
    res.json(await resumeWorkflowRun(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, name: "Atlas", error: err.message || "resume failed" });
  }
});

/**
 * C2: factual plancia answer. No model. Resident bundle when it is already awake
 * and the caller asks via "resident"; otherwise a live snapshot / board / updates read.
 */
aiRouter.post("/agentq/state", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const question = String(body.question || body.message || "").trim();
    if (!isPlanciaStateQuestion(question)) {
      return res.status(400).json({
        ok: false,
        answered: false,
        name: "Atlas",
        reply: asAtlasLine("Non è una domanda sullo stato della plancia."),
      });
    }
    const moduleName = String(body.module || "").trim();
    if (body.via === "resident") {
      const fromResident = answerResidentState(question, { module: moduleName });
      if (fromResident) return res.json(fromResident);
    }
    const live = await answerPlanciaStateLive({ question, module: moduleName || "map" });
    res.json(live);
  } catch (err) {
    res.status(500).json({ ok: false, answered: false, error: err.message || "state failed" });
  }
});

/** C9: last wake, preferred module, pending ASK. Password gate only. */
aiRouter.get("/agentq/session", (_req, res) => {
  res.json(publicAtlasSession(readAtlasSession()));
});

aiRouter.post("/agentq/session", (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const saved = patchAtlasSession({
      module: body.module,
      pendingAskAdd: body.pendingAskAdd,
      pendingAskDrop: body.pendingAskDrop,
    });
    res.json(publicAtlasSession(saved));
  } catch (err) {
    res.status(500).json({ error: err.message || "session failed" });
  }
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
      confirmSpend: body.confirmSpend === true,
    });
    // Canonical JSON: route / reply / actions / escalate_reason
    res.json({
      route: result.route || result.tier || "answer_local",
      reply: result.reply,
      actions: result.actions || [],
      ask: result.ask || [],
      escalate_reason: result.escalate_reason ?? result.escalateReason ?? null,
      tier: result.tier,
      model: result.model,
      needQuestions: result.needQuestions || false,
      needSpendConfirm: Boolean(result.needSpendConfirm),
      blocked: result.blocked || false,
      code: result.code,
      trust: result.trust || null,
      trustLine: result.trustLine || "",
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
    const spoken = {
      spokenText: result?.spokenText || text,
      spelled: Boolean(result?.spelled),
      voiceLocked: Boolean(result?.voiceLocked),
      speakFallback: result?.speakFallback || null,
      transport: result?.transport || null,
    };
    if (!result?.buffer?.length) {
      return res.json({
        ok: true,
        fallback: result?.fallback || "mechanical",
        mime: null,
        audioBase64: null,
        model: result?.model || "mechanical",
        voice: result?.voice || null,
        reply: result?.reply || asAtlasLine("Voce esterna non disponibile. Il testo resta in plancia."),
        ...spoken,
      });
    }
    res.json({
      ok: true,
      fallback: result.fallback || null,
      mime: result.mime,
      audioBase64: result.buffer.toString("base64"),
      model: result.model,
      voice: result.voice,
      ...spoken,
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
    res.json({
      text: result.text || "",
      model: result.model,
      ok: true,
      fallback: result.fallback || null,
      reply: result.reply || "",
    });
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
