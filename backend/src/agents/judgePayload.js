/**
 * Build the dossier that will later be sent to the economical OpenRouter
 * model as final judge. Does NOT call OpenRouter / does NOT read the API key.
 */

export function buildJudgePayload({
  context = {},
  selection,
  agentOutputs = [],
  question = "final_ranking_or_anomaly",
} = {}) {
  const system = [
    "Sei il giudice finale della dashboard commerciale.",
    "Non raccogliere dati e non filtrare rumore a scala.",
    "Usa solo il dossier degli agenti selezionati.",
    "Decidi: (1) se un item merita il top ranking, e/o (2) perché un'anomalia è avvenuta.",
    "Rispondi in modo strutturato e cauto; cita gli agent id usati.",
  ].join(" ");

  const dossier = {
    question,
    userMessage: context.message || "",
    sources: context.sources || [],
    router: {
      strategy: selection?.strategy,
      selectedAgentIds: (selection?.selected || []).map((s) => s.id),
    },
    agentOutputs: agentOutputs.map((row) => ({
      agentId: row.selection?.id || row.output?.agentId,
      routerScore: row.selection?.score,
      confidence: row.output?.confidence,
      findings: row.output?.findings || [],
      riskFlags: row.output?.riskFlags || [],
    })),
  };

  const prompt = [
    `Domanda giudice: ${question}`,
    `Messaggio utente: ${context.message || "(vuoto)"}`,
    `Fonti meccaniche citate: ${(context.sources || []).join(", ") || "(nessuna)"}`,
    `Agenti selezionati: ${dossier.router.selectedAgentIds.join(", ") || "(nessuno)"}`,
    "Dossier JSON:",
    JSON.stringify(dossier, null, 2),
    "Emessi: verdetto, affidabilità stimata 0-1, motivazione breve, eventuali follow-up meccanici.",
  ].join("\n\n");

  return {
    readyForOpenRouter: false,
    reason: "OpenRouter not connected in this scaffold — payload only",
    modelRole: "final_judge_only",
    system,
    prompt,
    dossier,
  };
}
