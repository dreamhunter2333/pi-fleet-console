export const FLEET_HEALTH_TTL_MS = 60_000;
const cache = new Map();
const pending = new Map();
const listeners = new Set();

export function subscribeFleetHealth(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function notify() {
  for (const listener of listeners) listener();
}

export function getFleetHealth(id) {
  if (pending.has(id)) return { status: "checking", checkedAt: 0 };
  const health = cache.get(id);
  if (!health || Date.now() - health.checkedAt >= FLEET_HEALTH_TTL_MS) return { status: "unknown", checkedAt: health?.checkedAt ?? 0 };
  return health;
}

function record(id, status, detail = "") {
  const previous = getFleetHealth(id);
  cache.set(id, { status, detail, checkedAt: Date.now() });
  if (!pending.has(id) && (previous.status !== status || previous.detail !== detail)) notify();
}

export function recordFleetResponse(id, response) {
  if (!response) return;
  if (response.redirected) record(id, "error");
  else if ([401, 403, 429].includes(response.status)) record(id, "error", `HTTP ${response.status}`);
  else if (response.status >= 500) record(id, "offline", `HTTP ${response.status}`);
  else if (response.ok && response.headers.get("content-type")?.includes("application/json")) record(id, "online");
}

export function recordFleetFailure(id, error) {
  if (error?.name !== "AbortError") record(id, "offline");
}

export function checkFleetHealth(id, signal) {
  if (signal.aborted) return Promise.resolve();
  const existing = pending.get(id);
  if (existing) return existing.promise;
  if (getFleetHealth(id).status !== "unknown") return Promise.resolve();
  const promise = Promise.resolve().then(async () => {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, 4000);
    try {
      if (signal.aborted) return;
      const response = await fetch(`/api/fleet/events/${encodeURIComponent(id)}/home`, {
        cache: "no-store",
        signal: controller.signal,
      });
      if (signal.aborted) return;
      if (!response.ok) { record(id, response.status >= 500 ? "offline" : "error", `HTTP ${response.status}`); return; }
      if (!response.headers.get("content-type")?.includes("application/json") || response.redirected) { record(id, "error"); return; }
      const data = await response.json();
      if (signal.aborted) return;
      if (typeof data?.home === "string") record(id, "online");
      else record(id, "error");
    } catch (error) {
      if (!signal.aborted) {
        if (controller.signal.aborted) record(id, "offline");
        else if (error instanceof SyntaxError) record(id, "error");
        else recordFleetFailure(id, error);
      }
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      pending.delete(id);
      notify();
    }
  });
  pending.set(id, { promise });
  notify();
  return promise;
}
