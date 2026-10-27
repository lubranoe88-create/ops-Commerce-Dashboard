/**
 * Stub agent runners — produce structured local dossiers only.
 * No OpenRouter / external LLM calls here (token policy: AI is final judge only).
 */

function baseMeta(agentId, context) {
  return {
    agentId,
    ranAt: new Date().toISOString(),
    mode: "stub_local",
    contextSources: context.sources || [],
  };
}

const RUNNERS = {
  "financial-analysis"(context) {
    return {
      ...baseMeta("financial-analysis", context),
      findings: [
        "Scaffold: correlare filing/revenue pubblici al soggetto della conversazione.",
        "Segnali attesi: crescita/calo ricavi, lag dei bilanci, affidabilità della fonte.",
      ],
      riskFlags: [],
      confidence: 0.4,
    };
  },
  "market-research"(context) {
    return {
      ...baseMeta("market-research", context),
      findings: [
        "Scaffold: usare recensioni, traffico web e marketplace come proxy di volume.",
      ],
      riskFlags: [],
      confidence: 0.4,
    };
  },
  "supply-chain"(context) {
    return {
      ...baseMeta("supply-chain", context),
      findings: [
        "Scaffold: confrontare dogane, noli e stress logistico con eventuali anomalie.",
      ],
      riskFlags: [],
      confidence: 0.4,
    };
  },
  "business-model"(context) {
    return {
      ...baseMeta("business-model", context),
      findings: [
        "Scaffold: mappare brevetti di processo, holding e canali di pagamento.",
      ],
      riskFlags: [],
      confidence: 0.4,
    };
  },
  "failure-detection"(context) {
    return {
      ...baseMeta("failure-detection", context),
      findings: [
        "Scaffold: cercare insolvenze, chiusure e segnali di distress multi-giurisdizione.",
      ],
      riskFlags: ["monitor_insolvency_feeds"],
      confidence: 0.4,
    };
  },
  "hiring-signals"(context) {
    return {
      ...baseMeta("hiring-signals", context),
      findings: [
        "Scaffold: delta annunci LinkedIn/Indeed come leading indicator.",
      ],
      riskFlags: [],
      confidence: 0.35,
    };
  },
};

export function runAgent(agentId, context = {}) {
  const runner = RUNNERS[agentId];
  if (!runner) {
    return {
      ...baseMeta(agentId, context),
      findings: [`Nessun runner locale per agent '${agentId}' (stub).`],
      riskFlags: ["missing_runner"],
      confidence: 0.1,
    };
  }
  return runner(context);
}

export function runSelectedAgents(selection, context = {}) {
  const outputs = [];
  for (const item of selection.selected || []) {
    outputs.push({
      selection: { id: item.id, score: item.score, hits: item.hits },
      output: runAgent(item.id, context),
    });
  }
  return outputs;
}
