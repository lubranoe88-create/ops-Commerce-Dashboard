/**
 * Validazione host-side dei tool-call provenienti dal modello locale.
 * Flusso: parse JSON tool_calls -> allowlist name -> AJV JSON Schema ->
 * eventuale requires_confirmation -> solo allora eseguire.
 *
 * Uso:
 *   import { createToolValidator, extractToolCalls } from './schema_validator.js';
 *   node schema_validator.js --self-test
 *   node schema_validator.js --demo
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_CATALOG = join(__dirname, "tool_schemas", "plancia_tools.json");

export class ToolValidationError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "ToolValidationError";
    this.code = code;
    this.details = details;
  }
}

export function loadToolCatalog(catalogPath = DEFAULT_CATALOG) {
  const raw = JSON.parse(readFileSync(catalogPath, "utf8"));
  if (!Array.isArray(raw.tools) || raw.tools.length === 0) {
    throw new Error(`Catalogo tool vuoto o invalido: ${catalogPath}`);
  }
  const byName = new Map();
  for (const tool of raw.tools) {
    if (!tool?.name || !tool?.parameters) {
      throw new Error(`Tool malformato nel catalogo: ${JSON.stringify(tool)}`);
    }
    if (byName.has(tool.name)) {
      throw new Error(`Tool duplicato nel catalogo: ${tool.name}`);
    }
    byName.set(tool.name, tool);
  }
  return { path: catalogPath, tools: raw.tools, byName };
}

export function createToolValidator(options = {}) {
  const catalog = loadToolCatalog(options.catalogPath ?? DEFAULT_CATALOG);
  const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    removeAdditional: false,
    useDefaults: true,
    coerceTypes: false,
  });
  addFormats(ajv);

  const compilers = new Map();
  for (const tool of catalog.tools) {
    compilers.set(tool.name, ajv.compile(tool.parameters));
  }

  /**
   * @param {{ name: string, arguments: unknown }} call
   * @param {{ confirmed?: boolean }} ctx
   * @returns {{ ok: true, name: string, args: object, meta: object } | never}
   */
  function validateToolCall(call, ctx = {}) {
    if (!call || typeof call !== "object") {
      throw new ToolValidationError("INVALID_CALL", "tool_call non e' un oggetto");
    }
    const name = typeof call.name === "string" ? call.name.trim() : "";
    if (!name) {
      throw new ToolValidationError("MISSING_NAME", "tool_call.name mancante");
    }
    if (!catalog.byName.has(name)) {
      throw new ToolValidationError(
        "NOT_ALLOWED",
        `Tool non in allowlist: ${name}`,
        { allowed: [...catalog.byName.keys()] }
      );
    }

    let args = call.arguments;
    if (typeof args === "string") {
      try {
        args = args.trim() === "" ? {} : JSON.parse(args);
      } catch (err) {
        throw new ToolValidationError("BAD_JSON_ARGUMENTS", `arguments non e' JSON valido per ${name}`, {
          parseError: String(err?.message || err),
          raw: args.slice(0, 500),
        });
      }
    }
    if (args == null) args = {};
    if (typeof args !== "object" || Array.isArray(args)) {
      throw new ToolValidationError("BAD_ARGUMENTS_TYPE", `arguments di ${name} deve essere un oggetto`);
    }

    const validate = compilers.get(name);
    const ok = validate(args);
    if (!ok) {
      throw new ToolValidationError("SCHEMA_MISMATCH", `Parametri non validi per ${name}`, {
        errors: validate.errors,
      });
    }

    const meta = catalog.byName.get(name);
    if (meta.requires_confirmation && !ctx.confirmed) {
      throw new ToolValidationError(
        "CONFIRMATION_REQUIRED",
        `Il tool ${name} richiede conferma esplicita prima dell'esecuzione`,
        { side_effect: meta.side_effect }
      );
    }

    return {
      ok: true,
      name,
      args,
      meta: {
        side_effect: meta.side_effect,
        requires_confirmation: Boolean(meta.requires_confirmation),
        description: meta.description,
      },
    };
  }

  function validateMany(calls, ctx = {}) {
    if (!Array.isArray(calls)) {
      throw new ToolValidationError("INVALID_CALLS", "tool_calls deve essere un array");
    }
    return calls.map((c, i) => {
      try {
        return validateToolCall(c, ctx);
      } catch (err) {
        if (err instanceof ToolValidationError) {
          err.details = { ...(err.details || {}), index: i };
        }
        throw err;
      }
    });
  }

  return { catalog, validateToolCall, validateMany };
}

