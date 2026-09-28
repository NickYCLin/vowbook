import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { RECENT_WORKSPACE_COOKIE } from "@/domain/workspace-entry";
const navigation = vi.hoisted(() => ({ pathname: "/workspaces/a/overview" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));
import { WorkspaceSwitcher } from "./workspace-switcher";
const choices = [{ id: "a", name: "婚宴甲", role: "OWNER" }, { id: "b", name: "婚宴乙", role: "PLANNER" }];
beforeEach(() => { navigation.pathname = "/workspaces/a/overview"; document.cookie = `${RECENT_WORKSPACE_COOKIE}=; Max-Age=0; Path=/`; });

it("remembers only an accessible workspace and offers each wedding home", () => {
  render(<WorkspaceSwitcher userId="u" choices={choices}/>);
  expect(decodeURIComponent(document.cookie)).toContain('"workspaceId":"a"');
  fireEvent.click(screen.getByText("婚宴甲", { selector: "summary span" }));
  expect(screen.getByRole("link", { name: /婚宴乙.*婚顧/ })).toHaveAttribute("href", "/workspaces/b/overview");
  fireEvent.keyDown(document.querySelector("details")!, { key: "Escape" });
  expect(document.querySelector("details")).not.toHaveAttribute("open");
  expect(document.querySelector("summary")).toHaveFocus();
});
it("does not remember an inaccessible route or a print preview", () => {
  navigation.pathname = "/workspaces/foreign/overview";
  const { rerender } = render(<WorkspaceSwitcher userId="u" choices={choices}/>);
  expect(document.cookie).not.toContain(RECENT_WORKSPACE_COOKIE);
  navigation.pathname = "/workspaces/a/tables/print";
  rerender(<WorkspaceSwitcher userId="u" choices={choices}/>);
  expect(document.cookie).not.toContain(RECENT_WORKSPACE_COOKIE);
});
it("omits a one-choice picker while keeping all weddings reachable", () => {
  render(<WorkspaceSwitcher userId="u" choices={choices.slice(0, 1)}/>);
  expect(document.querySelector("details")).toBeNull();
  expect(screen.getByRole("link", { name: "所有婚宴" })).toHaveAttribute("href", "/dashboard?view=all");
});
