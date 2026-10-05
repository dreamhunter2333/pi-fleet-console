export const THEME_OPTIONS = [
  { id: "light", label: "settings.themeLight" },
  { id: "dark", label: "settings.themeDark" },
  { id: "mist", label: "settings.themeMist" },
  { id: "rose", label: "settings.themeRose" },
  { id: "pine", label: "settings.themePine" },
  { id: "github-light", label: "GitHub Light" },
  { id: "github-dark", label: "GitHub Dark" },
  { id: "one-half-light", label: "One Half Light" },
  { id: "one-half-dark", label: "One Half Dark" },
  { id: "auto", label: "settings.themeSystem" },
] as const;

export type ThemePreference = (typeof THEME_OPTIONS)[number]["id"];
export type ResolvedTheme = Exclude<ThemePreference, "auto">;

export const THEME_COLORS: Record<ResolvedTheme, string> = {
  light: "#ffffff",
  dark: "#1a1a1a",
  mist: "#f4f8f7",
  rose: "#fcf7f8",
  pine: "#19201f",
  "github-light": "#ffffff",
  "github-dark": "#0d1117",
  "one-half-light": "#fafafa",
  "one-half-dark": "#282c34",
};

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_OPTIONS.some((option) => option.id === value);
}

export function isDarkTheme(theme: ResolvedTheme): boolean {
  return theme === "dark" || theme === "pine" || theme === "github-dark" || theme === "one-half-dark";
}

// Apply the saved palette before first paint, including when storage is blocked.
export const THEME_INIT_SCRIPT = `(function(){var t="auto";try{var s=localStorage.getItem("pi-theme");if(s==="default-light")s="light";if(s==="default-dark")s="dark";if(${JSON.stringify(THEME_OPTIONS.map((option) => option.id))}.includes(s))t=s}catch(e){}if(t==="auto")t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var r=document.documentElement;r.dataset.theme=t;r.classList.toggle("dark",t==="dark"||t==="pine"||t==="github-dark"||t==="one-half-dark");var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",${JSON.stringify(THEME_COLORS)}[t])})();`;
