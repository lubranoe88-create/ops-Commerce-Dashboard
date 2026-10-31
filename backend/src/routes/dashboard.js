import { Router } from "express";
import {
  appendChatMessage,
  applyUserCorrection,
  createChatThread,
  evaluateVerification,
  getChatMessages,
  getDashboardSnapshot,
  listChatThreads,
  searchCrossThreadMemory,
} from "../memory/store.js";
import { completeChat } from "../services/openrouter.js";
import { isAllowedChatModel, resolveChatModel } from "../services/chatModels.js";
import { config } from "../config.js";

export const dashboardRouter = Router();

dashboardRouter.get("/dashboard/snapshot", (_req, res) => {
  res.json(getDashboardSnapshot());
});

dashboardRouter.get("/snapshot", (_req, res) => {
  res.json(getDashboardSnapshot());
});

dashboardRouter.post("/corrections", (req, res) => {
  const body = req.body || {};
  const business_key =
    body.business_key ||
    body.targetId ||
    body.businessKey ||
    null;
  const verdict = body.verdict;
  const rank = body.rank;
  const reason_line = body.reason_line || body.note || "";
  if (!business_key || !["correct", "incorrect"].includes(verdict)) {
    return res.status(400).json({ error: "business_key and verdict required" });
  }
  if (verdict === "incorrect" && typeof reason_line === "string" && reason_line.length > 280) {
    return res.status(400).json({ error: "reason_line max 280 chars" });
  }
  applyUserCorrection({
    businessKey: business_key,
    rank,
    verdict,
    reasonLine: reason_line || "",
  });
  res.json({ ok: true, snapshot: getDashboardSnapshot() });
});

dashboardRouter.post("/verify-preview", (req, res) => {
  res.json(evaluateVerification({ signals: req.body?.signals || [] }));
});

dashboardRouter.get("/chat/threads", (_req, res) => {
  res.json({ threads: listChatThreads() });
});

/** Cross-thread memory search (lista 20). */
dashboardRouter.get("/chat/memory/search", (req, res) => {
  const q = String(req.query?.q || "").slice(0, 200);
  const limit = Math.min(40, Number(req.query?.limit) || 20);
  const exclude = req.query?.excludeThreadId ? Number(req.query.excludeThreadId) : null;
  res.json({
    query: q,
    results: searchCrossThreadMemory(q, { limit, excludeThreadId: exclude }),
  });
});

dashboardRouter.post("/chat/threads", (req, res) => {
  const title = (req.body?.title || "Nuova chat").toString().slice(0, 120);
  res.json(createChatThread(title));
});

dashboardRouter.get("/chat/threads/:id/messages", (req, res) => {
  const id = Number(req.params.id);
  res.json({ messages: getChatMessages(id) });
});

dashboardRouter.get("/chat/threads/:id", (req, res) => {
  const id = Number(req.params.id);
  res.json({ messages: getChatMessages(id) });
});

dashboardRouter.post("/auth/logout", (_req, res) => {
  res.setHeader(
    "Set-Cookie",
    "dash_auth=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0",
  );
  res.json({ ok: true });
});

dashboardRouter.post("/chat/threads/:id/messages", async (req, res) => {
  const id = Number(req.params.id);
  const content = (req.body?.content || "").toString().trim();
  const speechInput = Boolean(req.body?.speech_input);
  const skipAssistant = Boolean(req.body?.skipAssistant);
  const roleIn = String(req.body?.role || "user").toLowerCase();
  const role = roleIn === "assistant" || roleIn === "system" ? roleIn : "user";
  const requestedModel =
    typeof req.body?.model === "string" ? req.body.model.trim() : "";
  if (!content) return res.status(400).json({ error: "content required" });

  if (requestedModel && !isAllowedChatModel(requestedModel)) {
    return res.status(400).json({ error: "model is not allow-listed" });
  }
  const model = resolveChatModel(requestedModel || undefined);

  const attachmentName = String(req.body?.attachment_name || req.body?.attachmentName || "").slice(0, 180);
  const attachmentMime = String(req.body?.attachment_mime || req.body?.attachmentMime || "").slice(0, 120);
  // Store extracted/plain text only (no binary blobs in SQLite) — lista 21
  const attachmentText = String(req.body?.attachment_text || req.body?.attachmentText || "").slice(0, 50_000);

  // Persist-only path (paid AI turn already produced the reply, or assistant echo)
  if (skipAssistant || role !== "user") {
    appendChatMessage(id, {
      role,
      content,
      speechInput: role === "user" ? speechInput : false,
      attachmentName,
      attachmentMime,
      attachmentText,
    });
    return res.json({
      ok: true,
      persisted: true,
      messages: getChatMessages(id),
    });
  }

  appendChatMessage(id, {
    role: "user",
    content,
    speechInput,
    attachmentName,
    attachmentMime,
    attachmentText,
  });

  const snap = getDashboardSnapshot();
  const system = [
    "Sei l'interfaccia conversazionale del dashboard commerciale ops.",
    "Usa solo i dati del contesto JSON. Non inventare revenue non verificati.",
    "Rispetta regole meccaniche e correzioni utente. Rispondi in italiano, conciso.",
  ].join(" ");

  const contextBlock = JSON.stringify(
    {
      day: snap.day_key,
      pipeline_health: snap.pipeline_health,
      tops: snap.tops.slice(0, 10),
      errors_open: snap.errors.filter((e) => e.status === "open"),
      coverage: snap.coverage,
      consistency: snap.consistency.slice(0, 8),
    },
    null,
    2,
  );

  const key = config.openRouterApiKey;
  if (!key || key.includes("CHANGE_ME") || key.includes("PLACEHOLDER") || key.includes("your-key")) {
    const fallback =
      "OpenRouter non configurato (placeholder). Ecco un riepilogo locale: " +
      `salute pipeline ${snap.pipeline_health}/100, top1 ${snap.tops[0]?.title || snap.tops[0]?.display_name || "n/d"}, ` +
      `errori open ${snap.errors.filter((e) => e.status === "open").length}.`;
    appendChatMessage(id, { role: "assistant", content: fallback });
    return res.json({
      reply: fallback,
      model: "local-fallback",
      messages: getChatMessages(id),
    });
  }

  try {
    const result = await completeChat({
      system,
      model,
      prompt: `Contesto dashboard:\n${contextBlock}\n\nDomanda utente:\n${content}`,
    });
    appendChatMessage(id, { role: "assistant", content: result.content });
    return res.json({
      reply: result.content,
      model: result.model,
      messages: getChatMessages(id),
    });
  } catch (err) {
    const msg = err.message || "Chat upstream failed";
    appendChatMessage(id, { role: "assistant", content: `Errore modello: ${msg}` });
    return res.status(502).json({ error: msg, messages: getChatMessages(id) });
  }
});
