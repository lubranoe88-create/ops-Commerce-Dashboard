/**
 * Stub adapters for verified OSS pieces.
 * No heavy deps installed — each method returns a planned/noop result.
 */

function notInstalled(toolId, stage) {
  return {
    toolId,
    stage,
    status: "not_installed",
    message:
      "Heavy dependencies intentionally not installed. See docs/OSS_INTEGRATION.md.",
  };
}

/** browser-use → mechanical collection */
export async function browserUseCollect(_job = {}) {
  return {
    ...notInstalled("browser-use", "mechanical_collection"),
    plannedOutputs: ["raw_snapshots/", "normalized_signals.jsonl"],
  };
}

/** PyOD → preliminary anomaly scores (zero OpenRouter tokens) */
export async function pyodScore(_featureMatrix = []) {
  return {
    ...notInstalled("pyod", "preliminary_score"),
    plannedOutputs: ["anomaly_scores[] attached to candidates"],
  };
}

/** LangGraph primary orchestrator (Python sidecar later) */
export async function langGraphRun(_context = {}) {
  return {
    ...notInstalled("langgraph", "agent_router"),
    plannedGraph: [
      "select_agents",
      "run_selected",
      "build_judge_payload",
      "optional_judge_via_node_api",
      "write_memory",
    ],
  };
}

/** CrewAI alternative orchestrator */
export async function crewAiRun(_context = {}) {
  return {
    ...notInstalled("crewai", "agent_router"),
    plannedCrew: "map curated agent ids to Crew roles",
  };
}

/** FinRobot behind financial-analysis / failure-detection */
export async function finRobotAnalyze(_dossier = {}) {
  return {
    ...notInstalled("finrobot", "selected_agents"),
    mapsToAgents: ["financial-analysis", "failure-detection"],
  };
}

/** FinGPT behind market-research / failure-detection */
export async function finGptAnalyze(_dossier = {}) {
  return {
    ...notInstalled("fingpt", "selected_agents"),
    mapsToAgents: ["market-research", "failure-detection"],
    note: "Prefer local inference; do not use OpenRouter judge model here",
  };
}

/**
 * OpenBusiness — second-level company understanding.
 * MUST only run after revenues are verified / business is in confirmed tops.
 */
export async function openBusinessDeepen({
  businessKey,
  revenuesVerified = false,
} = {}) {
  if (!revenuesVerified) {
    return {
      toolId: "openbusiness",
      stage: "post_verification_deepen",
      status: "skipped",
      message:
        "Blocked: OpenBusiness runs only after revenues are verified for this business.",
      businessKey: businessKey || null,
    };
  }
  return {
    ...notInstalled("openbusiness", "post_verification_deepen"),
    businessKey: businessKey || null,
    mapsToAgents: ["business-model"],
    plannedOutputs: [
      "business_model_canvas.md",
      "sector_activity_labels",
      "claims_verified_inferred_missing",
    ],
  };
}
