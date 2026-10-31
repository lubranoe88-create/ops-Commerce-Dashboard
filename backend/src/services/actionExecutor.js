/**
 * Server-side execution of paid write actions (corrections, notes, prefs, goals…).
 * UI actions are executed client-side via runHoloAction.
 */
import { applyUserCorrection, getDashboardSnapshot } from "../memory/store.js";
import {
  acceptSuggestion,
  upsertUserPref,
  listUserPrefs,
  getUserPref,
} from "../memory/aiStore.js";
import { WRITE_ACTIONS, actionNeedsConfirm } from "./panelCatalog.js";
import { isAiPaid } from "../middleware/aiPaidGate.js";

export function executeWriteAction(action, { confirmed = false } = {}) {
  if (!isAiPaid()) {
    const err = new Error("AI paid tier required for write actions");
    err.status = 402;
    err.code = "AI_PAYMENT_REQUIRED";
    throw err;
  }
  const type = typeof action === "string" ? action : action?.type;
  const payload = typeof action === "object" ? action : {};
  if (!WRITE_ACTIONS[type]) {
    const err = new Error(`Unknown write action: ${type}`);
    err.status = 400;
    throw err;
  }
  if (actionNeedsConfirm(type) && !confirmed && !payload.confirmed) {
    return {
      ok: false,
      needsConfirm: true,
      action: type,
      message: `Conferma richiesta per: ${WRITE_ACTIONS[type].desc}`,
    };
  }

  switch (type) {
    case "correct": {
      const businessKey = payload.business_key || payload.businessKey || payload.targetId;
      const verdict = payload.verdict;
      if (!businessKey || !["correct", "incorrect"].includes(verdict)) {
        const err = new Error("correct requires business_key + verdict");
        err.status = 400;
        throw err;
      }
      applyUserCorrection({
        businessKey,
        rank: payload.rank,
        verdict,
        reasonLine: String(payload.reason_line || payload.note || "").slice(0, 280),
      });
      return { ok: true, type, snapshot: getDashboardSnapshot() };
    }
    case "note": {
      const key = `note:${payload.business_key || payload.targetId || "general"}`;
      upsertUserPref(key, {
        text: String(payload.text || payload.note || "").slice(0, 2000),
        at: Date.now(),
      });
      return { ok: true, type, pref: getUserPref(key) };
    }
    case "reorder-tops": {
      const ids = Array.isArray(payload.ids) ? payload.ids.map(String).slice(0, 40) : [];
      upsertUserPref("tops_order", ids);
      return { ok: true, type, ids };
    }
    case "set-goals": {
      const goals = {
        q1: String(payload.q1 || "").slice(0, 500),
        q2: String(payload.q2 || "").slice(0, 500),
        q3: String(payload.q3 || "").slice(0, 500),
      };
      upsertUserPref("goals", goals);
      return { ok: true, type, goals };
    }
    case "set-pref": {
      const prefKey = String(payload.key || "").slice(0, 120);
      if (!prefKey) {
        const err = new Error("set-pref requires key");
        err.status = 400;
        throw err;
      }
      upsertUserPref(prefKey, payload.value ?? "");
      return { ok: true, type, pref: getUserPref(prefKey) };
    }
    case "accept-suggestion": {
      const id = Number(payload.id || payload.suggestionId);
      if (!Number.isFinite(id)) {
        const err = new Error("accept-suggestion requires id");
        err.status = 400;
        throw err;
      }
      const result = acceptSuggestion(id, { track: payload.track !== false });
      if (!result) {
        const err = new Error("suggestion not found");
        err.status = 404;
        throw err;
      }
      return {
        ok: true,
        type,
        suggestion: result.suggestion,
        taskId: result.taskId,
        actions: result.actions,
      };
    }
    case "chat-send": {
      // Chat send is primarily client-executed; server records intent in prefs.
      upsertUserPref("last_chat_send", {
        text: String(payload.text || payload.message || "").slice(0, 2000),
        at: Date.now(),
      });
      return {
        ok: true,
        type,
        clientAction: { type: "chat-send", text: payload.text || payload.message || "" },
      };
    }
    default: {
      const err = new Error(`Unhandled write action: ${type}`);
      err.status = 400;
      throw err;
    }
  }
}

export function listPrefs() {
  return listUserPrefs();
}
