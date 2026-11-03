/**
 * Client di esempio: parla con llama-server locale (OpenAI-compatible)
 * e valida i tool-call lato host prima di qualsiasi esecuzione.
 *
 * Uso (da qwen-plancia-local/host dopo npm install):
 *   node ../client/example_client.mjs
 *   node ../client/example_client.mjs "Qual è lo stato della plancia?"
 *
 * Variabili opzionali:
 *   LLAMA_BASE_URL=http://127.0.0.1:8080/v1
 *   LLAMA_API_KEY=
 *   LLAMA_MODEL=Qwen3.6-35B-A3B
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createToolValidator,
  extractToolCalls,
  ToolValidationError,
} from "../host/schema_validator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const BASE_URL = (process.env.LLAMA_BASE_URL || "http://127.0.0.1:8080/v1").replace(/\/$/, "");
const API_KEY = process.env.LLAMA_API_KEY || "";
const MODEL = process.env.LLAMA_MODEL || "Qwen3.6-35B-A3B";

const systemPrompt = readFileSync(
  join(ROOT, "prompts", "system-voice-plancia.txt"),
  "utf8"
).trim();

const catalog = JSON.parse(
  readFileSync(join(ROOT, "host", "tool_schemas", "plancia_tools.json"), "utf8")
);

const openAiTools = catalog.tools.map((t) => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  },
}));

const validator = createToolValidator();

async function chat(userText) {
  const headers = {
    "Content-Type": "application/json",
  };
  if (API_KEY) headers.Authorization = `Bearer ${API_KEY}`;

  // /no_think nel messaggio utente come rete di sicurezza se il server
  // non applica --chat-template-kwargs enable_thinking=false.
  const body = {
    model: MODEL,
    temperature: 0.6,
    max_tokens: 256,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `${userText}\n\n/no_think` },
    ],
    tools: openAiTools,
    tool_choice: "auto",
  };

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
  }
  return JSON.parse(text);
}

function fakeExecute(name, args) {
  // Stub: in produzione collegare le API reali della plancia.
  switch (name) {
    case "get_agent_status":
      return { ok: true, build: "local-dev", mode: "voice" };
    case "search_memory":
      return { ok: true, hits: [], query: args.query };
    case "set_mic_session":
      return { ok: true, action: args.action, note: "stub" };
    case "send_user_message":
      return { ok: true, queued: args.text };
    default:
      return { ok: false, error: "unknown" };
  }
}

async function main() {
  const userText =
    process.argv.slice(2).join(" ").trim() ||
    "Controlla lo stato della plancia e cerca in memoria 'deploy'.";

  console.log(`→ ${BASE_URL}/chat/completions`);
  console.log(`→ model=${MODEL}`);
  console.log(`→ user: ${userText}\n`);

  const completion = await chat(userText);
  const message = completion.choices?.[0]?.message;
  if (!message) {
    console.error("Risposta senza message:", completion);
    process.exit(1);
  }

  if (message.content) {
    console.log("Assistant:", message.content.trim());
  }

  const calls = extractToolCalls(message);
  if (!calls.length) {
    console.log("(nessun tool_call)");
    return;
  }

  console.log(`\nTool calls grezzi dal modello: ${calls.length}`);
  for (const call of calls) {
    try {
      // Write-tool: in demo chiediamo conferma automatica solo se env FORCE_CONFIRM=1
      const needsConfirmPreview = validator.catalog.byName.get(call.name)?.requires_confirmation;
      const confirmed = needsConfirmPreview ? process.env.FORCE_CONFIRM === "1" : false;
      const validated = validator.validateToolCall(call, { confirmed });
      console.log("VALIDATO:", validated.name, validated.args);
      const result = fakeExecute(validated.name, validated.args);
      console.log("ESEGUITO (stub):", result);
    } catch (err) {
      if (err instanceof ToolValidationError) {
        console.log("BLOCCATO:", err.code, err.message);
        if (err.code === "CONFIRMATION_REQUIRED") {
          console.log("  → per eseguire in demo: FORCE_CONFIRM=1 node ...");
        }
      } else {
        throw err;
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
