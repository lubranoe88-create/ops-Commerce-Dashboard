/**
 * Last startup-integrity report. No other Atlas imports, so the bridge and
 * the runner can both read it without a cycle.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, "../../data/agentq-memory/startup-integrity.json");

let pathOverride = "";

export function integrityReportPath() {
  return pathOverride || DEFAULT_PATH;
}

export function setIntegrityReportPathForTests(filePath) {
  pathOverride = filePath ? path.resolve(filePath) : "";
}

export function readIntegrityReport() {
  try {
    const parsed = JSON.parse(fs.readFileSync(integrityReportPath(), "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeIntegrityReport(report) {
  const dest = integrityReportPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = path.join(path.dirname(dest), `.startup-integrity.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, dest);
  return report;
}

/** Problems feed for a failed report. An ok report contributes nothing. */
export function problemsFromIntegrityReport(report) {
  if (!report || report.ok !== false) return [];
  const failures = Array.isArray(report.failures) ? report.failures : [];
  return failures.map((failure) => {
    const id = String(failure?.id || "integrity").slice(0, 80);
    return {
      kind: "integrity",
      severity: "high",
      id: `integrity-${id}`,
      title: `Integrità avvio · ${id}`,
      detail: String(failure?.detail || "controllo fallito").slice(0, 500),
      status: "error",
    };
  });
}
