/**
 * Esempio stack ibrido:
 *  - decideRoute (heuristica / hybrid)
 *  - Qwen3-8B su :8070 per turni semplici
 *  - Qwen3.5-35B-A3B su :8080 per turni complessi + tool
 *  - schema_validator prima di eseguire tool
 *
 *   set ROUTER_BASE_URL=http://127.0.0.1:8070/v1
 *   set BRAIN_BASE_URL=http://127.0.0.1:8080/v1
 *   set ROUTER_MODE=hybrid
 *   node client/hybrid_voice_client.mjs "Ciao"
 *   node client/hybrid_voice_client.mjs "Cerca in memoria l'ultimo deploy"
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { decideRoute } from "../host/router_logic.js";
import {
  createToolValidator,
  extractToolCalls,
  ToolValidationError,
} from "../host/schema_validator.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const ROUTER_BASE = (process.env.ROUTER_BASE_URL || "http://127.0.0.1:8070/v1").replace(/\/$/, "");
const BRAIN_BASE = (process.env.BRAIN_BASE_URL || "http://127.0.0.1:8080/v1").replace(/\/$/, "");
const ROUTER_MODEL = process.env.ROUTER_MODEL || "Qwen3-8B";
const BRAIN_MODEL = process.env.BRAIN_MODEL || "Qwen3.5-35B-A3B";
const MODE = process.env.ROUTER_MODE || "hybrid";

const systemRouter = readFileSync(join(ROOT, "prompts", "system-router.txt"), "utf8").trim();
const systemBrain = readFileSync(join(ROOT, "prompts", "system-voice-plancia.txt"), "utf8").trim();
const catalog = JSON.parse(
  readFileSync(join(ROOT, "host", "tool_schemas", "plancia_tools.json"), "utf8")
);
const openAiTools = catalog.tools.map((t) => ({
  type: "function",
  function: { name: t.name, description: t.description, parameters: t.parameters },
}));
const validator = createToolValidator();

async function chat(base, model, messages, { tools, max_tokens, temperature } = {}) {
  const body = {
    model,
    messages,
    max_tokens: max_tokens ?? 96,
    temperature: temperature ?? 0.4,
  };
  if (tools) {
    body.tools = tools;
    body.tool_choice = "auto";
  }
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status} ${base}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

async function classifyWithRouter(userText) {
  const completion = await chat(
    ROUTER_BASE,
    ROUTER_MODEL,
    [
      { role: "system", content: systemRouter },
      {
        role: "user",
        content:
          `Classifica solo in JSON.\nUtente: ${userText}\n\n/no_think`,
      },
    ],
    { max_tokens: 64, temperature: 0.2 }
  );
  return completion.choices?.[0]?.message?.content || "";
}

async function replyWithRouter(userText) {
  const completion = await chat(
    ROUTER_BASE,
    ROUTER_MODEL,
    [
      { role: "system", content: systemRouter },
      {
        role: "user",
        content: `Risposta vocale breve (turno semplice).\nUtente: ${userText}\n\n/no_think`,
      },
    ],
    { max_tokens: 96, temperature: 0.5 }
  );
  return completion.choices?.[0]?.message?.content?.trim() || "";
}

async function replyWithBrain(userText) {
  const completion = await chat(
    BRAIN_BASE,
    BRAIN_MODEL,
    [
      { role: "system", content: systemBrain },
      { role: "user", content: `${userText}\n\n/no_think` },
    ],
    { tools: openAiTools, max_tokens: 256, temperature: 0.6 }
  );
  return completion.choices?.[0]?.message;
}

function fakeExecute(name, args) {
  return { ok: true, stub: true, name, args };
}

async function main() {
  const userText = process.argv.slice(2).join(" ").trim() || "Ciao";
  const t0 = Date.now();

  const decision = await decideRoute({
    userText,
    mode: MODE,
    classifyWithRouter: MODE === "heuristic" ? undefined : classifyWithRouter,
  });

  console.log("route:", decision);
  let spoken = "";

  if (decision.route === "router") {
    spoken = await replyWithRouter(userText);
    console.log("model:", ROUTER_MODEL, "base:", ROUTER_BASE);
    console.log("Assistant:", spoken);
  } else {
    const message = await replyWithBrain(userText);
    console.log("model:", BRAIN_MODEL, "base:", BRAIN_BASE);
    if (message?.content) {
      spoken = message.content.trim();
      console.log("Assistant:", spoken);
    }
    const calls = extractToolCalls(message || {});
    for (const call of calls) {
      try {
        const needs = validator.catalog.byName.get(call.name)?.requires_confirmation;
        const validated = validator.validateToolCall(call, {
          confirmed: needs ? process.env.FORCE_CONFIRM === "1" : false,
        });
        console.log("VALIDATO:", validated.name, validated.args);
        console.log("ESEGUITO:", fakeExecute(validated.name, validated.args));
      } catch (err) {
        if (err instanceof ToolValidationError) {
          console.log("BLOCCATO:", err.code, err.message);
        } else throw err;
      }
    }
  }

  console.log(`latency_wall_ms: ${Date.now() - t0}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
