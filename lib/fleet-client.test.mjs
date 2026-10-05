import assert from "node:assert/strict";
import test from "node:test";
import { fleetResourceUrl, installFleetTransport } from "./fleet-client.ts";

test("Fleet routes terminal requests and media to the selected machine", async () => {
  const requests = [];
  globalThis.window = {
    location: { href: "https://fleet.example/", origin: "https://fleet.example" },
    fetch: async (url, init) => { requests.push({ url: String(url), init }); },
    EventSource: class { constructor(url) { this.url = String(url); } },
    open() {},
  };
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  let restore = installFleetTransport("dev-us");
  try {
    await window.fetch("/api/terminal/abc", { method: "POST", body: "input" });
    assert.equal(requests[0].url, "https://fleet.example/api/fleet/proxy/terminal/abc");
    assert.equal(requests[0].init.headers.get("X-Pi-Machine"), "dev-us");
    assert.equal(requests[0].init.body, "input");
    const events = new window.EventSource("/api/terminal/abc/events?after=3");
    assert.equal(events.url, "https://fleet.example/api/fleet/events/dev-us/terminal/abc/events?after=3");
    const media = fleetResourceUrl("/api/files/tmp/a%20b%23.mp4?type=read");
    assert.equal(media, "https://fleet.example/api/fleet/events/dev-us/files/tmp/a%20b%23.mp4?type=read");
    assert.equal(fleetResourceUrl("https://external.example/image.png"), "https://external.example/image.png");
    restore();
    assert.equal(fleetResourceUrl("/api/files/test"), "/api/files/test");
    restore = installFleetTransport("dev-kala");
    assert.match(fleetResourceUrl("/api/files/test"), /\/events\/dev-kala\/files\/test$/);
    assert.equal(fleetResourceUrl(media), media);
  } finally {
    restore();
    delete globalThis.window;
    delete globalThis.document;
  }
});
