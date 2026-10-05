// Settings shows these as swatches: System, the light row, the dark row, then a row of three:
// the high-contrast pair and Zenburn.
// The rows line up by hue: each light theme sits above its dark counterpart; Rose and Slate have none.
export const THEME_OPTIONS = [
  { id: "auto", label: "settings.themeSystem", scheme: null },
  { id: "light", label: "settings.themeLight", scheme: "light" },
  { id: "mist", label: "settings.themeMist", scheme: "light" },
  { id: "lilac", label: "settings.themeLilac", scheme: "light" },
  { id: "sand", label: "settings.themeSand", scheme: "light" },
  { id: "rose", label: "settings.themeRose", scheme: "light" },
  { id: "dark", label: "settings.themeDark", scheme: "dark" },
  { id: "pine", label: "settings.themePine", scheme: "dark" },
  { id: "dusk", label: "settings.themeDusk", scheme: "dark" },
  { id: "ember", label: "settings.themeEmber", scheme: "dark" },
  { id: "slate", label: "settings.themeSlate", scheme: "dark" },
  { id: "contrast-light", label: "settings.themeContrastLight", scheme: "light" },
  { id: "contrast-dark", label: "settings.themeContrastDark", scheme: "dark" },
  { id: "zenburn", label: "settings.themeZenburn", scheme: "dark" },
  { id: "github-light", label: "GitHub Light", scheme: "light" },
  { id: "github-dark", label: "GitHub Dark", scheme: "dark" },
  { id: "one-half-light", label: "One Half Light", scheme: "light" },
  { id: "one-half-dark", label: "One Half Dark", scheme: "dark" },
] as const;

export type ThemePreference = (typeof THEME_OPTIONS)[number]["id"];
export type ResolvedTheme = Exclude<ThemePreference, "auto">;

export const LIGHT_THEMES: readonly ResolvedTheme[] = THEME_OPTIONS.flatMap((option) => (option.scheme === "light" ? [option.id] : []));
export const DARK_THEMES: readonly ResolvedTheme[] = THEME_OPTIONS.flatMap((option) => (option.scheme === "dark" ? [option.id] : []));

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

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_OPTIONS.some((option) => option.id === value);
}

export function isDarkTheme(theme: ResolvedTheme): boolean {
  return DARK_THEMES.includes(theme);
}

// Apply the saved palette before first paint, including when storage is blocked.
export const THEME_INIT_SCRIPT = `(function(){var t="auto";try{var s=localStorage.getItem("pi-theme");if(s==="default-light")s="light";if(s==="default-dark")s="dark";if(${JSON.stringify(THEME_OPTIONS.map((option) => option.id))}.includes(s))t=s}catch(e){}if(t==="auto")t=window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var r=document.documentElement;r.dataset.theme=t;r.classList.toggle("dark",${JSON.stringify(DARK_THEMES)}.includes(t));var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute("content",${JSON.stringify(THEME_COLORS)}[t])})();`;
