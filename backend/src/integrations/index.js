import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as adapters from "./adapters.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function loadIntegrationManifest() {
  const raw = fs.readFileSync(path.join(__dirname, "manifest.json"), "utf8");
  return JSON.parse(raw);
}

export function listVerifiedIntegrations() {
  return loadIntegrationManifest().verified;
}

export function getIntegration(id) {
  return listVerifiedIntegrations().find((v) => v.id === id) || null;
}

/** Human-readable plug plan for docs/API introspection. */
export function describePipelinePlugs() {
  const manifest = loadIntegrationManifest();
  return manifest.pipeline.map((stage) => ({
    stage,
    tools: manifest.verified.filter((v) => v.stage === stage),
  }));
}

export { adapters };
