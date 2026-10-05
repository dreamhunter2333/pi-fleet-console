import type { Metadata, Viewport } from "next";
import {
  THEME_INIT_SCRIPT as upstreamThemeInit,
  type ResolvedTheme,
} from "@/lib/theme";

const enabled = process.env.NEXT_PUBLIC_PI_FLEET === "1";

export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#ffffff",
  dark: "#1a1a1a",
  mist: "#f4f8f7",
  rose: "#fcf7f8",
  pine: "#19201f",
  lilac: "#f8f6fc",
  sand: "#faf6ee",
  dusk: "#1e1a24",
  ember: "#1f1a16",
  slate: "#161b26",
  "contrast-light": "#ffffff",
  "contrast-dark": "#000000",
  zenburn: "#3f3f3f",
  "github-light": "#ffffff",
  "github-dark": "#0d1117",
  "one-half-light": "#fafafa",
  "one-half-dark": "#282c34",
};

export function withFleetMetadata(metadata: Metadata): Metadata {
  if (!enabled) return metadata;
  return {
    ...metadata,
    appleWebApp: {
      ...(metadata.appleWebApp as object),
      statusBarStyle: "default",
    },
  };
}

export function withFleetViewport(viewport: Viewport): Viewport {
  return enabled ? { ...viewport, themeColor: "#ffffff" } : viewport;
}

export function fleetViewportHeight(
  innerHeight: number,
  viewportHeight: number,
  scale: number,
): number {
  return Math.min(innerHeight, viewportHeight * (scale > 0 ? scale : 1));
}

export const THEME_INIT_SCRIPT = enabled
  ? `(function(){try{var t=localStorage.getItem("pi-theme");if(t==="default-light"||t==="default-dark")localStorage.setItem("pi-theme",t.slice(8))}catch(e){}})();` +
    upstreamThemeInit +
    `(function(){var r=document.documentElement;r.dataset.fleet="true";if(navigator.standalone||window.matchMedia("(display-mode: standalone)").matches)r.dataset.standalone="true";var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",${JSON.stringify(THEME_COLORS)}[r.dataset.theme])})();`
  : upstreamThemeInit;
