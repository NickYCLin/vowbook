type DialogFocusKeyEvent = {
  defaultPrevented: boolean;
  key: string;
  shiftKey: boolean;
  preventDefault: () => void;
};

const focusableSelector = [
  "a[href]",
  "area[href]",
  "button",
  "input:not([type='hidden'])",
  "select",
  "textarea",
  "summary",
  "iframe",
  "object",
  "embed",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]:not([contenteditable='false'])",
  "[tabindex]",
].join(",");

function isInsideClosedDetails(element: HTMLElement): boolean {
  for (
    let details = element.closest("details");
    details;
    details = details.parentElement?.closest("details") ?? null
  ) {
    if (details.open) {
      continue;
    }

    const summary = Array.from(details.children).find(
      (child) => child.tagName === "SUMMARY",
    );
    if (!summary?.contains(element)) {
      return true;
    }
  }

  return false;
}

function isUnavailable(
  element: HTMLElement,
  dialog: HTMLDialogElement,
): boolean {
  if (
    element.tabIndex < 0 ||
    element.matches(":disabled") ||
    element.closest("[hidden], [inert]") ||
    isInsideClosedDetails(element)
  ) {
    return true;
  }

  const owningDialog = element.closest("dialog");
  if (owningDialog && owningDialog !== dialog && !owningDialog.open) {
    return true;
  }

  for (
    let current: HTMLElement | null = element;
    current && current !== dialog;
    current = current.parentElement
  ) {
    const style = current.ownerDocument.defaultView?.getComputedStyle(current);
    if (
      style?.display === "none" ||
      style?.visibility === "hidden" ||
      style?.visibility === "collapse"
    ) {
      return true;
    }
  }

  return false;
}

function getFocusableElements(dialog: HTMLDialogElement): HTMLElement[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>(focusableSelector),
    (element, domIndex) => ({ element, domIndex }),
  )
    .filter(({ element }) => !isUnavailable(element, dialog))
    .sort((left, right) => {
      const leftPositive = left.element.tabIndex > 0;
      const rightPositive = right.element.tabIndex > 0;
      if (leftPositive && rightPositive) {
        return (
          left.element.tabIndex - right.element.tabIndex ||
          left.domIndex - right.domIndex
        );
      }
      if (leftPositive !== rightPositive) {
        return leftPositive ? -1 : 1;
      }
      return left.domIndex - right.domIndex;
    })
    .map(({ element }) => element);
}

function focusWithoutScrolling(element: HTMLElement): void {
  element.focus({ preventScroll: true });
}

export function containDialogFocus(
  event: DialogFocusKeyEvent,
  dialog: HTMLDialogElement,
): void {
  if (
    event.defaultPrevented ||
    event.key !== "Tab" ||
    !dialog.open ||
    dialog.querySelector("dialog[open]")
  ) {
    return;
  }

  const focusableElements = getFocusableElements(dialog);
  const first = focusableElements[0];
  const last = focusableElements.at(-1);
  const activeElement = dialog.ownerDocument.activeElement;
  const activeIndex =
    activeElement instanceof HTMLElement
      ? focusableElements.indexOf(activeElement)
      : -1;

  if (!first || !last) {
    event.preventDefault();
    focusWithoutScrolling(dialog);
    return;
  }

  if (
    activeIndex === -1 ||
    (!event.shiftKey && activeElement === last) ||
    (event.shiftKey && activeElement === first)
  ) {
    event.preventDefault();
    focusWithoutScrolling(event.shiftKey ? last : first);
  }
}
