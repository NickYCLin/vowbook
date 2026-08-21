export type HorizontalNavigationViewport = {
  scrollLeft: number;
  getBoundingClientRect(): Pick<DOMRect, "left" | "right">;
};

export type HorizontalNavigationItem = {
  getBoundingClientRect(): Pick<DOMRect, "left" | "right">;
};

export function revealActiveWorkspaceNavigationItem(
  navigation: HorizontalNavigationViewport,
  activeItem: HorizontalNavigationItem,
): void {
  const navigationBox = navigation.getBoundingClientRect();
  const activeItemBox = activeItem.getBoundingClientRect();

  if (activeItemBox.left < navigationBox.left) {
    navigation.scrollLeft -= navigationBox.left - activeItemBox.left;
  } else if (activeItemBox.right > navigationBox.right) {
    navigation.scrollLeft += activeItemBox.right - navigationBox.right;
  }
}
