import { config } from "../config.js";

/** Default economical OpenRouter model for chat. */
export const DEFAULT_CHAT_MODEL = "deepseek/deepseek-v4.1-flash";

/** Allow-listed OpenRouter model IDs for the chat UI selector. */
export const CHAT_MODEL_GROUPS = [
  {
    id: "value",
    label: "Economical · capable",
    models: [
      {
        id: "deepseek/deepseek-v4.1-flash",
        label: "DeepSeek V4.1 Flash (default)",
      },
      {
        id: "perplexity/sonar",
        label: "Perplexity Sonar (web)",
      },
      {
        id: "meta-llama/llama-3.1-70b-instruct",
        label: "Llama 3.1 70B",
      },
      {
        id: "mistralai/mixtral-8x7b-instruct",
        label: "Mixtral 8x7B",
      },
      {
        id: "google/gemini-2.0-flash-001",
        label: "Gemini 2.0 Flash",
      },
      {
        id: "meta-llama/llama-3.2-3b-instruct",
        label: "Llama 3.2 3B",
      },
    ],
  },
  {
    id: "top",
    label: "Top-tier",
    models: [
      {
        id: "x-ai/grok-4.20",
        label: "Grok 4.20 (power escalate)",
      },
      {
        id: "x-ai/grok-4.6",
        label: "Grok 4.6",
      },
      {
        id: "anthropic/claude-3.5-sonnet",
        label: "Claude 3.5 Sonnet",
      },
      {
        id: "openai/gpt-4o",
        label: "GPT-4o",
      },
      {
        id: "google/gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
      },
    ],
  },
];

const ALLOWED = new Set(
  CHAT_MODEL_GROUPS.flatMap((g) => g.models.map((m) => m.id)),
);

/** Ensure env defaults are always selectable even if not listed above. */
if (config.openRouterModel) ALLOWED.add(config.openRouterModel);
if (config.aiRouterModel) ALLOWED.add(config.aiRouterModel);
if (config.aiGrokModel) ALLOWED.add(config.aiGrokModel);

export function isAllowedChatModel(modelId) {
  return typeof modelId === "string" && ALLOWED.has(modelId.trim());
}

export function resolveChatModel(requested) {
  const raw = typeof requested === "string" ? requested.trim() : "";
  if (raw && isAllowedChatModel(raw)) return raw;
  if (isAllowedChatModel(config.openRouterModel)) return config.openRouterModel;
  return DEFAULT_CHAT_MODEL;
}

/** A different allow-listed model used when the requested one fails (M2). */
export function alternateChatModel(primary) {
  const current = resolveChatModel(primary);
  const candidates = [
    config.aiRouterModel,
    config.aiMainModel,
    DEFAULT_CHAT_MODEL,
    "google/gemini-2.0-flash-001",
    "meta-llama/llama-3.2-3b-instruct",
  ];
  for (const id of candidates) {
    const resolved = resolveChatModel(id);
    if (resolved && resolved !== current) return resolved;
  }
  return "";
}

export function listChatModels() {
  // Prefer DeepSeek V4.1 Flash as UI default unless env points at another allow-listed model.
  const envDefault = config.openRouterModel?.trim();
  const defaultModel =
    envDefault && isAllowedChatModel(envDefault) && envDefault !== "meta-llama/llama-3.2-3b-instruct"
      ? envDefault
      : DEFAULT_CHAT_MODEL;
  return {
    default: defaultModel,
    groups: CHAT_MODEL_GROUPS,
  };
}
