/**
 * J6: operator cockpit payload.
 * Live tool calls, pending ASK, decision-log tail, resident status.
 */
import { residentStatus } from "./atlasResident.js";
import { readAtlasSession } from "./atlasSessionStore.js";
import { describePolicy, THRESHOLD } from "./atlasAutonomyPolicy.js";
import { listDecisions } from "./atlasDecisionLog.js";
import { listToolCalls } from "./atlasToolLog.js";
import { listOpenRuns } from "./atlasRuns.js";
import { publicSchedule } from "./atlasSchedule.js";

export function pendingAskItems() {
  const session = readAtlasSession();
  const policy = describePolicy();
  const items = [];
  const seen = new Set();
  for (const row of session.pendingAsk || []) {
    if (!row?.id || seen.has(row.id)) continue;
    seen.add(row.id);
    items.push({
      id: row.id,
      reason: row.reason || "ask",
      source: "session",
      count: policy.approvalCounts?.[row.id] || 0,
      threshold: THRESHOLD,
    });
  }
  for (const [id, count] of Object.entries(policy.approvalCounts || {})) {
    if (count >= THRESHOLD || seen.has(id)) continue;
    seen.add(id);
    items.push({ id, reason: "approval", source: "policy", count, threshold: THRESHOLD });
  }
  return items;
}

export function buildCockpit() {
  const resident = residentStatus();
  const schedule = publicSchedule();
  return {
    ok: true,
    name: "Atlas",
    at: new Date().toISOString(),
    resident: {
      name: resident.name,
      resident: resident.resident,
      installed: resident.installed,
      awake: resident.awake,
      sessionId: resident.sessionId,
      listeners: resident.listeners,
      lastWakeAt: resident.lastWakeAt,
      pending: resident.pending,
    },
    pendingAsk: pendingAskItems(),
    decisions: listDecisions({ limit: 8 }),
    toolCalls: listToolCalls({ limit: 12 }),
    runs: listOpenRuns(),
    schedule: schedule.jobs,
  };
}
