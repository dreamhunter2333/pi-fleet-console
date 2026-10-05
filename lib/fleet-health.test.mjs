import assert from "node:assert/strict";
import test from "node:test";
import { FLEET_HEALTH_TTL_MS, checkFleetHealth, getFleetHealth, recordFleetFailure, recordFleetResponse } from "./fleet-health.mjs";

test("machine health is lazy, deduplicated and cached, including failed checks", async (t) => {
  t.mock.method(AbortSignal, "any", () => { throw new Error("Unavailable on older Safari"); });
  t.mock.method(AbortSignal, "timeout", () => { throw new Error("Unavailable on older Safari"); });
  let time = Date.now();
  t.mock.method(Date, "now", () => time);
  let calls = 0;
  let release;
  t.mock.method(globalThis, "fetch", () => {
    calls++;
    return new Promise((resolve) => { release = resolve; });
  });
  const signal = new AbortController().signal;
  assert.equal(getFleetHealth("lazy").status, "unknown");
  assert.equal(calls, 0);
  const first = checkFleetHealth("lazy", signal);
  assert.equal(checkFleetHealth("lazy", signal), first);
  await Promise.resolve();
  assert.equal(calls, 1);
  release(Response.json({ home: "/home/awsl" }));
  await first;
  assert.equal(getFleetHealth("lazy").status, "online");
  await checkFleetHealth("lazy", signal);
  assert.equal(calls, 1);
  time += FLEET_HEALTH_TTL_MS;
  assert.equal(getFleetHealth("lazy").status, "unknown");
  assert.equal(calls, 1);
  const failed = checkFleetHealth("lazy", signal);
  await Promise.resolve();
  release(new Response(null, { status: 502 }));
  await failed;
  assert.equal(getFleetHealth("lazy").status, "offline");
  await checkFleetHealth("lazy", signal);
  assert.equal(calls, 2);
});

test("regular API results supply health without a probe and business errors are not outages", async (t) => {
  t.mock.method(globalThis, "fetch", () => { throw new Error("Unexpected probe"); });
  recordFleetResponse("missing", Response.json({ error: "Machine not found" }, { status: 404 }));
  assert.equal(getFleetHealth("missing").status, "unknown");
  recordFleetResponse("passive", Response.json({ home: "/home/awsl" }));
  recordFleetResponse("passive", Response.json({ error: "Invalid directory" }, { status: 400 }));
  assert.equal(getFleetHealth("passive").status, "online");
  await checkFleetHealth("passive", new AbortController().signal);
  recordFleetFailure("passive", new DOMException("Aborted", "AbortError"));
  assert.equal(getFleetHealth("passive").status, "online");
  recordFleetResponse("passive", new Response(null, { status: 401 }));
  assert.equal(getFleetHealth("passive").status, "error");
});

test("login pages and malformed API responses never turn a machine green", async (t) => {
  const signal = new AbortController().signal;
  for (const [id, response] of [
    ["login", new Response("<html>Login</html>", { headers: { "Content-Type": "text/html" } })],
    ["invalid-json", new Response("{broken", { headers: { "Content-Type": "application/json" } })],
    ["wrong-json", Response.json({ login: true })],
    ["missing-api", new Response(null, { status: 404 })],
  ]) {
    t.mock.method(globalThis, "fetch", async () => response);
    await checkFleetHealth(id, signal);
    assert.equal(getFleetHealth(id).status, "error");
  }
});

test("closing the selector cancels checks without caching a false outage", async (t) => {
  t.mock.method(globalThis, "fetch", (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const controller = new AbortController();
  const pending = checkFleetHealth("cancelled", controller.signal);
  assert.equal(getFleetHealth("cancelled").status, "checking");
  controller.abort();
  await pending;
  assert.equal(getFleetHealth("cancelled").status, "unknown");
});

test("an unresponsive machine has a bounded check and a cached failure", { timeout: 7000 }, async (t) => {
  t.mock.method(globalThis, "fetch", (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  }));
  const keepAlive = setTimeout(() => {}, 6000);
  try {
    await checkFleetHealth("timeout", new AbortController().signal);
    assert.equal(getFleetHealth("timeout").status, "offline");
  } finally { clearTimeout(keepAlive); }
});
