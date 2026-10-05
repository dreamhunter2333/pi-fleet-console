import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  alias: { "@": fileURLToPath(new URL("../", import.meta.url)) },
  moduleCache: false,
});
const { withFleetConfig } = await jiti.import("../bin/fleet-config.mjs");

test("normal Next config remains unchanged; static Fleet export is opt-in", () => {
  const previous = process.env.PI_FLEET_STATIC_EXPORT;
  const config = {
    headers() {},
    env: { NEXT_PUBLIC_APP_VERSION: "0.13.0" },
    images: { unoptimized: true },
  };
  try {
    delete process.env.PI_FLEET_STATIC_EXPORT;
    assert.equal(withFleetConfig(config), config);
    process.env.PI_FLEET_STATIC_EXPORT = "1";
    const fleet = withFleetConfig(config);
    assert.equal(fleet.output, "export");
    assert.equal(fleet.headers, undefined);
    assert.equal(fleet.env.NEXT_PUBLIC_PI_FLEET, "1");
    assert.equal(config.env.NEXT_PUBLIC_PI_FLEET, undefined);
    assert.equal(typeof config.headers, "function");
  } finally {
    if (previous === undefined) delete process.env.PI_FLEET_STATIC_EXPORT;
    else process.env.PI_FLEET_STATIC_EXPORT = previous;
  }
});

test("Fleet first paint migrates old themes and initializes PWA sampling", async () => {
  const previous = process.env.NEXT_PUBLIC_PI_FLEET;
  process.env.NEXT_PUBLIC_PI_FLEET = "1";
  try {
    const {
      THEME_INIT_SCRIPT,
      THEME_COLORS,
      fleetViewportHeight,
      withFleetMetadata,
      withFleetViewport,
    } = await jiti.import("../fleet/platform.ts");
    for (const stored of [
      "default-light",
      "default-dark",
      "github-light",
      "github-dark",
      "one-half-dark",
      "unknown",
    ]) {
      let value = stored;
      let color;
      const root = { dataset: {}, classList: { toggle() {} } };
      runInNewContext(THEME_INIT_SCRIPT, {
        localStorage: {
          getItem: () => value,
          setItem: (_, next) => {
            value = next;
          },
        },
        navigator: { standalone: true },
        window: { matchMedia: () => ({ matches: false }) },
        document: {
          documentElement: root,
          querySelector: () => ({
            setAttribute: (_, next) => {
              color = next;
            },
          }),
        },
      });
      const expected = stored.startsWith("default-")
        ? stored.slice(8)
        : stored === "unknown"
          ? "light"
          : stored;
      assert.equal(root.dataset.theme, expected);
      assert.equal(root.dataset.fleet, "true");
      assert.equal(root.dataset.standalone, "true");
      assert.equal(color, THEME_COLORS[expected]);
    }
    assert.equal(fleetViewportHeight(900, 780, 1), 780);
    assert.equal(fleetViewportHeight(780, 390, 2), 780);
    assert.equal(fleetViewportHeight(780, 900, 1), 780);
    assert.equal(
      withFleetMetadata({
        appleWebApp: {
          capable: true,
          title: "Pi Web",
          statusBarStyle: "black-translucent",
        },
      }).appleWebApp.statusBarStyle,
      "default",
    );
    assert.equal(
      withFleetViewport({ themeColor: "black", viewportFit: "cover" })
        .themeColor,
      "#ffffff",
    );
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_PI_FLEET;
    else process.env.NEXT_PUBLIC_PI_FLEET = previous;
  }
});