/**
 * Estrae tool_calls dallo stile OpenAI chat.completion (message.tool_calls)
 * o da un blocco function-call semplificato { name, arguments }.
 */
export function extractToolCalls(messageOrPayload) {
  if (!messageOrPayload) return [];
  const msg = messageOrPayload.message ?? messageOrPayload;
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length) {
    return msg.tool_calls.map((tc) => ({
      id: tc.id,
      name: tc.function?.name ?? tc.name,
      arguments: tc.function?.arguments ?? tc.arguments ?? {},
    }));
  }
  if (msg.name && (msg.arguments !== undefined || msg.parameters !== undefined)) {
    return [{ name: msg.name, arguments: msg.arguments ?? msg.parameters }];
  }
  return [];
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function selfTest() {
  const v = createToolValidator();
  const ok1 = v.validateToolCall({
    name: "search_memory",
    arguments: { query: "appuntamento", limit: 3 },
  });
  assert(ok1.ok && ok1.name === "search_memory", "search_memory dovrebbe passare");

  let blocked = false;
  try {
    v.validateToolCall({ name: "rm_rf", arguments: {} });
  } catch (e) {
    blocked = e.code === "NOT_ALLOWED";
  }
  assert(blocked, "tool fuori allowlist deve fallire");

  let schemaFail = false;
  try {
    v.validateToolCall({ name: "search_memory", arguments: { query: "" } });
  } catch (e) {
    schemaFail = e.code === "SCHEMA_MISMATCH";
  }
  assert(schemaFail, "query vuota deve fallire schema");

  let conf = false;
  try {
    v.validateToolCall({ name: "set_mic_session", arguments: { action: "hangup" } });
  } catch (e) {
    conf = e.code === "CONFIRMATION_REQUIRED";
  }
  assert(conf, "write tool senza confirmed deve richiedere conferma");

  const okWrite = v.validateToolCall(
    { name: "set_mic_session", arguments: { action: "hangup" } },
    { confirmed: true }
  );
  assert(okWrite.ok, "write tool con confirmed deve passare");

  const extracted = extractToolCalls({
    tool_calls: [
      {
        id: "call_1",
        function: { name: "get_agent_status", arguments: "{}" },
      },
    ],
  });
  assert(extracted.length === 1 && extracted[0].name === "get_agent_status", "extract OpenAI style");
  v.validateMany(extracted);

  console.log("self-test OK");
}

function demo() {
  const v = createToolValidator();
  const samples = [
    { name: "get_agent_status", arguments: {} },
    { name: "search_memory", arguments: JSON.stringify({ query: "ultimo deploy" }) },
    { name: "send_user_message", arguments: { text: "Ciao dalla plancia" } },
    { name: "delete_everything", arguments: {} },
  ];
  for (const sample of samples) {
    try {
      const r = v.validateToolCall(sample, { confirmed: false });
      console.log("PASS", r.name, r.args);
    } catch (e) {
      console.log("FAIL", e.code, e.message);
    }
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  if (process.argv.includes("--self-test")) selfTest();
  else if (process.argv.includes("--demo")) demo();
  else {
    console.log("Usage: node schema_validator.js --self-test | --demo");
    process.exit(1);
  }
}
