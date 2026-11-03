/**
 * Seed Atlas prompt canon + tool config into durable sticky expandable memory.
 * One upsert per tag (no duplicate append). Sticky tags make packs surface in
 * automatic recall without bloating ATLAS_PERSONA.
 */
import { upsertTaggedMemory } from "./agentqBridge.js";
import { DURABLE_TAG, STICKY_TAG } from "./atlasRecall.js";
import {
  ATLAS_AGENTQ_QUALITIES,
  ATLAS_ESCALATE_REMINDERS,
  ATLAS_TRUTH_PROMPT_BLOCK,
  ATLAS_TRUTH_RULES,
  ATLAS_VOICE_OPS_RULES,
} from "./atlasPromptCanon.js";

export {
  ATLAS_AGENTQ_QUALITIES,
  ATLAS_ESCALATE_REMINDERS,
  ATLAS_TRUTH_PROMPT_BLOCK,
  ATLAS_TRUTH_RULES,
  ATLAS_VOICE_OPS_RULES,
} from "./atlasPromptCanon.js";

export const ATLAS_TRUTH_TAG = "atlas-truth-pack";
export const ATLAS_VOICE_OPS_TAG = "atlas-voice-ops";
export const ATLAS_TOOL_CFG_TAG = "atlas-tool-config";
export const ATLAS_AGENTQ_TAG = "atlas-agentq-heritage";

export const ATLAS_TOOL_CONFIG = {
  verify: [
    { id: "state", path: "POST /api/ai/agentq/state", use: "Live plancia facts Q&A" },
    { id: "status", path: "GET /api/ai/agentq/status", use: "Agent identity + voice flags" },
    { id: "updates", path: "GET /api/ai/agentq/updates", use: "Ingress / news watcher feed" },
    { id: "news", path: "GET /api/ai/news", use: "Cached world news" },
    { id: "memory-search", path: "GET/POST /api/ai/agentq/memory", use: "On-request memory (C3)" },
    { id: "recall", path: "automatic_recall", use: "Durable sticky notes injected without ask (M1)" },
    { id: "hands", path: "POST /api/ai/agentq/hands", use: "Zoom, modules, pop-ups under L3" },
    { id: "mcp", path: "POST /api/ai/agentq/mcp", use: "Tool bus JSON-RPC" },
    { id: "cockpit", path: "GET /api/ai/agentq/cockpit", use: "Live tool status" },
  ],
  speech: {
    ttsPrimary: "elevenlabs/eleven-flash-v2.5",
    stt: "openai/whisper-1",
    duplex: "barge-cancel",
    wakeWord: "Atlas",
  },
  policy: {
    autonomy: "L3 AUTO vs ASK",
    trustTags: "C12",
    spendGate: "C11",
  },
};

function seedTaggedDurable(tag, title, text, extraTags = []) {
  return upsertTaggedMemory({
    tag,
    title,
    text,
    tags: [tag, DURABLE_TAG, STICKY_TAG, "atlas", ...extraTags],
  });
}

export function ensureAtlasTruthMemory() {
  const agentq = seedTaggedDurable(
    ATLAS_AGENTQ_TAG,
    "Atlas Q-heritage — plan critique verify",
    ATLAS_AGENTQ_QUALITIES,
    ["prompt", "agentq", "reasoning"],
  );
  const truth = seedTaggedDurable(
    ATLAS_TRUTH_TAG,
    "Atlas truth pack — fatti verificati",
    ATLAS_TRUTH_RULES,
    ["prompt", "honesty", "voice"],
  );
  const voice = seedTaggedDurable(
    ATLAS_VOICE_OPS_TAG,
    "Atlas voice ops — Flash Whisper barge wake",
    ATLAS_VOICE_OPS_RULES,
    ["prompt", "voice"],
  );
  const tools = seedTaggedDurable(
    ATLAS_TOOL_CFG_TAG,
    "Atlas tool config — verify via plancia APIs",
    [
      "When unsure, offer to verify with: state, updates, news, memory search, hands, MCP, cockpit.",
      `Speech: TTS ${ATLAS_TOOL_CONFIG.speech.ttsPrimary}, STT Whisper, duplex ${ATLAS_TOOL_CONFIG.speech.duplex}, wake ${ATLAS_TOOL_CONFIG.speech.wakeWord}.`,
      `Policy: ${ATLAS_TOOL_CONFIG.policy.autonomy}, trust ${ATLAS_TOOL_CONFIG.policy.trustTags}, spend ${ATLAS_TOOL_CONFIG.policy.spendGate}.`,
      `Tool map: ${JSON.stringify(ATLAS_TOOL_CONFIG.verify)}`,
    ].join(" "),
    ["tools", "verify"],
  );
  return {
    ok: true,
    tags: [ATLAS_AGENTQ_TAG, ATLAS_TRUTH_TAG, ATLAS_VOICE_OPS_TAG, ATLAS_TOOL_CFG_TAG],
    agentq: agentq.entry?.id,
    truth: truth.entry?.id,
    voice: voice.entry?.id,
    tools: tools.entry?.id,
    promptBlockChars: ATLAS_TRUTH_PROMPT_BLOCK.length,
    personaKeptLean: true,
  };
}
