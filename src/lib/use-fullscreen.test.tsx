import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFullscreen } from "./use-fullscreen";

function Harness() {
  const ref = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(ref);
  return (
    <div ref={ref} data-testid="target" data-mode={fullscreen.mode}>
      <button type="button" onClick={fullscreen.toggle}>
        切換
      </button>
    </div>
  );
}

function setFullscreenElement(element: Element | null) {
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => element,
  });
}

describe("useFullscreen", () => {
  afterEach(() => {
    Reflect.deleteProperty(document, "fullscreenEnabled");
    Reflect.deleteProperty(document, "fullscreenElement");
    Reflect.deleteProperty(document, "exitFullscreen");
    Reflect.deleteProperty(HTMLElement.prototype, "requestFullscreen");
    document.body.style.overflow = "";
  });

  it("uses the native Fullscreen API when the browser supports it", async () => {
    Object.defineProperty(document, "fullscreenEnabled", {
      configurable: true,
      value: true,
    });
    const request = vi.fn(function (this: HTMLElement) {
      setFullscreenElement(this);
      return Promise.resolve();
    });
    const exit = vi.fn(() => {
      setFullscreenElement(null);
      return Promise.resolve();
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: request,
    });
    Object.defineProperty(document, "exitFullscreen", {
      configurable: true,
      value: exit,
    });
    render(<Harness />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "切換" }));
    });
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("target")).toHaveAttribute("data-mode", "native");

    // 使用者按 Esc 由瀏覽器離開全螢幕時，狀態要跟著回來。
    setFullscreenElement(null);
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(screen.getByTestId("target")).toHaveAttribute("data-mode", "off");
    expect(exit).not.toHaveBeenCalled();
  });

  it("falls back to a viewport overlay that Escape closes", async () => {
    Object.defineProperty(document, "fullscreenEnabled", {
      configurable: true,
      value: false,
    });
    render(<Harness />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "切換" }));
    });
    expect(screen.getByTestId("target")).toHaveAttribute("data-mode", "overlay");
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.getByTestId("target")).toHaveAttribute("data-mode", "off");
    expect(document.body.style.overflow).toBe("");
  });

  it("falls back to the overlay when the browser rejects the request", async () => {
    Object.defineProperty(document, "fullscreenEnabled", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
      configurable: true,
      value: vi.fn(() => Promise.reject(new Error("denied"))),
    });
    render(<Harness />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "切換" }));
    });
    expect(screen.getByTestId("target")).toHaveAttribute("data-mode", "overlay");
  });
});
