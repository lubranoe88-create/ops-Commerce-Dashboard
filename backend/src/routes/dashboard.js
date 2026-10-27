import { Router } from "express";
import {
  appendChatMessage,
  applyUserCorrection,
  createChatThread,
  evaluateVerification,
  getChatMessages,
  getDashboardSnapshot,
  listChatThreads,
} from "../memory/store.js";
import { completeChat } from "../services/openrouter.js";
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
  if (!content) return res.status(400).json({ error: "content required" });

  appendChatMessage(id, { role: "user", content, speechInput });

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
