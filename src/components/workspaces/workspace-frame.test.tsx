import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WorkspaceFrame } from "./workspace-frame";
import { WorkspacePageHeader } from "./workspace-shell";

afterEach(() => vi.restoreAllMocks());

it("retains a single navigation while the child page loads and restores each route's reading position", async () => {
  let scrollY = 0;
  vi.spyOn(window, "scrollY", "get").mockImplementation(() => scrollY);
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation((options: number | ScrollToOptions) => {
    scrollY = typeof options === "object" ? options.top ?? 0 : 0;
  });
  const view = (section: "guests" | "tables", loading = false) => <WorkspaceFrame workspaceId="w" pathname={`/workspaces/w/${section}`}>
    {loading ? <main data-workspace-loading>正在載入</main> : <main><WorkspacePageHeader workspaceId="w" workspaceName="合成婚宴" sectionTitle={section} description="合成說明" activeSection={section}/></main>}
  </WorkspaceFrame>;
  const { rerender } = render(view("guests"));
  await waitFor(() => expect(scrollTo).toHaveBeenCalled());
  const navigation = screen.getByRole("navigation", { name: "工作區功能" });
  scrollY = 640;
  fireEvent.scroll(window);
  rerender(view("tables", true));
  expect(screen.getByRole("navigation", { name: "工作區功能" })).toBe(navigation);
  expect(within(navigation).getByRole("link", { name: "桌次" })).toHaveAttribute("aria-current", "page");
  rerender(view("tables"));
  await waitFor(() => expect(scrollY).toBe(0));
  rerender(view("guests"));
  await waitFor(() => expect(scrollY).toBe(640));
  expect(screen.getAllByRole("navigation", { name: "工作區功能" })).toHaveLength(1);
});

it("keeps print documents free of the workspace sidebar", () => {
  render(<WorkspaceFrame workspaceId="w" pathname="/workspaces/w/tables/print" embedded><main>列印清單</main></WorkspaceFrame>);
  expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  expect(screen.getByText("列印清單").closest("[data-workspace-preview]")).not.toBeNull();
});
