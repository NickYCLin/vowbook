export const THEME_STORAGE_KEY = "vowbook-theme";

export const themeValues = [
  "vowbook-paper",
  "morning-mist",
  "forest-vow",
  "starlit-reception",
] as const;

export type VowBookTheme = (typeof themeValues)[number];
export type ThemePreference = VowBookTheme | "system";

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "vowbook-paper";

export const themeOptions: {
  value: ThemePreference;
  label: string;
  palette: readonly [string, string, string];
}[] = [
  {
    value: "vowbook-paper",
    label: "誓約紙本",
    palette: ["#f7f2ea", "#fffdf9", "#8a5d42"],
  },
  {
    value: "morning-mist",
    label: "晨霧花園",
    palette: ["#f4f6f2", "#e8eeeb", "#587565"],
  },
  {
    value: "forest-vow",
    label: "深林誓言",
    palette: ["#f4f0e6", "#dce5dc", "#23573c"],
  },
  {
    value: "starlit-reception",
    label: "星夜宴會",
    palette: ["#0b1830", "#263a67", "#d9c49a"],
  },
  {
    value: "system",
    label: "跟隨系統",
    palette: ["#f1f3f3", "#9ba9b7", "#17243a"],
  },
];

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    value === "system" ||
    themeValues.includes(value as VowBookTheme)
  );
}

export function resolveTheme(
  preference: ThemePreference,
  prefersDark: boolean,
): VowBookTheme {
  if (preference === "system") {
    return prefersDark ? "starlit-reception" : "morning-mist";
  }
  return preference;
}

export const THEME_BOOTSTRAP_SCRIPT = `(() => {
  const key = ${JSON.stringify(THEME_STORAGE_KEY)};
  const fallback = ${JSON.stringify(DEFAULT_THEME_PREFERENCE)};
  const allowed = ${JSON.stringify(themeOptions.map((option) => option.value))};
  let preference = fallback;
  try {
    const saved = window.localStorage.getItem(key);
    if (allowed.includes(saved)) preference = saved;
  } catch {}
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const theme = preference === "system"
    ? (prefersDark ? "starlit-reception" : "morning-mist")
    : preference;
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = theme;
})();`;
