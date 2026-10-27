import { config } from "../config.js";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate POST /api/chat body.
 * Accepts { prompt, system? } — synthesis/ranking payloads only.
 */
export function validateChat(req, res, next) {
  if (!isPlainObject(req.body)) {
    return res.status(400).json({ error: "Body must be a JSON object" });
  }

  const allowed = new Set(["prompt", "system"]);
  for (const key of Object.keys(req.body)) {
    if (!allowed.has(key)) {
      return res.status(400).json({ error: `Unexpected field: ${key}` });
    }
  }

  const { prompt, system } = req.body;

  if (typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "prompt is required (non-empty string)" });
  }
  if (prompt.length > config.maxPromptChars) {
    return res.status(400).json({
      error: `prompt exceeds max length (${config.maxPromptChars})`,
    });
  }

  if (system !== undefined) {
    if (typeof system !== "string") {
      return res.status(400).json({ error: "system must be a string" });
    }
    if (system.length > config.maxSystemChars) {
      return res.status(400).json({
        error: `system exceeds max length (${config.maxSystemChars})`,
      });
    }
  }

  req.chat = {
    prompt: prompt.trim(),
    system: typeof system === "string" && system.trim() ? system.trim() : undefined,
  };
  return next();
}
