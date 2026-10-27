import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(__dirname, "catalog.json");

function readCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
}

function writeCatalog(catalog) {
  fs.writeFileSync(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
}

/** List agents; by default only enabled ones. */
export function listAgents({ includeDisabled = false } = {}) {
  const catalog = readCatalog();
  const agents = catalog.agents || [];
  return includeDisabled ? agents : agents.filter((a) => a.enabled !== false);
}

export function getAgent(id) {
  return listAgents({ includeDisabled: true }).find((a) => a.id === id) || null;
}

/**
 * Add or replace an agent definition in the local catalog.
 * Simple interface for growing toward a larger GitHub agent pool later.
 */
export function addAgent(agent) {
  if (!agent?.id || typeof agent.id !== "string") {
    throw new Error("agent.id is required");
  }
  if (!agent.name) throw new Error("agent.name is required");
  const catalog = readCatalog();
  const idx = catalog.agents.findIndex((a) => a.id === agent.id);
  const normalized = {
    id: agent.id,
    name: agent.name,
    enabled: agent.enabled !== false,
    domains: Array.isArray(agent.domains) ? agent.domains : [],
    keywords: Array.isArray(agent.keywords) ? agent.keywords : [],
    description: agent.description || "",
  };
  if (idx >= 0) catalog.agents[idx] = normalized;
  else catalog.agents.push(normalized);
  writeCatalog(catalog);
  return normalized;
}

/** Disable + remove from catalog (hard remove). */
export function removeAgent(id) {
  const catalog = readCatalog();
  const before = catalog.agents.length;
  catalog.agents = catalog.agents.filter((a) => a.id !== id);
  if (catalog.agents.length === before) {
    return { removed: false };
  }
  writeCatalog(catalog);
  return { removed: true, id };
}

/** Soft-disable without deleting the definition. */
export function setAgentEnabled(id, enabled) {
  const catalog = readCatalog();
  const agent = catalog.agents.find((a) => a.id === id);
  if (!agent) return null;
  agent.enabled = Boolean(enabled);
  writeCatalog(catalog);
  return agent;
}
