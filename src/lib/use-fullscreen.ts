"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

export type FullscreenMode = "off" | "native" | "overlay";

type WebkitDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitFullscreenEnabled?: boolean;
  webkitExitFullscreen?: () => Promise<void> | void;
};

type WebkitElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void;
};

function currentFullscreenElement(): Element | null {
  const doc = document as WebkitDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/**
 * 元素全螢幕。瀏覽器有 Fullscreen API 就用原生全螢幕；iPhone Safari 這類
 * 不支援元素全螢幕的環境，退回鋪滿視窗的覆蓋模式，Esc 一樣可以離開。
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>) {
  const [mode, setMode] = useState<FullscreenMode>("off");

  useEffect(() => {
    function sync() {
      const active = currentFullscreenElement();
      setMode((current) => {
        if (active && active === ref.current) return "native";
        return current === "native" ? "off" : current;
      });
    }
    document.addEventListener("fullscreenchange", sync);
    document.addEventListener("webkitfullscreenchange", sync);
    return () => {
      document.removeEventListener("fullscreenchange", sync);
      document.removeEventListener("webkitfullscreenchange", sync);
    };
  }, [ref]);

  useEffect(() => {
    if (mode !== "overlay") return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMode("off");
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mode]);

  const enter = useCallback(async () => {
    const element = ref.current as WebkitElement | null;
    if (!element) return;
    const doc = document as WebkitDocument;
    const enabled = doc.fullscreenEnabled ?? doc.webkitFullscreenEnabled ?? false;
    const request = element.requestFullscreen ?? element.webkitRequestFullscreen;
    if (enabled && request) {
      try {
        await request.call(element);
        setMode("native");
        return;
      } catch {
        // 被瀏覽器拒絕（例如嵌在 iframe 裡）就改用覆蓋模式。
      }
    }
    setMode("overlay");
  }, [ref]);

  const exit = useCallback(async () => {
    if (currentFullscreenElement()) {
      const doc = document as WebkitDocument;
      const exitNative = doc.exitFullscreen ?? doc.webkitExitFullscreen;
      try {
        await exitNative?.call(doc);
      } catch {
        // 已經不在全螢幕狀態，直接收起即可。
      }
    }
    setMode("off");
  }, []);

  const toggle = useCallback(() => {
    if (mode === "off") void enter();
    else void exit();
  }, [enter, exit, mode]);

  return { mode, isFullscreen: mode !== "off", enter, exit, toggle };
}
