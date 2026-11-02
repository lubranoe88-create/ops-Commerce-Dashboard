/**
 * M5 startup integrity.
 *
 * On server boot, and again before a resident wake, check that the plancia
 * pieces Atlas relies on are intact. A hard failure is written into the
 * updates feed and the problems list, the report is persisted, and the wake
 * is warned and gated (no model turn, no hand actions) until a later boot
 * or wake passes.
 */
import { AGENTQ_HAND_ACTIONS, agentqStatus, appendEntryUpdate, getEntryUpdates, sandboxDirectoryExists } from "./agentqBridge.js";
import { describePolicy } from "./atlasAutonomyPolicy.js";
import {
  readIntegrityReport,
  writeIntegrityReport,
} from "./atlasIntegrityStore.js";

export const REQUIRED_HAND_IDS = Object.freeze([
  "map",
  "pipeline",
  "memory",
  "chat",
  "zoom-in",
  "zoom-out",
  "zoom-citta",
  "zoom-paese",
  "zoom-continente",
  "zoom-world",
  "briefing",
  "document",
]);

const CHECK_IDS = Object.freeze([
  "agentq-status",
  "updates-readable",
  "hands-catalog",
  "autonomy-policy",
  "resident-installable",
  "sandbox-path",
]);

let cache = null;

export function resetStartupIntegrityForTests() {
  cache = null;
}

async function defaultDeps() {
  return {
    agentqStatus,
    getEntryUpdates,
    hands: AGENTQ_HAND_ACTIONS,
    describePolicy,
    sandboxExists: sandboxDirectoryExists,
    installResident: async () => {
      const mod = await import("./atlasResident.js");
      return mod.installAtlasResident();
    },
    appendUpdate: (entry) => appendEntryUpdate(entry),
  };
}

async function runOne(id, fn) {
  try {
    const detail = await fn();
    return { id, ok: true, hard: true, detail: detail || "ok" };
  } catch (err) {
    return {
      id,
      ok: false,
      hard: true,
      detail: String(err?.message || err || "controllo fallito").slice(0, 300),
    };
  }
}

function failureSignature(failures) {
  return failures.map((failure) => `${failure.id}:${failure.detail}`).join("|");
}

export async function runStartupIntegrity({ reason = "boot", deps = null, force = false } = {}) {
  if (!force && reason === "wake" && cache && Date.now() - cache.atMs < 15_000) {
    return cache.report;
  }
  const d = deps || (await defaultDeps());
  const checks = [];
  checks.push(await runOne("agentq-status", async () => {
    const status = await d.agentqStatus();
    if (!status?.ok || status.integrated !== true || !(Number(status.hands) > 0)) {
      throw new Error(status?.error || "stato agentq non integro");
    }
    return `integrato · mani ${status.hands}`;
  }));
  checks.push(await runOne("updates-readable", async () => {
    const updates = await d.getEntryUpdates({ limit: 1 });
    if (!updates || updates.ok !== true || !Array.isArray(updates.updates)) {
      throw new Error("aggiornamenti illeggibili");
    }
    return `letti ${updates.updates.length}`;
  }));
  checks.push(await runOne("hands-catalog", async () => {
    const hands = Array.isArray(d.hands) ? d.hands : [];
    const ids = new Set(hands.map((hand) => hand?.id).filter(Boolean));
    const missing = REQUIRED_HAND_IDS.filter((id) => !ids.has(id));
    if (!ids.size || missing.length) {
      throw new Error(`catalogo mani incompleto: ${missing.join(", ") || "vuoto"}`);
    }
    return `catalogo ${ids.size}`;
  }));
  checks.push(await runOne("autonomy-policy", async () => {
    const policy = d.describePolicy();
    if (!policy?.version || !Array.isArray(policy.auto) || !policy.auto.includes("zoom")) {
      throw new Error("policy autonomia illeggibile");
    }
    const zoom = policy.matrix?.auto?.zoom;
    if (!Array.isArray(zoom) || !zoom.includes("zoom-in")) {
      throw new Error("matrice zoom assente");
    }
    return `policy v${policy.version}`;
  }));
  checks.push(await runOne("resident-installable", async () => {
    const status = await d.installResident();
    if (!status?.installed || status.ok !== true) {
      throw new Error("resident non installabile");
    }
    return "installato";
  }));
  checks.push(await runOne("sandbox-path", async () => {
    if (!d.sandboxExists()) throw new Error("sandbox assente");
    return "sandbox presente";
  }));

  for (const id of CHECK_IDS) {
    if (!checks.some((check) => check.id === id)) {
      checks.push({ id, ok: false, hard: true, detail: "controllo non eseguito" });
    }
  }

  const failures = checks.filter((check) => !check.ok).map((check) => ({
    id: check.id,
    detail: check.detail,
  }));
  const previous = readIntegrityReport();
  const signature = failureSignature(failures);
  let announced = previous?.announced || "";
  if (failures.length && announced !== signature && typeof d.appendUpdate === "function") {
    try {
      d.appendUpdate({
        title: "Integrità avvio",
        detail: failures.map((failure) => `${failure.id}: ${failure.detail}`).join(" · "),
      });
      announced = signature;
    } catch {
      /* the persisted report still records the failure */
    }
  }
  if (!failures.length) announced = "";

  const report = {
    ok: failures.length === 0,
    hardFail: failures.length > 0,
    reason,
    at: new Date().toISOString(),
    checks,
    failures,
    announced,
  };
  try {
    writeIntegrityReport(report);
  } catch (err) {
    report.persistError = err?.message || String(err);
  }
  cache = { atMs: Date.now(), report };
  return report;
}
