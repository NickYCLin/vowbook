import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { updateAction } = vi.hoisted(() => ({ updateAction: vi.fn() }));

vi.mock("@/actions/wedding-planning-preferences", () => ({
  updateWeddingPlanningPreferencesAction: updateAction,
}));

import { BudgetCeremonyPreferences } from "./budget-ceremony-preferences";

describe("BudgetCeremonyPreferences", () => {
  it("keeps Chinese ceremonies opt-in and explains western ceremonies separately", () => {
    render(
      <BudgetCeremonyPreferences
        workspaceId="workspace_1"
        preferences={{
          hasEngagementCeremony: false,
          hasProcessionCeremony: false,
          version: 0,
        }}
      />,
    );

    expect(
      screen.getByText("中式儀式設定（選用）"),
    ).toBeInTheDocument();
    expect(screen.queryByText("迎娶儀式用品、工作人員紅包")).toBeNull();
    fireEvent.click(screen.getByText("中式儀式設定（選用）"));
    expect(screen.getByRole("checkbox", { name: "有文定儀式" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "有迎娶儀式" })).not.toBeChecked();
    expect(screen.getByText(/西式證婚不等於迎娶/u)).toBeInTheDocument();
    expect(screen.getByDisplayValue("0")).toHaveAttribute(
      "name",
      "expectedVersion",
    );
  });

  it("submits route-bound settings and publishes the returned snapshot", async () => {
    const onChange = vi.fn();
    updateAction.mockResolvedValueOnce({
      status: "success",
      message: "已更新中式儀式設定。",
      preferences: {
        hasEngagementCeremony: false,
        hasProcessionCeremony: true,
        version: 5,
      },
    });
    const { rerender } = render(
      <BudgetCeremonyPreferences
        workspaceId="workspace_1"
        preferences={{
          hasEngagementCeremony: false,
          hasProcessionCeremony: false,
          version: 4,
        }}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByText("中式儀式設定（選用）"));
    fireEvent.click(screen.getByRole("checkbox", { name: "有迎娶儀式" }));
    fireEvent.click(screen.getByRole("button", { name: "儲存中式儀式設定" }));

    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        hasEngagementCeremony: false,
        hasProcessionCeremony: true,
        version: 5,
      }),
    );
    expect(updateAction).toHaveBeenCalledWith(
      "workspace_1",
      expect.anything(),
      expect.any(FormData),
    );
    expect(screen.getByDisplayValue("5")).toHaveAttribute(
      "name",
      "expectedVersion",
    );

    rerender(
      <BudgetCeremonyPreferences
        workspaceId="workspace_1"
        preferences={{
          hasEngagementCeremony: false,
          hasProcessionCeremony: false,
          version: 4,
        }}
        onChange={onChange}
      />,
    );
    expect(screen.getByDisplayValue("5")).toHaveAttribute(
      "name",
      "expectedVersion",
    );
    expect(screen.queryByText(/協作者已更新/u)).toBeNull();
  });

  it("keeps a draft with its frozen CAS version until the user loads a collaborator update", () => {
    const { rerender } = render(
      <BudgetCeremonyPreferences
        workspaceId="workspace_1"
        preferences={{
          hasEngagementCeremony: false,
          hasProcessionCeremony: false,
          version: 4,
        }}
      />,
    );
    fireEvent.click(screen.getByText("中式儀式設定（選用）"));
    fireEvent.click(screen.getByRole("checkbox", { name: "有文定儀式" }));

    rerender(
      <BudgetCeremonyPreferences
        workspaceId="workspace_1"
        preferences={{
          hasEngagementCeremony: false,
          hasProcessionCeremony: true,
          version: 5,
        }}
      />,
    );

    expect(screen.getByRole("checkbox", { name: "有文定儀式" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "有迎娶儀式" })).not.toBeChecked();
    expect(screen.getByDisplayValue("4")).toHaveAttribute(
      "name",
      "expectedVersion",
    );
    expect(screen.getByText(/協作者已更新/u)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "儲存中式儀式設定" }),
    ).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "載入最新設定" }));
    expect(screen.getByRole("checkbox", { name: "有文定儀式" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "有迎娶儀式" })).toBeChecked();
    expect(screen.getByDisplayValue("5")).toHaveAttribute(
      "name",
      "expectedVersion",
    );
    expect(
      screen.getByRole("button", { name: "儲存中式儀式設定" }),
    ).toBeEnabled();
  });
});
