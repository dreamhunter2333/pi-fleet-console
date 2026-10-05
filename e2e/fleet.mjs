import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../", import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), "pi-fleet-ui-"));
for (const dir of ["home", "agent", "config", "data"])
  mkdirSync(join(temporary, dir));
writeFileSync(
  join(temporary, "agent/settings.json"),
  JSON.stringify({ packages: [], enableInstallTelemetry: false }),
);
writeFileSync(join(temporary, "agent/models.json"), "{}");
const reservation = createServer();
await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise((resolve) => reservation.close(resolve));
const base = `http://127.0.0.1:${port}`;
const server = spawn(
  process.execPath,
  [
    join(root, "node_modules/next/dist/bin/next"),
    "dev",
    "-H",
    "127.0.0.1",
    "-p",
    String(port),
  ],
  {
    cwd: root,
    detached: true,
    env: {
      ...process.env,
      PI_FLEET_STATIC_EXPORT: "0",
      NEXT_PUBLIC_PI_FLEET: "1",
      HOME: join(temporary, "home"),
      PI_CODING_AGENT_DIR: join(temporary, "agent"),
      XDG_CONFIG_HOME: join(temporary, "config"),
      XDG_DATA_HOME: join(temporary, "data"),
      PI_WEB_PASSWORD: "",
      PI_WEB_SKIP_VERSION_CHECK: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let log = "";
server.stdout.on("data", (chunk) => {
  log += chunk;
});
server.stderr.on("data", (chunk) => {
  log += chunk;
});
let browser;
let page;
try {
  for (let attempt = 0; attempt < 180; attempt++) {
    if (server.exitCode !== null) throw new Error(log);
    try {
      if ((await fetch(base + "/api/home")).ok) break;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  browser = await chromium.launch();
  page = await browser.newPage({
    viewport: { width: 1100, height: 800 },
  });
  const errors = [];
  const machines = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    try {
      localStorage.setItem("pi-theme", "default-dark");
    } catch {}
    window.fleetStorageReads = [];
    const getItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key) {
      window.fleetStorageReads.push(key);
      return getItem.call(this, key);
    };
    Object.defineProperty(navigator, "standalone", { value: true });
    const supports = CSS.supports.bind(CSS);
    CSS.supports = (...args) =>
      args[0] === "-webkit-touch-callout" || supports(...args);
    window.fleetTestHeight = 780;
    Object.defineProperty(window.visualViewport, "height", {
      get: () => window.fleetTestHeight,
    });
  });
  await page.route("**/api/fleet/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/fleet/machines") {
      await route.fulfill({
        json: {
          machines: [
            { id: "a", name: "Machine A", enabled: true },
            { id: "b", name: "Machine B", enabled: true },
          ],
        },
      });
      return;
    }
    if (url.pathname.startsWith("/api/fleet/proxy/")) {
      machines.push(route.request().headers()["x-pi-machine"]);
      url.pathname = url.pathname.replace("/api/fleet/proxy/", "/api/");
      await route.fulfill({ response: await route.fetch({ url: url.href }) });
      return;
    }
    await route.abort();
  });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Machine A", exact: true }).waitFor();
  await page.waitForFunction(
    () =>
      document.documentElement.style.getPropertyValue(
        "--app-viewport-height",
      ) === "780px",
  );
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "github-dark";
  });
  await page.waitForFunction(
    () =>
      document.querySelector('meta[name="theme-color"]')?.content === "#0d1117",
  );
  await page.evaluate(() => {
    const field = document.createElement("input");
    field.id = "fleet-keyboard-fixture";
    document.body.append(field);
    field.focus();
    window.fleetTestHeight = 320;
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await page.waitForFunction(
    () =>
      document.documentElement.dataset.keyboardOpen === "true" &&
      document.documentElement.style.getPropertyValue(
        "--app-viewport-height",
      ) === "320px",
  );
  await page.evaluate(() => {
    document.querySelector("#fleet-keyboard-fixture").remove();
    window.fleetTestHeight = 780;
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await page.waitForFunction(
    () =>
      !document.documentElement.dataset.keyboardOpen &&
      document.documentElement.style.getPropertyValue(
        "--app-viewport-height",
      ) === "780px",
  );
  await page.getByRole("button", { name: "Machine A", exact: true }).click();
  const switched = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/fleet/proxy/sessions" &&
      response.request().headers()["x-pi-machine"] === "b",
  );
  await page.getByRole("button", { name: "Machine B", exact: true }).click();
  assert.equal((await switched).status(), 200);
  await page.waitForFunction(() =>
    window.fleetStorageReads.some((key) => key.endsWith(":b")),
  );
  assert(machines.includes("a") && machines.includes("b"));
  assert(
    await page.evaluate(() =>
      window.fleetStorageReads.some((key) => key.endsWith(":a")),
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Fleet routing, machine storage isolation, migrated themes and PWA keyboard/baseline sizing",
  );
} finally {
  try {
    await page?.unrouteAll({ behavior: "ignoreErrors" });
    await browser?.close();
  } finally {
    if (server.exitCode === null) {
      process.kill(-server.pid, "SIGTERM");
      await Promise.race([
        once(server, "exit"),
        new Promise((resolve) =>
          setTimeout(() => {
            try {
              process.kill(-server.pid, "SIGKILL");
            } catch (error) {
              if (error.code !== "ESRCH") throw error;
            }
            resolve();
          }, 10000).unref(),
        ),
      ]);
    }
    rmSync(temporary, { recursive: true, force: true });
  }
  if (process.exitCode) console.error(log.slice(-4000));
}
