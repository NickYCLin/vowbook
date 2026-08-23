import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  isThemePreference,
  resolveTheme,
  themeOptions,
} from "./theme";

describe("VowBook theme contract", () => {
  it("keeps the existing paper theme as the default", () => {
    expect(DEFAULT_THEME_PREFERENCE).toBe("vowbook-paper");
    expect(THEME_STORAGE_KEY).toBe("vowbook-theme");
  });

  it("offers four named themes and an explicit system preference", () => {
    expect(themeOptions.map((option) => option.value)).toEqual([
      "vowbook-paper",
      "morning-mist",
      "forest-vow",
      "starlit-reception",
      "system",
    ]);
  });

  it("resolves the system preference without changing explicit choices", () => {
    expect(resolveTheme("system", false)).toBe("morning-mist");
    expect(resolveTheme("system", true)).toBe("starlit-reception");
    expect(resolveTheme("forest-vow", true)).toBe("forest-vow");
  });

  it("rejects unknown persisted values", () => {
    expect(isThemePreference("morning-mist")).toBe(true);
    expect(isThemePreference("unknown-theme")).toBe(false);
    expect(isThemePreference(null)).toBe(false);
  });
});
