/**
 * In-process ingress bus for the Atlas resident.
 * Producers call noteResidentIngress at the write (updates append, news upsert,
 * proactive insert). The resident subscribes once. No timers and no polling.
 */

const handlers = new Set();

export function onResidentIngress(handler) {
  if (typeof handler !== "function") return () => {};
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export function noteResidentIngress(event) {
  if (!event || typeof event !== "object") return;
  const payload = { ...event, at: event.at || new Date().toISOString() };
  for (const handler of handlers) {
    try {
      handler(payload);
    } catch (err) {
      console.warn("[atlas-resident] ingress", err?.message || err);
    }
  }
}
