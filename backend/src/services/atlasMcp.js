/**
 * J3: MCP-compatible tool bus.
 * JSON-RPC 2.0 methods: initialize, ping, tools/list, tools/call, tools/register.
 * Built-in tools wrap Atlas hands. External descriptors execute as local stubs
 * until a wired handler is registered.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENTQ_HAND_ACTIONS } from "./agentqBridge.js";
import { classifyAction, gateHandActions } from "./atlasAutonomyPolicy.js";
import { asAtlasLine } from "./atlasPersonality.js";
import { noteToolCall } from "./atlasToolLog.js";
import { ATLAS_WORKFLOWS } from "./atlasRoute.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, "../../data/agentq-memory/atlas-mcp-tools.json");
const PROTOCOL = "2024-11-05";

let pathOverride = "";

export function setMcpRegistryFileForTests(filePath) {
  pathOverride = filePath ? path.resolve(filePath) : "";
}

function registryPath() {
  return pathOverride || DEFAULT_PATH;
}

function readExternal() {
  try {
    const raw = JSON.parse(fs.readFileSync(registryPath(), "utf8"));
    return Array.isArray(raw?.tools) ? raw.tools : [];
  } catch {
    return [];
  }
}

function writeExternal(tools) {
  const dest = registryPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = path.join(path.dirname(dest), `.atlas-mcp-tools.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, tools }, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, dest);
}

function handSchema(action) {
  if (action.id === "document") {
    return {
      type: "object",
      properties: { path: { type: "string", description: "Percorso relativo nella sandbox" } },
      required: ["path"],
      additionalProperties: false,
    };
  }
  return { type: "object", properties: {}, additionalProperties: false };
}

export function listMcpTools() {
  const hands = AGENTQ_HAND_ACTIONS.map((action) => ({
    name: action.id,
    description: `Mano Atlas: ${action.label}`,
    inputSchema: handSchema(action),
    wired: true,
    source: "atlas-hands",
  }));
  const workflows = ATLAS_WORKFLOWS.map((workflow) => ({
    name: `workflow.${workflow.id}`,
    description: `Playbook Atlas: ${workflow.title}`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    wired: true,
    source: "atlas-workflow",
  }));
  const external = readExternal().map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema || { type: "object", properties: {} },
    wired: Boolean(tool.wired),
    source: "external",
  }));
  const seen = new Set();
  const tools = [];
  for (const tool of [...hands, ...workflows, ...external]) {
    if (seen.has(tool.name)) continue;
    seen.add(tool.name);
    tools.push(tool);
  }
  return tools;
}

function builtinNames() {
  return new Set(listMcpTools().filter((tool) => tool.source !== "external").map((tool) => tool.name));
}

export function registerExternalTool({ name, description, inputSchema } = {}) {
  const toolName = String(name || "").trim();
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(toolName)) {
    const err = new Error("nome tool non valido");
    err.code = -32602;
    throw err;
  }
  if (builtinNames().has(toolName)) {
    const err = new Error("il nome è già una mano Atlas");
    err.code = -32602;
    throw err;
  }
  const desc = String(description || "").trim().slice(0, 240);
  if (!desc) {
    const err = new Error("description richiesta");
    err.code = -32602;
    throw err;
  }
  const schema = inputSchema && typeof inputSchema === "object" ? inputSchema : { type: "object", properties: {} };
  const tools = readExternal().filter((tool) => tool.name !== toolName);
  const saved = { name: toolName, description: desc, inputSchema: schema, wired: false };
  tools.push(saved);
  writeExternal(tools);
  return saved;
}

function rpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function toolContent(text, structured, isError = false) {
  return {
    content: [{ type: "text", text }],
    isError,
    structuredContent: { name: "Atlas", ...structured },
  };
}

async function callWired(name, args) {
  if (name.startsWith("workflow.")) {
    const id = name.slice("workflow.".length);
    const { runWorkflow } = await import("./atlasWorkflows.js");
    const result = await runWorkflow(id);
    noteToolCall({
      name,
      mode: result.ask?.length ? "ask" : "auto",
      stub: false,
      ok: result.ok !== false,
      detail: result.run?.status || "workflow",
    });
    return toolContent(result.reply || asAtlasLine(`Playbook ${id}.`), {
      tool: name,
      mode: result.ask?.length ? "ask" : "auto",
      stub: false,
      executed: result.run?.status === "done",
      paused: result.run?.status === "paused",
      actions: result.actions || [],
      ask: result.ask || [],
      runId: result.run?.id || "",
    });
  }
  const gated = gateHandActions([name]);
  const mode = gated.actions.includes(name) ? "auto" : "ask";
  if (name === "document" && mode === "auto" && !String(args?.path || "").trim()) {
    noteToolCall({ name, mode: "ask", stub: false, ok: false, detail: "path mancante" });
    return toolContent(asAtlasLine("Per il documento serve il percorso nella sandbox."), {
      tool: name,
      mode: "ask",
      stub: false,
      executed: false,
      actions: [],
    }, true);
  }
  noteToolCall({
    name,
    mode,
    stub: false,
    ok: true,
    detail: mode === "auto" ? "mano accettata" : "in attesa di conferma",
  });
  if (mode === "ask") {
    return toolContent(asAtlasLine(`«${name}» resta ASK. Non lo eseguo finché non lo confermi.`), {
      tool: name,
      mode: "ask",
      stub: false,
      executed: false,
      actions: [],
      ask: gated.ask,
    });
  }
  return toolContent(asAtlasLine(`Mano «${name}» pronta (AUTO). La plancia la esegue.`), {
    tool: name,
    mode: "auto",
    stub: false,
    executed: true,
    effect: "client-hand",
    actions: gated.actions,
    path: name === "document" ? String(args.path).trim() : "",
  });
}

async function callTool(params) {
  const name = String(params?.name || "").trim();
  if (!name) {
    const err = new Error("name richiesto");
    err.code = -32602;
    throw err;
  }
  const args = params?.arguments && typeof params.arguments === "object" ? params.arguments : {};
  const known = listMcpTools().find((tool) => tool.name === name);
  if (!known) {
    const policy = classifyAction(name);
    if (!policy || policy.reason === "unknown") {
      const err = new Error(`tool sconosciuto: ${name}`);
      err.code = -32602;
      throw err;
    }
    return callWired(name, args);
  }
  if (known.wired) return callWired(name, args);
  noteToolCall({ name, mode: "auto", stub: true, ok: true, detail: "stub locale" });
  return toolContent(
    asAtlasLine(`Strumento «${name}» non è collegato: esecuzione locale stub.`),
    { tool: name, mode: "auto", stub: true, executed: false, wired: false, arguments: args },
  );
}

/**
 * One JSON-RPC message. Notifications (no id) return null.
 */
