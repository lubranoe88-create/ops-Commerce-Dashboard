/**
 * C7 proactive suggestions.
 *
 * On a wake or a news ingress Atlas proposes useful next steps without being
 * asked. The proposal goes through the L3 gate: AUTO ids are safe to run,
 * ASK ids wait for confirmation. News on a wake is explained by C10 and is
 * not proposed again here; a news ingress may propose «news».
 */
import { gateHandActions } from "./atlasAutonomyPolicy.js";

function asList(value) {
  if (Array.isArray(value)) return value;
  if (value == null || value === "") return [];
  return [value];
}

function clip(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return text.slice(0, max).trim();
}

export function proposeNextSteps({ kind = "wake", bundle = null, newsItems = null, integrityOk = true } = {}) {
  if (integrityOk === false) {
    return {
      text: "",
      steps: [],
      auto: [],
      ask: [],
      tagged: [],
      held: true,
    };
  }

  const proposals = [];
  const push = (id, because) => {
    if (!id || proposals.some((row) => row.id === id)) return;
    proposals.push({ id, because: clip(because, 180) });
  };

  const health = bundle?.health || {};
  const status = String(health.status || "").toLowerCase();
  const openErrors = Number(health.openErrors) || 0;
  const boardErr = Number(bundle?.board?.error) || 0;
  const problems = asList(bundle?.problems);
  const problemCount = Number(bundle?.problemCount ?? problems.length) || 0;
  const degraded = Boolean(status) && !["ok", "n/d", "unknown"].includes(status);
  const pipeline = problems.some((problem) => String(problem?.kind || "").toLowerCase() === "pipeline");
  const newsCount = asList(newsItems).length || (kind === "wake" ? asList(bundle?.news).length : 0);

  if (degraded || openErrors > 0) {
    push("status", openErrors > 0
      ? `Ci sono ${openErrors} errori aperti: rileggo lo stato.`
      : `La salute è ${status}: rileggo lo stato.`);
    push("refresh", "Aggiorno la plancia prima di fidarmi del quadro.");
  }
  if (boardErr > 0) {
    push("controlli", `Il quadro funzioni ha ${boardErr} ${boardErr === 1 ? "errore" : "errori"}: apro i controlli.`);
    push("refresh", "Rileggo i dati del quadro.");
  }
  if (problemCount > 0) {
    push("problems", `Ci sono ${problemCount} ${problemCount === 1 ? "problema aperto" : "problemi aperti"}: li metto in lettura.`);
  }
  if (pipeline) {
    push("pipeline", "Un problema è sulla pipeline: apro quel modulo.");
    push("inspect", "Ispeziono la riga senza riscriverla.");
  }
  if (kind === "ingress" && newsCount > 0) {
    push("news", "È arrivata una news: aggiorno i pin.");
  }
  for (const problem of problems) {
    const blob = `${problem?.id || ""} ${problem?.title || ""} ${problem?.detail || ""}`.toLowerCase();
    if (/\b(export|download|backup)\b/.test(blob)) {
      push("export", "Un export non parte senza conferma.");
    }
  }

  const gated = gateHandActions(proposals.map((row) => row.id));
  const because = new Map(proposals.map((row) => [row.id, row.because]));
  const steps = gated.tagged.map((step) => ({
    id: step.id,
    mode: step.mode,
    reason: step.reason,
    because: because.get(step.id) || "",
  }));
  const text = steps.length
    ? `Proposta. ${steps
        .map((step) =>
          step.mode === "ask"
            ? `Chiedo conferma per «${step.id}»: ${step.because}`
            : `Posso «${step.id}»: ${step.because}`,
        )
        .join(" ")}`
    : "";

  return {
    text,
    steps,
    auto: steps.filter((step) => step.mode === "auto").map((step) => step.id),
    ask: steps.filter((step) => step.mode === "ask"),
    tagged: steps,
    held: false,
  };
}
