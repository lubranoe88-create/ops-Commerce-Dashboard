import { describePipelinePlugs } from "../integrations/index.js";
import { buildJudgePayload } from "./judgePayload.js";
import { selectAgents } from "./router.js";
import { runSelectedAgents } from "./runners.js";

/**
 * Full local pass: route → run only selected stub agents → build judge payload.
 * Does not call OpenRouter. OSS sidecars remain documented stubs.
 */
export function runAgentRouterPipeline(context = {}, options = {}) {
  const selection = selectAgents(context, options);
  const agentOutputs = runSelectedAgents(selection, context);
  const judge = buildJudgePayload({
    context,
    selection,
    agentOutputs,
    question: options.question || "final_ranking_or_anomaly",
  });

  return {
    selection,
    agentOutputs,
    judge,
    ossPlugs: describePipelinePlugs(),
  };
}
