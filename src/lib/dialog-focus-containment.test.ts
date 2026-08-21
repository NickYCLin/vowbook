import { beforeEach, describe, expect, it } from "vitest";
import { containDialogFocus } from "./dialog-focus-containment";

function openDialog(dialog: HTMLDialogElement): void {
  dialog.setAttribute("open", "");
}

function pressTab(target: HTMLElement, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key: "Tab",
    shiftKey,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe("containDialogFocus", () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it("wraps forward and reverse Tab while excluding unavailable controls", () => {
    const dialog = document.createElement("dialog");
    dialog.innerHTML = `
      <button hidden>hidden attribute</button>
      <button style="display: none">display none</button>
      <button disabled>disabled</button>
      <div inert><button>inert descendant</button></div>
      <button data-focus="first">first</button>
      <dialog><button>closed nested dialog</button></dialog>
      <button data-focus="last">last</button>
    `;
    openDialog(dialog);
    dialog.addEventListener("keydown", (event) =>
      containDialogFocus(event, dialog),
    );
    document.body.append(dialog);

    const first = dialog.querySelector<HTMLElement>('[data-focus="first"]')!;
    const last = dialog.querySelector<HTMLElement>('[data-focus="last"]')!;

    last.focus();
    const forwardEvent = pressTab(last);
    expect(forwardEvent.defaultPrevented).toBe(true);
    expect(first).toHaveFocus();

    const reverseEvent = pressTab(first, true);
    expect(reverseEvent.defaultPrevented).toBe(true);
    expect(last).toHaveFocus();
  });

  it("recovers focus from outside the dialog and skips prevented events", () => {
    const outside = document.createElement("button");
    const dialog = document.createElement("dialog");
    dialog.innerHTML = `
      <button data-focus="first">first</button>
      <button data-focus="last">last</button>
    `;
    openDialog(dialog);
    dialog.addEventListener("keydown", (event) =>
      containDialogFocus(event, dialog),
    );
    document.body.append(outside, dialog);

    const first = dialog.querySelector<HTMLElement>('[data-focus="first"]')!;
    const last = dialog.querySelector<HTMLElement>('[data-focus="last"]')!;

    outside.focus();
    const outsideEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    dialog.dispatchEvent(outsideEvent);
    expect(outsideEvent.defaultPrevented).toBe(true);
    expect(first).toHaveFocus();

    last.focus();
    const preventedEvent = new KeyboardEvent("keydown", {
      key: "Tab",
      bubbles: true,
      cancelable: true,
    });
    preventedEvent.preventDefault();
    dialog.dispatchEvent(preventedEvent);
    expect(last).toHaveFocus();
  });

  it("keeps a nested dialog trapped in the top dialog only", () => {
    const outer = document.createElement("dialog");
    outer.innerHTML = `
      <button data-focus="outer-first">outer first</button>
      <dialog>
        <button data-focus="inner-first">inner first</button>
        <button data-focus="inner-last">inner last</button>
      </dialog>
      <button data-focus="outer-last">outer last</button>
    `;
    const inner = outer.querySelector("dialog")!;
    openDialog(outer);
    openDialog(inner);
    outer.addEventListener("keydown", (event) =>
      containDialogFocus(event, outer),
    );
    inner.addEventListener("keydown", (event) =>
      containDialogFocus(event, inner),
    );
    document.body.append(outer);

    const innerFirst = inner.querySelector<HTMLElement>(
      '[data-focus="inner-first"]',
    )!;
    const innerLast = inner.querySelector<HTMLElement>(
      '[data-focus="inner-last"]',
    )!;

    innerLast.focus();
    pressTab(innerLast);
    expect(innerFirst).toHaveFocus();
    expect(outer.querySelector('[data-focus="outer-first"]')).not.toHaveFocus();

    pressTab(innerFirst, true);
    expect(innerLast).toHaveFocus();
    expect(outer.querySelector('[data-focus="outer-last"]')).not.toHaveFocus();
  });

  it("uses sequential tabindex order and ignores closed details contents", () => {
    const dialog = document.createElement("dialog");
    dialog.innerHTML = `
      <button data-focus="zero-first">zero first</button>
      <button data-focus="positive-two" tabindex="2">positive two</button>
      <details>
        <summary>closed details</summary>
        <button data-focus="closed-details-control">closed details control</button>
      </details>
      <button data-focus="positive-one" tabindex="1">positive one</button>
      <button data-focus="zero-last">zero last</button>
    `;
    openDialog(dialog);
    dialog.addEventListener("keydown", (event) =>
      containDialogFocus(event, dialog),
    );
    document.body.append(dialog);

    const first = dialog.querySelector<HTMLElement>(
      '[data-focus="positive-one"]',
    )!;
    const last = dialog.querySelector<HTMLElement>(
      '[data-focus="zero-last"]',
    )!;

    last.focus();
    pressTab(last);
    expect(first).toHaveFocus();

    pressTab(first, true);
    expect(last).toHaveFocus();
    expect(
      dialog.querySelector('[data-focus="closed-details-control"]'),
    ).not.toHaveFocus();
  });
});
