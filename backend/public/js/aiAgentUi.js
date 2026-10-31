/**
 * Paid-AI client: busy checkmark, Q1–Q3 briefing, /api/ai turns, news pins, local memory.
 */
const GOALS_KEY = "ops_ai_goals_v1";
const CLIENT_MEM_KEY = "ops_ai_client_memory_v1";
const SKIP_KEY = "ops_ai_briefing_skip_day";

let busyDepth = 0;
let heartbeatTimer = null;
let applyActionFn = null;
let onBriefingDone = null;

function todayKey() {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Berlin",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode */
  }
}

export function getStoredGoals() {
  const g = readJson(GOALS_KEY, null);
  if (!g || g.dayKey !== todayKey()) return { q1: "", q2: "", q3: "", dayKey: todayKey() };
  return g;
}

export function setStoredGoals({ q1, q2, q3 }) {
  const next = {
    dayKey: todayKey(),
    q1: String(q1 || "").trim(),
    q2: String(q2 || "").trim(),
    q3: String(q3 || "").trim(),
    savedAt: Date.now(),
  };
  writeJson(GOALS_KEY, next);
  return next;
}

export function rememberClientNote(note) {
  const mem = readJson(CLIENT_MEM_KEY, { notes: [] });
  const notes = Array.isArray(mem.notes) ? mem.notes : [];
  notes.unshift({ t: Date.now(), note: String(note || "").slice(0, 400) });
  writeJson(CLIENT_MEM_KEY, { notes: notes.slice(0, 40) });
}

export function readClientMemory() {
  return readJson(CLIENT_MEM_KEY, { notes: [] });
}

function busyEl() {
  return document.getElementById("aiBusyMark");
}

function paintBusy(on) {
  const el = busyEl();
  document.body.dataset.aiBusy = on ? "1" : "0";
  if (!el) return;
  if (on) {
    el.hidden = false;
    el.classList.add("is-on");
    el.setAttribute("aria-hidden", "false");
    el.title = "AI al lavoro";
  } else {
    el.classList.remove("is-on");
    el.hidden = true;
    el.setAttribute("aria-hidden", "true");
    el.title = "";
  }
}

/**
 * Nested-safe busy latch. Shows a subtle pulsing ✓ while any AI call is in flight.
 * Heartbeat periodically re-affirms the signal so long jobs stay visibly alive.
 */
export function setAiBusy(on) {
  if (on) {
    busyDepth += 1;
    paintBusy(true);
    if (!heartbeatTimer) {
      heartbeatTimer = setInterval(() => {
        const el = busyEl();
        if (!el || busyDepth <= 0) return;
        el.classList.remove("is-on");
        // force a short reflow so the pulse reads as a periodic tick
        void el.offsetWidth;
        el.classList.add("is-on");
      }, 2400);
    }
  } else {
    busyDepth = Math.max(0, busyDepth - 1);
    if (busyDepth === 0) {
      paintBusy(false);
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }
  }
}

export function isAiBusy() {
  return busyDepth > 0;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("unauthorized");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || res.statusText);
    err.status = res.status;
    err.code = data.code;
    err.payload = data;
    throw err;
  }
  return data;
}

export async function fetchAiStatus() {
  return api("/api/ai/status");
}

export async function fetchAiNews() {
  return api("/api/ai/news");
}

export function wireActionRunner(fn) {
  applyActionFn = typeof fn === "function" ? fn : null;
}

export function wireBriefingHandler(fn) {
  onBriefingDone = typeof fn === "function" ? fn : null;
}

async function applyActions(actions) {
  if (!applyActionFn || !Array.isArray(actions)) return;
  for (const a of actions) {
    try {
      await applyActionFn(a);
    } catch (err) {
      console.warn("[ai] action failed", a, err);
    }
  }
}

export async function runPaidAiTurn({ message, uiState = {} } = {}) {
  const goals = getStoredGoals();
  setAiBusy(true);
  try {
    const result = await api("/api/ai/turn", {
      method: "POST",
      body: JSON.stringify({
        message,
        q1: goals.q1,
        q2: goals.q2,
        q3: goals.q3,
        uiState,
      }),
    });
    await applyActions(result.actions);
    if (result.needQuestions) openBriefingModal();
    if (result.reply) rememberClientNote(`turn:${String(result.reply).slice(0, 160)}`);
    return result;
  } finally {
    setAiBusy(false);
  }
}

export async function submitBriefing({ q1, q2, q3, uiState = {} }) {
  const goals = setStoredGoals({ q1, q2, q3 });
  setAiBusy(true);
  try {
    const result = await api("/api/ai/briefing", {
      method: "POST",
      body: JSON.stringify({
        q1: goals.q1,
        q2: goals.q2,
        q3: goals.q3,
        uiState,
      }),
    });
    await applyActions(result.actions);
    if (onBriefingDone) await onBriefingDone(result);
    return result;
  } finally {
    setAiBusy(false);
  }
}

export function openBriefingModal() {
  const modal = document.getElementById("aiBriefingModal");
  if (!modal) return;
  const goals = getStoredGoals();
  const q1 = document.getElementById("aiQ1");
  const q2 = document.getElementById("aiQ2");
  const q3 = document.getElementById("aiQ3");
  if (q1) q1.value = goals.q1 || "";
  if (q2) q2.value = goals.q2 || "";
  if (q3) q3.value = goals.q3 || "";
  modal.hidden = false;
  q1?.focus();
}

export function closeBriefingModal() {
  const modal = document.getElementById("aiBriefingModal");
  if (modal) modal.hidden = true;
}

export function wireBriefingForm() {
  const form = document.getElementById("aiBriefingForm");
  const skip = document.getElementById("aiBriefingSkip");
  if (form && !form.dataset.wired) {
    form.dataset.wired = "1";
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const q1 = document.getElementById("aiQ1")?.value || "";
      const q2 = document.getElementById("aiQ2")?.value || "";
      const q3 = document.getElementById("aiQ3")?.value || "";
      const submit = document.getElementById("aiBriefingSubmit");
      if (submit) submit.disabled = true;
      try {
        await submitBriefing({
          q1,
          q2,
          q3,
          uiState: { module: document.body.dataset.module || "map" },
        });
        closeBriefingModal();
      } catch (err) {
        const toast = document.getElementById("toastHost");
        if (toast) {
          const d = document.createElement("div");
          d.className = "toast bad";
          d.textContent = err.message || "Briefing fallito";
          toast.appendChild(d);
          setTimeout(() => d.remove(), 4000);
        }
      } finally {
        if (submit) submit.disabled = false;
      }
    });
  }
  if (skip && !skip.dataset.wired) {
    skip.dataset.wired = "1";
    skip.addEventListener("click", () => {
      writeJson(SKIP_KEY, { dayKey: todayKey() });
      closeBriefingModal();
    });
  }
}

export function shouldPromptBriefing(status) {
  if (!status?.paid) return false;
  const goals = getStoredGoals();
  if (goals.q1 && goals.q2 && goals.q3) return false;
  const skip = readJson(SKIP_KEY, null);
  if (skip?.dayKey === todayKey()) return false;
  return true;
}
