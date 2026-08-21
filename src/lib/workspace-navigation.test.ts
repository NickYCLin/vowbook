import { describe, expect, it, vi } from "vitest";
import { revealActiveWorkspaceNavigationItem } from "./workspace-navigation";

function element(left: number, right: number) {
  return {
    getBoundingClientRect: vi.fn(
      () => ({ left, right }) as DOMRect,
    ),
  };
}

describe("revealActiveWorkspaceNavigationItem", () => {
  it("moves only the horizontal distance needed to reveal the active item", () => {
    const navigation = {
      ...element(0, 300),
      scrollLeft: 40,
    };

    revealActiveWorkspaceNavigationItem(
      navigation,
      element(420, 510),
    );
    expect(navigation.scrollLeft).toBe(250);

    revealActiveWorkspaceNavigationItem(
      navigation,
      element(-25, 65),
    );
    expect(navigation.scrollLeft).toBe(225);
  });

  it("does nothing when the active item is already visible", () => {
    const navigation = {
      ...element(0, 300),
      scrollLeft: 75,
    };

    revealActiveWorkspaceNavigationItem(
      navigation,
      element(50, 250),
    );
    expect(navigation.scrollLeft).toBe(75);
  });
});
