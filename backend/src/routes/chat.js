import { Router } from "express";
import { validateChat } from "../middleware/validateChat.js";
import { completeChat } from "../services/openrouter.js";

export const chatRouter = Router();

chatRouter.post("/", validateChat, async (req, res) => {
  try {
    const result = await completeChat(req.chat);
    return res.json({
      content: result.content,
      model: result.model,
      usage: result.usage,
      role: "synthesis_ranking",
    });
  } catch (err) {
    const status = err.status && Number.isInteger(err.status) ? err.status : 502;
    const message = err.upstream
      ? err.message
      : "Failed to complete chat request";
    return res.status(status).json({ error: message });
  }
});
