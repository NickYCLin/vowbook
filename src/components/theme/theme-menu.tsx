"use client";

import { CaretDown } from "@phosphor-icons/react";
import Link from "next/link";
import {
  type ChangeEvent,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { withBasePath } from "@/lib/base-path";
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

const MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024;
const ACCEPTED_AVATAR_MEDIA_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

function AvatarVisual({
  src,
  initial,
  className,
  testId,
  onError,
}: {
  src: string | null;
  initial: string;
  className: string;
  testId?: string;
  onError: () => void;
}) {
  if (src) {
    return (
      // This authenticated endpoint and the Google account URL must bypass
      // Next's public image optimizer so cookies and remote-host rules remain intact.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        alt=""
        src={src}
        data-testid={testId}
        referrerPolicy="no-referrer"
        className={cn("shrink-0 rounded-full object-cover", className)}
        onError={onError}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full bg-clay-soft font-serif font-semibold text-clay-strong",
        className,
      )}
    >
      {initial}
    </span>
  );
}

async function responseErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : fallback;
  } catch {
    return fallback;
  }
}

export function ThemeMenu({
  displayName,
  initial,
  googleAvatarUrl = null,
  customAvatarUrl = null,
  adminHref = null,
}: {
  displayName: string;
  initial: string;
  googleAvatarUrl?: string | null;
  customAvatarUrl?: string | null;
  adminHref?: string | null;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUrl, setAvatarUrl] = useState(
    customAvatarUrl ?? googleAvatarUrl,
  );
  const [hasCustomAvatar, setHasCustomAvatar] = useState(
    customAvatarUrl !== null,
  );
  const [avatarPending, setAvatarPending] = useState(false);
  const [avatarMessage, setAvatarMessage] = useState("");
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

  const handleAvatarError = () => {
    setAvatarUrl((current) =>
      current === googleAvatarUrl ? null : googleAvatarUrl,
    );
  };

  const uploadAvatar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!ACCEPTED_AVATAR_MEDIA_TYPES.has(file.type)) {
      setAvatarMessage("頭像只支援 JPEG、PNG 或 WebP 圖片。");
      return;
    }
    if (file.size === 0 || file.size > MAX_AVATAR_UPLOAD_BYTES) {
      setAvatarMessage("頭像圖片必須小於 5 MiB，且不可為空檔。");
      return;
    }

    setAvatarPending(true);
    setAvatarMessage("");
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch(withBasePath("/api/profile/avatar"), {
        method: "POST",
        credentials: "same-origin",
        body: formData,
      });
      if (!response.ok) {
        setAvatarMessage(
          await responseErrorMessage(response, "目前無法更新頭像，請稍後再試。"),
        );
        return;
      }

      const payload = (await response.json()) as { updatedAt?: unknown };
      if (typeof payload.updatedAt !== "string") {
        setAvatarMessage("頭像已送出，但無法確認更新結果，請重新整理頁面。");
        return;
      }
      setHasCustomAvatar(true);
      setAvatarUrl(
        withBasePath(
          `/api/profile/avatar?v=${encodeURIComponent(payload.updatedAt)}`,
        ),
      );
      setAvatarMessage("已更新自訂頭像。");
    } catch {
      setAvatarMessage("目前無法更新頭像，請檢查網路後再試。");
    } finally {
      setAvatarPending(false);
    }
  };

  const restoreDefaultAvatar = async () => {
    setAvatarPending(true);
    setAvatarMessage("");
    try {
      const response = await fetch(withBasePath("/api/profile/avatar"), {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!response.ok) {
        setAvatarMessage(
          await responseErrorMessage(response, "目前無法移除自訂頭像，請稍後再試。"),
        );
        return;
      }
      setHasCustomAvatar(false);
      setAvatarUrl(googleAvatarUrl);
      setAvatarMessage(
        googleAvatarUrl
          ? "已恢復使用 Google 帳號頭像。"
          : "已移除自訂頭像，改用姓名縮寫。",
      );
    } catch {
      setAvatarMessage("目前無法移除自訂頭像，請檢查網路後再試。");
    } finally {
      setAvatarPending(false);
    }
  };

  return (
    <details ref={detailsRef} className="group relative min-w-0 print:hidden">
      <summary
        aria-label={`開啟帳號與外觀選單，${displayName}，目前為${selectedThemeLabel}`}
        className="flex min-h-11 max-w-full list-none items-center gap-2 rounded-control px-1.5 text-caption text-ink-soft transition hover:bg-clay-soft/60 hover:text-ink focus-visible:outline-none [&::-webkit-details-marker]:hidden"
      >
        <AvatarVisual
          src={avatarUrl}
          initial={initial}
          className="size-8 text-caption"
          testId="account-avatar-image"
          onError={handleAvatarError}
        />
        <span className="hidden max-w-28 truncate sm:block">
          {selectedThemeLabel}
        </span>
        <CaretDown
          aria-hidden="true"
          className="size-3.5 shrink-0 transition group-open:rotate-180"
          weight="bold"
        />
      </summary>

      <div className="fixed top-[4.25rem] right-4 left-4 z-50 max-h-[calc(100dvh-5.25rem)] overflow-y-auto rounded-card border border-line bg-surface text-ink shadow-overlay sm:absolute sm:top-full sm:right-0 sm:left-auto sm:mt-2 sm:w-[min(20rem,calc(100vw-2rem))]">
        <section aria-labelledby="avatar-heading" className="px-4 py-4">
          <h2 id="avatar-heading" className="font-serif text-lg font-semibold">
            帳號頭像
          </h2>
          <div className="mt-3 flex min-w-0 items-center gap-3">
            <AvatarVisual
              src={avatarUrl}
              initial={initial}
              className="size-14 text-lg"
              onError={handleAvatarError}
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{displayName}</p>
              <p className="mt-0.5 text-xs text-ink-soft">
                {hasCustomAvatar
                  ? "目前使用自訂頭像"
                  : googleAvatarUrl
                    ? "使用 Google 帳號頭像"
                    : "目前使用姓名縮寫"}
              </p>
            </div>
          </div>
          <input
            ref={avatarInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            aria-label="選擇自訂頭像"
            className="sr-only"
            disabled={avatarPending}
            onChange={(event) => void uploadAvatar(event)}
          />
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              disabled={avatarPending}
              className="min-h-11 rounded-full border border-clay px-3 py-2 text-sm font-semibold text-clay-strong transition hover:bg-clay-soft disabled:cursor-wait disabled:opacity-60"
              onClick={() => avatarInputRef.current?.click()}
            >
              {hasCustomAvatar ? "更換頭像" : "上傳自訂頭像"}
            </button>
            {hasCustomAvatar ? (
              <button
                type="button"
                disabled={avatarPending}
                className="min-h-11 rounded-full border border-line px-3 py-2 text-sm font-semibold text-ink-soft transition hover:bg-surface-sunken hover:text-ink disabled:cursor-wait disabled:opacity-60"
                onClick={() => void restoreDefaultAvatar()}
              >
                {googleAvatarUrl ? "恢復 Google 頭像" : "移除自訂頭像"}
              </button>
            ) : null}
          </div>
          <p
            aria-live="polite"
            className={cn(
              "mt-2 min-h-5 text-xs",
              avatarMessage ? "text-ink-soft" : "text-ink-faint",
            )}
          >
            {avatarPending
              ? "正在處理頭像…"
              : avatarMessage || "支援 JPEG、PNG、WebP，檔案上限 5 MiB。"}
          </p>
        </section>
        <div className="border-t border-line" />
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
        {adminHref ? (
          <div className="border-t border-line p-2">
            <Link
              href={adminHref}
              className="flex min-h-11 w-full items-center rounded-control px-4 text-sm font-semibold text-ink-soft transition hover:bg-clay-soft hover:text-ink"
            >
              使用者管理
            </Link>
          </div>
        ) : null}
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