export async function handleMcpMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return rpcError(null, -32600, "Invalid Request");
  }
  const hasId = Object.prototype.hasOwnProperty.call(message, "id");
  const id = hasId ? message.id : null;
  if (message.jsonrpc !== "2.0" || typeof message.method !== "string" || !message.method) {
    return rpcError(id, -32600, "Invalid Request");
  }
  try {
    switch (message.method) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion: PROTOCOL,
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: "Atlas", version: "rail-35-voice" },
          instructions: "Atlas è il nome verso l'operatore. I tool sono le mani e i playbook della plancia.",
        });
      case "notifications/initialized":
      case "initialized":
        return hasId ? rpcResult(id, {}) : null;
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, {
          tools: listMcpTools().map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        });
      case "tools/call":
        return rpcResult(id, await callTool(message.params || {}));
      case "tools/register": {
        const saved = registerExternalTool(message.params || {});
        return rpcResult(id, { name: "Atlas", tool: saved });
      }
      default:
        if (!hasId) return null;
        return rpcError(id, -32601, "Method not found");
    }
  } catch (err) {
    return rpcError(id, err.code || -32603, err.message || "Internal error");
  }
}

export async function handleMcpBatch(body) {
  if (Array.isArray(body)) {
    const out = [];
    for (const message of body) {
      const result = await handleMcpMessage(message);
      if (result) out.push(result);
    }
    return out;
  }
  return handleMcpMessage(body);
}
