"use client";

import { CaretDown } from "@phosphor-icons/react";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { cn } from "@/lib/class-names";
import {
  DEFAULT_THEME_PREFERENCE,
  themeOptions,
  type ThemePreference,
} from "@/lib/theme";
import {
  getStoredThemePreference,
  persistThemePreference,
  THEME_CHANGE_EVENT,
} from "./theme-controller";

function subscribeThemePreference(onStoreChange: () => void) {
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function getThemePreferenceSnapshot(): ThemePreference {
  const applied = document.documentElement.dataset.themePreference;
  if (
    applied === "system" ||
    themeOptions.some((option) => option.value === applied)
  ) {
    return applied as ThemePreference;
  }
  return getStoredThemePreference();
}

export function ThemeMenu({
  displayName,
  initial,
}: {
  displayName: string;
  initial: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const preference = useSyncExternalStore(
    subscribeThemePreference,
    getThemePreferenceSnapshot,
    () => DEFAULT_THEME_PREFERENCE,
  );
  const selectedThemeLabel =
    themeOptions.find((option) => option.value === preference)?.label ??
    themeOptions[0].label;

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const details = detailsRef.current;
      if (details?.open && !details.contains(event.target as Node)) {
        details.removeAttribute("open");
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") detailsRef.current?.removeAttribute("open");
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  const selectTheme = (nextPreference: ThemePreference) => {
    persistThemePreference(nextPreference);
  };

  return (
    <details ref={detailsRef} className="group relative min-w-0 print:hidden">
      <summary
        aria-label={`開啟帳號與外觀選單，${displayName}，目前為${selectedThemeLabel}`}
        className="flex min-h-11 max-w-full list-none items-center gap-2 rounded-control px-1.5 text-caption text-ink-soft transition hover:bg-clay-soft/60 hover:text-ink focus-visible:outline-none [&::-webkit-details-marker]:hidden"
      >
        <span
          aria-hidden="true"
          className="grid size-8 shrink-0 place-items-center rounded-full bg-clay-soft font-serif text-caption font-semibold text-clay-strong"
        >
          {initial}
        </span>
        <span className="hidden max-w-28 truncate sm:block">
          {selectedThemeLabel}
        </span>
        <CaretDown
          aria-hidden="true"
          className="size-3.5 shrink-0 transition group-open:rotate-180"
          weight="bold"
        />
      </summary>

      <div className="fixed top-[4.25rem] right-4 left-4 z-50 overflow-hidden rounded-card border border-line bg-surface text-ink shadow-overlay sm:absolute sm:top-full sm:right-0 sm:left-auto sm:mt-2 sm:w-[min(20rem,calc(100vw-2rem))]">
        <fieldset
          aria-label="外觀主題"
          className="min-w-0 border-0 px-3.5 py-4"
        >
          <legend className="px-1 font-serif text-lg font-semibold text-ink">
            外觀主題
          </legend>
          <div className="mt-2 space-y-1">
            {themeOptions.map((option) => {
              const selected = preference === option.value;
              return (
                <label
                  key={option.value}
                  className={cn(
                    "grid min-h-11 cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-control border px-3 py-2 text-caption transition",
                    selected
                      ? "border-clay bg-clay-soft/65 font-semibold text-clay-strong"
                      : "border-transparent text-ink-soft hover:border-line hover:bg-surface-sunken hover:text-ink",
                  )}
                >
                  <input
                    type="radio"
                    name="vowbook-theme"
                    value={option.value}
                    checked={selected}
                    onChange={() => selectTheme(option.value)}
                    className="size-4 shrink-0 accent-clay"
                  />
                  <span className="min-w-0 truncate">{option.label}</span>
                  <span
                    aria-hidden="true"
                    className="flex h-6 w-20 shrink-0 overflow-hidden rounded-full border border-line-strong bg-surface"
                  >
                    {option.palette.map((color) => (
                      <span
                        key={color}
                        className="h-full flex-1"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </span>
                </label>
              );
            })}
          </div>
          <p className="mt-3 px-1 text-eyebrow tracking-normal text-ink-faint">
            只套用在這台裝置
          </p>
        </fieldset>
        <div className="border-t border-line p-2">
          <SignOutButton
            variant="ghost"
            className="w-full justify-start text-ink-soft hover:text-ink"
          />
        </div>
      </div>
    </details>
  );
}
