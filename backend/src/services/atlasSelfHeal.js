/**
 * C8 detect and functional self-heal.
 *
 * When startup integrity fails or the function board is in error, Atlas
 * runs the AUTO-safe repairs: refresh the snapshot, re-run the checks, and
 * clear transient flags. Destructive repairs are recorded as ASK and are
 * not executed. Each choice is appended to the M4 decision log.
 */
import { formatDecisionLine, recordDecision } from "./atlasDecisionLog.js";

const TRANSIENT_RE = /transient|timeout|temporar|probe|stale|econn|network|socket|temporane/i;
const DESTRUCTIVE_RE = /\b(wipe|delete|destroy|purge|overwrite|drop|truncate)\b/i;

let depsOverride = null;

export function setSelfHealDepsForTests(deps) {
  depsOverride = deps && typeof deps === "object" ? deps : null;
}

export function resetSelfHealForTests() {
  depsOverride = null;
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

function blobOf(row) {
  return `${row?.id || ""} ${row?.functionId || ""} ${row?.errorType || ""} ${row?.detail || ""} ${row?.title || ""} ${row?.flag || ""}`;
}

export function isTransientFlag(row) {
  if (!row || typeof row !== "object") return false;
  if (row.transient === true) return true;
  return TRANSIENT_RE.test(blobOf(row));
}

export function isDestructiveSignal(row) {
  return DESTRUCTIVE_RE.test(blobOf(row));
}

function boardProblems(bundle) {
  return asList(bundle?.problems).filter((problem) => {
    const kind = String(problem?.kind || "").toLowerCase();
    return kind === "integrity" || kind === "function" || kind === "function-board";
  });
}

export function healNeeded(integrity, bundle) {
  const failures = integrity && integrity.ok === false ? asList(integrity.failures) : [];
  const boardErr = Number(bundle?.board?.error) || 0;
  return failures.length > 0 || boardErr > 0 || boardProblems(bundle).length > 0;
}

async function defaultDeps() {
  const store = await import("../memory/store.js");
  const aiStore = await import("../memory/aiStore.js");
  const integrity = await import("./atlasStartupIntegrity.js");
  return {
    refresh: async () => {
      const snap = store.getDashboardSnapshot();
      const status = snap?.health?.status || "n/d";
      return `snapshot riletto (${status})`;
    },
    rerunChecks: () => integrity.runStartupIntegrity({ reason: "heal", force: true }),
    listFlags: () => aiStore.listFunctionReports(80),
    clearFlag: (id) => {
      aiStore.clearFunctionReport(id);
      return true;
    },
  };
}

function failureDetail(report) {
  const rows = asList(report?.failures);
  if (!rows.length) return "ancora in errore";
  return rows.map((failure) => `${failure.id}: ${failure.detail || "errore"}`).join("; ").slice(0, 240);
}

function askId(row) {
  const raw = String(row?.functionId || row?.id || "wipe")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);
  return raw || "wipe";
}

export async function attemptSelfHeal({ integrity = null, bundle = null, deps = null } = {}) {
  if (!healNeeded(integrity, bundle)) return null;
  const failures = integrity && integrity.ok === false ? asList(integrity.failures) : [];
  const needsDefault = ["refresh", "rerunChecks", "listFlags", "clearFlag"].some((key) => {
    const override = depsOverride?.[key];
    const local = deps?.[key];
    return typeof override !== "function" && typeof local !== "function";
  });
  const base = needsDefault ? await defaultDeps() : {};
  const d = { ...base, ...(depsOverride || {}), ...(deps || {}) };

  const repairs = [];
  const executed = [];
  const cleared = [];

  try {
    const detail = String((await d.refresh()) || "plancia riletta");
    repairs.push({ id: "refresh", mode: "auto", ok: true, detail: detail.slice(0, 240) });
    executed.push("refresh");
  } catch (err) {
    repairs.push({ id: "refresh", mode: "auto", ok: false, detail: String(err?.message || "refresh fallito").slice(0, 240) });
  }

  let rerun = null;
  try {
    rerun = await d.rerunChecks();
    const ok = rerun?.ok !== false && !(Array.isArray(rerun?.failures) && rerun.failures.length);
    repairs.push({
      id: "controlli",
      mode: "auto",
      ok,
      detail: ok ? "controlli rieseguiti" : failureDetail(rerun),
    });
    executed.push("controlli");
  } catch (err) {
    repairs.push({
      id: "controlli",
      mode: "auto",
      ok: false,
      detail: String(err?.message || "controlli non rieseguiti").slice(0, 240),
    });
  }

  let flags = [];
  try {
    flags = asList(await d.listFlags());
  } catch {
    flags = [];
  }

  const askDraft = [];
  for (const flag of flags) {
    if (isTransientFlag(flag)) {
      const id = String(flag.functionId || flag.id || "").trim();
      if (!id) continue;
      try {
        await d.clearFlag(id);
        cleared.push(id);
      } catch (err) {
        repairs.push({
          id: "transient-flags",
          mode: "auto",
          ok: false,
          detail: String(err?.message || id).slice(0, 240),
        });
      }
      continue;
    }
    if (isDestructiveSignal(flag)) {
      const id = askId(flag);
      askDraft.push({
        id,
        because: `Non pulisco «${id}»: non è un flag transitorio e il passo è distruttivo.`,
      });
    }
  }
  repairs.push({
    id: "transient-flags",
    mode: "auto",
    ok: true,
    detail: cleared.length ? `flag transitori puliti: ${cleared.join(", ")}` : "nessun flag transitorio",
    cleared: [...cleared],
  });
  executed.push("transient-flags");

  for (const failure of failures) {
    if (!isDestructiveSignal(failure)) continue;
    askDraft.push({
      id: askId(failure),
      because: `«${failure.id || "controllo"}» chiede un passo distruttivo. Non lo eseguo.`,
    });
  }

  // A destructive repair stays ASK even if that id was promoted to AUTO.
  const ask = [];
  const seenAsk = new Set();
  for (const step of askDraft) {
    if (!step.id || seenAsk.has(step.id)) continue;
    seenAsk.add(step.id);
    ask.push({
      id: step.id,
      mode: "ask",
      reason: "destructive-write",
      because: step.because,
    });
  }

  const recovered = failures.length > 0 && rerun?.ok === true && !asList(rerun?.failures).length;
  const choices = [
    ...repairs
      .filter((repair) => repair.id !== "transient-flags" || repair.ok !== false || repairs.filter((row) => row.id === "transient-flags").length === 1)
      .map((repair) => ({
        action: repair.id,
        mode: "auto",
        reason: repair.id === "refresh" ? "updates" : repair.id === "transient-flags" ? "transient" : "status",
        because: repair.detail,
      })),
    ...ask.map((step) => ({
      action: step.id,
      mode: "ask",
      reason: "destructive-write",
      because: step.because,
    })),
  ];
  const unique = [];
  const seenChoice = new Set();
  for (const choice of choices) {
    const key = `${choice.action}:${choice.mode}`;
    if (seenChoice.has(key)) continue;
    seenChoice.add(key);
    unique.push(choice);
  }
  const entry = recordDecision({ source: "heal", choices: unique });
  return {
    attempted: true,
    recovered,
    integrity: recovered ? { ...rerun, ok: true, hardFail: false, failures: [] } : integrity,
    repairs,
    cleared,
    ask,
    executed,
    decisionLine: formatDecisionLine(entry),
  };
}
