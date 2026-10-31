import { config } from "../config.js";

/** Allow-listed OpenRouter model IDs for the chat UI selector. */
export const CHAT_MODEL_GROUPS = [
  {
    id: "top",
    label: "Top-tier",
    models: [
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
  {
    id: "value",
    label: "Powerful · cheaper",
    models: [
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
        label: "Llama 3.2 3B (default)",
      },
    ],
  },
];

const ALLOWED = new Set(
  CHAT_MODEL_GROUPS.flatMap((g) => g.models.map((m) => m.id)),
);

/** Ensure env default is always selectable even if not listed above. */
if (config.openRouterModel) {
  ALLOWED.add(config.openRouterModel);
}

export function isAllowedChatModel(modelId) {
  return typeof modelId === "string" && ALLOWED.has(modelId.trim());
}

export function resolveChatModel(requested) {
  const raw = typeof requested === "string" ? requested.trim() : "";
  if (raw && isAllowedChatModel(raw)) return raw;
  if (isAllowedChatModel(config.openRouterModel)) return config.openRouterModel;
  return "meta-llama/llama-3.2-3b-instruct";
}

export function listChatModels() {
  return {
    default: resolveChatModel(config.openRouterModel),
    groups: CHAT_MODEL_GROUPS,
  };
}
