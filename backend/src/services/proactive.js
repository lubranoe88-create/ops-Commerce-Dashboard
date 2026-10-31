/**
 * Proactive event detector — mechanical signals only (no LLM).
 * Emits chat bubbles / toasts via /api/ai/proactive/poll.
 */
import { config } from "../config.js";
import { getDashboardSnapshot } from "../memory/store.js";
import {
  listLatestNews,
  listSuggestions,
  listUndeliveredProactive,
  markProactiveDelivered,
  pushProactiveEvent,
  getUserPref,
  upsertUserPref,
} from "../memory/aiStore.js";
import { budgetDayKey, getBudgetStatus } from "./aiBudget.js";

let lastTopsSig = "";
let lastErrorSig = "";
let lastNewsSig = "";
let lastIdlePushMs = 0;

function sig(parts) {
  return parts.join("|");
}

export function scanProactiveEvents() {
  const dayKey = budgetDayKey();
  const snap = getDashboardSnapshot();
  const emitted = [];

  const openErrors = (snap.errors || []).filter((e) => e.status === "open");
  const errSig = sig(
    openErrors.map((e) => `${e.id}:${e.code || e.message || ""}`).slice(0, 12),
  );
  if (errSig && errSig !== lastErrorSig) {
    if (lastErrorSig) {
      const id = pushProactiveEvent(dayKey, "pipeline_errors", {
        count: openErrors.length,
        sample: openErrors.slice(0, 3).map((e) => e.message || e.code || e.id),
        toast: `${openErrors.length} errori pipeline aperti`,
      });
      emitted.push(id);
    }
    lastErrorSig = errSig;
  }

  const tops = (snap.tops || []).slice(0, 5);
  const topsSig = sig(tops.map((t) => `${t.id}:${Math.round((t.score || 0) * 1000)}`));
  if (topsSig && topsSig !== lastTopsSig) {
    if (lastTopsSig) {
      const id = pushProactiveEvent(dayKey, "rank_change", {
        tops: tops.map((t) => ({
          id: t.id,
          title: t.title || t.display_name,
          score: t.score,
        })),
        toast: "Variazione ranking tops",
      });
      emitted.push(id);
    }
    lastTopsSig = topsSig;
  }

  const news = listLatestNews(6);
  const newsSig = sig(news.map((n) => String(n.external_id || n.id)));
  if (newsSig && newsSig !== lastNewsSig) {
    if (lastNewsSig) {
      const id = pushProactiveEvent(dayKey, "news_pins", {
        count: news.length,
        titles: news.slice(0, 3).map((n) => n.title),
        toast: `${news.length} news pin aggiornati`,
      });
      emitted.push(id);
    }
    lastNewsSig = newsSig;
  }

  const suggestions = listSuggestions(dayKey, 5).filter((s) => s.status === "new");
  if (suggestions.length) {
    const pref = getUserPref("proactive_suggestions_nudge");
    const already = pref?.value?.dayKey === dayKey;
    if (!already) {
      const id = pushProactiveEvent(dayKey, "suggestions", {
        count: suggestions.length,
        items: suggestions.slice(0, 3).map((s) => ({
          id: s.id,
          area: s.area,
          issue: s.issue,
          effort: s.effort,
          action: s.action,
        })),
        toast: `${suggestions.length} improvement suggestions`,
      });
      emitted.push(id);
      upsertUserPref("proactive_suggestions_nudge", { dayKey });
    }
  }

  const idleMs = Date.now() - lastIdlePushMs;
  if (lastIdlePushMs === 0) {
    lastIdlePushMs = Date.now();
  } else if (idleMs > 12 * 60 * 1000) {
    lastIdlePushMs = Date.now();
    const budget = getBudgetStatus();
    const id = pushProactiveEvent(dayKey, "idle_nudge", {
      toast: "Plancia in idle — chiedi un briefing o Analizza un top",
      remainingEur: budget.remainingEur,
    });
    emitted.push(id);
  }

  return emitted;
}

export function pollProactive({ mark = true } = {}) {
  scanProactiveEvents();
  const dayKey = budgetDayKey();
  const events = listUndeliveredProactive(dayKey, 20);
  if (mark && events.length) {
    markProactiveDelivered(events.map((e) => e.id));
  }
  const ttsMode = config.aiProactiveTts;
  const prefVal = getUserPref("proactive_tts")?.value;
  const ttsOptIn = prefVal === true || prefVal === "on";
  const speak = ttsMode === "on" || (ttsMode === "opt_in" && ttsOptIn);
  return {
    events,
    tts: {
      mode: ttsMode,
      enabled: speak,
      default: "opt_in_off",
    },
  };
}

export function setProactiveTtsOptIn(on) {
  upsertUserPref("proactive_tts", on ? "on" : "off");
  return { ok: true, enabled: Boolean(on) };
}

/** Test helper: force an idle nudge immediately. */
export function forceIdleNudgeForTest() {
  lastIdlePushMs = Date.now() - 13 * 60 * 1000;
  return scanProactiveEvents();
}
