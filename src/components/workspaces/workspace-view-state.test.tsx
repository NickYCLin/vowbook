import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { WorkspaceViewStateProvider, useWorkspaceViewState } from "./workspace-view-state";

function Search({ workspaceId = "a" }: { workspaceId?: string }) {
  const [value, setValue] = useWorkspaceViewState(`${workspaceId}:guests:search`, "");
  return <input aria-label="搜尋" value={value} onChange={e => setValue(e.target.value)} />;
}

it("restores presentation state after the page unmounts, but clears it when the workspace layout changes", () => {
  const view = (page: boolean, workspaceId = "a") => <WorkspaceViewStateProvider key={workspaceId}>{page ? <Search workspaceId={workspaceId} /> : <p>桌次頁</p>}</WorkspaceViewStateProvider>;
  const { rerender } = render(view(true));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "合成親友" } });
  rerender(view(false));
  rerender(view(true));
  expect(screen.getByRole("textbox")).toHaveValue("合成親友");
  rerender(view(true, "b"));
  expect(screen.getByRole("textbox")).toHaveValue("");
  rerender(view(true, "a"));
  expect(screen.getByRole("textbox")).toHaveValue("");
});

it("keeps isolated component renders usable without a layout provider", () => {
  render(<Search />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "測試" } });
  expect(screen.getByRole("textbox")).toHaveValue("測試");
});
