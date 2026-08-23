"use client";

import { useCallback, useSyncExternalStore } from "react";

export type ThemeId = "github-light" | "github-dark" | "one-half-light" | "one-half-dark";
export type ThemePreference = ThemeId | "auto";

export const THEME_OPTIONS: ReadonlyArray<{
  id: ThemePreference;
  label: string;
  colors: readonly [string, string];
}> = [
  { id: "auto", label: "theme.auto", colors: ["#ffffff", "#0d1117"] },
  { id: "github-light", label: "GitHub Light", colors: ["#ffffff", "#0969da"] },
  { id: "github-dark", label: "GitHub Dark", colors: ["#0d1117", "#2f81f7"] },
  { id: "one-half-light", label: "One Half Light", colors: ["#fafafa", "#0184bc"] },
  { id: "one-half-dark", label: "One Half Dark", colors: ["#282c34", "#61afef"] },
];

type ThemeState = {
  preference: ThemePreference;
  theme: ThemeId;
};

type ToggleOrigin = { x: number; y: number };

const STORAGE_KEY = "pi-theme";
const DARK_THEMES = new Set<ThemeId>(["github-dark", "one-half-dark"]);
const THEME_COLORS: Record<ThemeId, string> = {
  "github-light": "#ffffff",
  "github-dark": "#0d1117",
  "one-half-light": "#fafafa",
  "one-half-dark": "#282c34",
};
const THEME_IDS = new Set<ThemeId>([
  "github-light",
  "github-dark",
  "one-half-light",
  "one-half-dark",
]);
const SERVER_SNAPSHOT: ThemeState = { preference: "auto", theme: "github-light" };

const listeners = new Set<() => void>();
let state: ThemeState | null = null;
let systemListening = false;

function emit(): void {
  listeners.forEach((cb) => cb());
}

function getSystemTheme(): ThemeId {
  if (typeof window === "undefined") return "github-light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "github-dark" : "github-light";
}

function readStoredPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === "auto") return value;
    if (value === "light") return "github-light";
    if (value === "dark") return "github-dark";
    if (THEME_IDS.has(value as ThemeId)) return value as ThemeId;
  } catch {
    // ignore storage errors (private mode, quota, etc.)
  }
  return "auto";
}

function resolveTheme(preference: ThemePreference): ThemeId {
  return preference === "auto" ? getSystemTheme() : preference;
}

function applyDomTheme(theme: ThemeId): void {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", DARK_THEMES.has(theme));
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", THEME_COLORS[theme]);
}

function ensureState(): ThemeState {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;
  if (state) return state;

  const preference = readStoredPreference();
  const theme = resolveTheme(preference);
  applyDomTheme(theme);
  state = { preference, theme };
  return state;
}

function setThemeState(preference: ThemePreference, theme: ThemeId, persist: boolean): void {
  applyDomTheme(theme);
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // ignore storage errors (private mode, quota, etc.)
    }
  }
  state = { preference, theme };
  emit();
}

function syncAutoThemeFromSystem(): void {
  const current = ensureState();
  if (current.preference !== "auto") return;
  const theme = getSystemTheme();
  if (theme === current.theme) return;
  setThemeState("auto", theme, false);
}

function ensureSystemListener(): void {
  if (systemListening || typeof window === "undefined" || !window.matchMedia) return;

  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  mql.addEventListener("change", syncAutoThemeFromSystem);
  window.addEventListener("focus", syncAutoThemeFromSystem);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") syncAutoThemeFromSystem();
  });
  systemListening = true;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  ensureState();
  ensureSystemListener();
  syncAutoThemeFromSystem();
  return () => {
    listeners.delete(cb);
  };
}

function getSnapshot(): ThemeState {
  return ensureState();
}

function getServerSnapshot(): ThemeState {
  return SERVER_SNAPSHOT;
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setTheme = useCallback((preference: ThemePreference, origin?: ToggleOrigin) => {
    const apply = () => setThemeState(preference, resolveTheme(preference), true);
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const supportsVT = typeof document.startViewTransition === "function";

    if (!supportsVT || reduceMotion) {
      apply();
      return;
    }

    const x = origin?.x ?? window.innerWidth / 2;
    const y = origin?.y ?? window.innerHeight / 2;
    const endRadius = Math.hypot(
      Math.max(x, window.innerWidth - x),
      Math.max(y, window.innerHeight - y),
    );

    const transition = document.startViewTransition(apply);
    transition.ready
      .then(() => {
        document.documentElement.animate(
          {
            clipPath: [
              `circle(0px at ${x}px ${y}px)`,
              `circle(${endRadius}px at ${x}px ${y}px)`,
            ],
          },
          {
            duration: 450,
            easing: "cubic-bezier(0.22, 0.61, 0.36, 1)",
            pseudoElement: "::view-transition-new(root)",
          },
        );
      })
      .catch(() => {
        // transition cancelled — ignore
      });
  }, []);

  return {
    theme: snapshot.theme,
    preference: snapshot.preference,
    setTheme,
    isDark: DARK_THEMES.has(snapshot.theme),
  };
}
