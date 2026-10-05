"use client";

import { useEffect } from "react";
import { fleetViewportHeight, THEME_COLORS } from "./platform";

export function FleetPlatform() {
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_PI_FLEET !== "1") return;
    const root = document.documentElement;
    const viewport = window.visualViewport;
    const standalone =
      root.dataset.standalone === "true" &&
      CSS.supports("-webkit-touch-callout", "none");
    const sync = () => {
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute(
          "content",
          THEME_COLORS[
            (root.dataset.theme || "light") as keyof typeof THEME_COLORS
          ],
        );
      if (!standalone || !viewport || root.dataset.keyboardOpen === "true")
        return;
      const height = `${fleetViewportHeight(window.innerHeight, viewport.height, viewport.scale)}px`;
      if (root.style.getPropertyValue("--app-viewport-height") !== height) {
        root.style.setProperty("--app-viewport-height", height);
      }
    };
    const observer = new MutationObserver(sync);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme", "data-keyboard-open", "style"],
    });
    viewport?.addEventListener("resize", sync);
    viewport?.addEventListener("scroll", sync);
    window.addEventListener("resize", sync);
    window.addEventListener("pageshow", sync);
    sync();
    return () => {
      observer.disconnect();
      viewport?.removeEventListener("resize", sync);
      viewport?.removeEventListener("scroll", sync);
      window.removeEventListener("resize", sync);
      window.removeEventListener("pageshow", sync);
    };
  }, []);

  return process.env.NEXT_PUBLIC_PI_FLEET === "1" ? (
    <div className="ios-pwa-status-strip" aria-hidden="true" />
  ) : null;
}
