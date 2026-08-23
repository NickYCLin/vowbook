"use client";

import { useEffect } from "react";
import {
  DEFAULT_THEME_PREFERENCE,
  THEME_STORAGE_KEY,
  isThemePreference,
  resolveTheme,
  type ThemePreference,
} from "@/lib/theme";

export const THEME_CHANGE_EVENT = "vowbook-theme-change";

function prefersDarkScheme(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function getStoredThemePreference(): ThemePreference {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    return isThemePreference(saved) ? saved : DEFAULT_THEME_PREFERENCE;
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

export function applyThemePreference(preference: ThemePreference): void {
  const theme = resolveTheme(preference, prefersDarkScheme());
  document.documentElement.dataset.themePreference = preference;
  document.documentElement.dataset.theme = theme;
}

export function persistThemePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Privacy modes can disable storage; the current page should still update.
  }
  applyThemePreference(preference);
  window.dispatchEvent(
    new CustomEvent<ThemePreference>(THEME_CHANGE_EVENT, {
      detail: preference,
    }),
  );
}

export function ThemeController() {
  useEffect(() => {
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const applyStoredPreference = () => {
      applyThemePreference(getStoredThemePreference());
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) {
        applyStoredPreference();
      }
    };
    const handleThemeChange = (event: Event) => {
      const preference = (event as CustomEvent<ThemePreference>).detail;
      applyThemePreference(
        isThemePreference(preference)
          ? preference
          : getStoredThemePreference(),
      );
    };

    applyStoredPreference();
    media?.addEventListener("change", applyStoredPreference);
    window.addEventListener("storage", handleStorage);
    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);

    return () => {
      media?.removeEventListener("change", applyStoredPreference);
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    };
  }, []);

  return null;
}
