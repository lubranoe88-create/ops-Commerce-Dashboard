/**
 * P2 learning from habits.
 *
 * Modules and commands the caller actually uses are counted by time of day.
 * On an open wake (including the morning) Atlas prepares the preferred
 * section when L3 marks that module AUTO. A preferred command that is ASK
 * is remembered and not run.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gateHandActions } from "./atlasAutonomyPolicy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PATH = path.resolve(__dirname, "../../data/agentq-memory/atlas-habits.json");

export const HABIT_TZ = "Europe/Rome";
export const MODULE_IDS = new Set(["map", "pipeline", "memory", "chat", "strumenti"]);

const BUCKETS = ["morning", "afternoon", "evening", "night"];
const BUCKET_LABEL = {
  morning: "mattina",
  afternoon: "pomeriggio",
  evening: "sera",
  night: "notte",
};

let pathOverride = "";
let clockFn = null;

export function setHabitsFileForTests(filePath) {
  pathOverride = filePath ? path.resolve(filePath) : "";
}

export function setHabitsClockForTests(fn) {
  clockFn = typeof fn === "function" ? fn : null;
}

export function resetHabitsForTests() {
  pathOverride = "";
  clockFn = null;
}

function habitsNow() {
  return clockFn ? new Date(clockFn()).getTime() : Date.now();
}

function habitsPath() {
  return pathOverride || DEFAULT_PATH;
}

export function hourInZone(at, timeZone = HABIT_TZ) {
  const date = at instanceof Date ? at : new Date(at ?? habitsNow());
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  });
  const raw = fmt.formatToParts(date).find((part) => part.type === "hour")?.value;
  const hour = Number(raw);
  if (!Number.isFinite(hour)) return 0;
  return hour % 24;
}

export function bucketFor(at, timeZone = HABIT_TZ) {
  const hour = hourInZone(at, timeZone);
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18 && hour < 22) return "evening";
  return "night";
}

function emptySlot() {
  return { modules: {}, commands: {} };
}

function emptyHabits() {
  return {
    version: 1,
    buckets: {
      morning: emptySlot(),
      afternoon: emptySlot(),
      evening: emptySlot(),
      night: emptySlot(),
    },
  };
}

function normToken(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);
}

function sanitizeSlot(raw) {
  const slot = emptySlot();
  for (const key of ["modules", "commands"]) {
    const source = raw?.[key];
    if (!source || typeof source !== "object" || Array.isArray(source)) continue;
    for (const [name, count] of Object.entries(source)) {
      const id = normToken(name);
      const n = Number(count);
      if (!id || !Number.isFinite(n) || n < 1) continue;
      slot[key][id] = Math.min(1_000_000, Math.floor(n));
    }
  }
  return slot;
}

export function readHabits() {
  try {
    const raw = JSON.parse(fs.readFileSync(habitsPath(), "utf8"));
    const buckets = {};
    for (const id of BUCKETS) buckets[id] = sanitizeSlot(raw?.buckets?.[id]);
    return { version: 1, buckets };
  } catch {
    return emptyHabits();
  }
}

function persist(data) {
  const dest = habitsPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const buckets = {};
  for (const id of BUCKETS) buckets[id] = sanitizeSlot(data?.buckets?.[id]);
  const body = { version: 1, buckets };
  const tmp = path.join(path.dirname(dest), `.atlas-habits.${process.pid}.tmp`);
  fs.writeFileSync(tmp, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, dest);
  return body;
}

function topKey(map) {
  const entries = Object.entries(map || {}).filter(([key, count]) => key && Number(count) > 0);
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries[0]?.[0] || "";
}

export function noteHabit({ module = "", command = "", at } = {}) {
  const bucket = bucketFor(at ?? habitsNow());
  const moduleId = normToken(module);
  const commandId = normToken(command);
  if (!moduleId && !commandId) return null;
  const data = readHabits();
  const slot = data.buckets[bucket] || emptySlot();
  if (moduleId) slot.modules[moduleId] = (slot.modules[moduleId] || 0) + 1;
  if (commandId) slot.commands[commandId] = (slot.commands[commandId] || 0) + 1;
  data.buckets[bucket] = slot;
  try {
    persist(data);
  } catch {
    return null;
  }
  return { bucket, module: moduleId, command: commandId };
}

/**
 * Preferred module and command for the current bucket.
 * `prepare` is true on an open wake: an AUTO module may be applied.
 * ASK commands stay out of `prepare`.
 */
export function preferredFocus({ at, prepare = false } = {}) {
  const when = at ?? habitsNow();
  const bucket = bucketFor(when);
  const slot = readHabits().buckets[bucket] || emptySlot();
  const moduleId = topKey(slot.modules);
  const commandId = topKey(slot.commands);
  if (!moduleId && !commandId) return null;
  const gated = gateHandActions([moduleId, commandId].filter(Boolean));
  const moduleStep = moduleId ? gated.tagged.find((step) => step.id === moduleId) : null;
  const commandStep = commandId ? gated.tagged.find((step) => step.id === commandId) : null;
  const moduleAuto = moduleStep?.mode === "auto";
  const commandAuto = Boolean(commandStep && commandStep.mode === "auto" && commandId !== moduleId);
  const prepared = [];
  if (moduleId && moduleAuto) prepared.push(moduleId);
  if (commandAuto) prepared.push(commandId);
  const label = BUCKET_LABEL[bucket] || bucket;
  const because = moduleId
    ? `Abitudine della ${label}: il modulo «${moduleId}» è il più usato (${slot.modules[moduleId]}).`
    : `Abitudine della ${label}: il comando «${commandId}» è il più usato (${slot.commands[commandId]}).`;
  return {
    bucket,
    label,
    module: moduleId,
    moduleCount: moduleId ? slot.modules[moduleId] : 0,
    command: commandId,
    commandCount: commandId ? slot.commands[commandId] : 0,
    mode: moduleAuto ? "auto" : moduleId ? "ask" : "",
    commandMode: commandStep?.mode || "",
    prepare: prepared,
    apply: Boolean(prepare && moduleAuto && moduleId),
    because,
  };
}
