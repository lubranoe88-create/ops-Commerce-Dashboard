/**
 * C6: open problems plus concrete steps.
 * AUTO ids are limited to plancia actions L3 already allows and the UI can run.
 * browser-use, exports, and destructive writes stay ASK.
 */
import { gateHandActions } from "./atlasAutonomyPolicy.js";

const EXECUTABLE_AUTO = new Set(["refresh", "pipeline", "inspect", "news", "controlli"]);

function eur(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(2) : "n/d";
}

function stepsFor(problem, context = {}) {
  const id = String(problem?.id || "").toLowerCase();
  const kind = String(problem?.kind || "").toLowerCase();
  const title = String(problem?.title || problem?.id || "problema").trim();
  const detail = String(problem?.detail || "").trim();
  const blob = `${id} ${kind} ${title} ${detail}`.toLowerCase();
  const budget = context.budget;

  if (blob.includes("browser-use") || blob.includes("browser_use")) {
    const floor = budget?.minRemainingEur != null ? eur(budget.minRemainingEur) : "3.00";
    const remaining = budget ? eur(budget.remainingEur) : "n/d";
    return {
      steps: [
        `Controlla «${title}» sul quadro funzioni${detail ? `: ${detail}` : "."}`,
        `Verifica il residuo di budget (ora €${remaining}, soglia browser €${floor}) e che il worker Python risulti installato.`,
        "Non avviare il browser da questo passo: resta ASK.",
      ],
      auto: ["controlli"],
      ask: ["browser-use"],
    };
  }

  if (kind === "integrity" || id.startsWith("integrity")) {
    return {
      steps: [
        `Apri il rapporto di integrità per «${title}».`,
        detail
          ? `Ripristina il percorso o il file indicato: ${detail}. Non cancellare la sandbox.`
          : "Ripristina il percorso o il file indicato. Non cancellare la sandbox.",
        "Quando il controllo torna intero, il risveglio può di nuovo eseguire passi AUTO.",
      ],
      auto: ["controlli"],
      ask: [],
    };
  }

  if (kind === "pipeline" || id.startsWith("pipe-")) {
    return {
      steps: [
        "Apri il modulo PIPELINE.",
        detail
          ? `Leggi causa e impatto di «${title}»: ${detail}.`
          : `Leggi causa e impatto di «${title}».`,
        "Non cancellare la riga e non riscrivere le top.",
      ],
      auto: ["pipeline", "inspect"],
      ask: [],
    };
  }

  if (kind === "function-board" || id === "function-board") {
    return {
      steps: [
        "Rileggi il quadro funzioni.",
        detail ? `Dettaglio sonda: ${detail}.` : "Se la sonda non risponde, aggiorna la plancia e riapri i controlli.",
        "Non esportare dati per aggirare il quadro.",
      ],
      auto: ["refresh", "controlli"],
      ask: [],
    };
  }

  return {
    steps: [
      `Rileggi «${title}» sul quadro funzioni${detail ? `: ${detail}` : "."}`,
      "Aggiorna la plancia se il dettaglio è una sonda temporanea.",
      "Non cambiare credenziali e non esportare da questo passo.",
    ],
    auto: ["refresh", "controlli"],
    ask: [],
  };
}

export function proposeResolutions(problems, context = {}) {
  const out = [];
  for (const problem of Array.isArray(problems) ? problems : []) {
    const draft = stepsFor(problem, context);
    const gated = gateHandActions([...(draft.auto || []), ...(draft.ask || [])]);
    out.push({
      problemId: problem?.id || "",
      title: problem?.title || "",
      steps: draft.steps,
      auto: gated.actions.filter((id) => EXECUTABLE_AUTO.has(id)),
      reads: gated.actions.filter((id) => !EXECUTABLE_AUTO.has(id)),
      ask: gated.ask,
    });
  }
  return out;
}

export function collectAutoFixes(resolutions) {
  const seen = new Set();
  const ids = [];
  for (const row of Array.isArray(resolutions) ? resolutions : []) {
    for (const id of row?.auto || []) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}
