import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const actions = vi.hoisted(() => ({
  addBudgetEngagementSuggestionsAction: vi.fn(),
}));

vi.mock("@/actions/budget-items", () => actions);
vi.mock("@/domain/budget-engagement-preset", () => ({
  BUDGET_ENGAGEMENT_PRESET_GROUPS: [
    {
      taxonomyItemKey: "ITEM_ENGAGEMENT_GROOM",
      label: "男方準備",
      items: [
        {
          key: "ENGAGEMENT_GROOM_RED_ENVELOPE",
          name: "男方工作人員紅包",
          notes: "可依實際人數調整。",
        },
        {
          key: "ENGAGEMENT_GROOM_GIFT",
          name: "男方文定禮品",
        },
      ],
    },
    {
      taxonomyItemKey: "ITEM_ENGAGEMENT_BRIDE",
      label: "女方準備",
      items: [
        {
          key: "ENGAGEMENT_BRIDE_TEA_SET",
          name: "奉茶用品",
          notes: "包含茶具與甜茶用品。",
        },
      ],
    },
  ],
}));

import { BudgetEngagementPreset } from "./budget-engagement-preset";

const showModalDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "showModal",
);
const closeDescriptor = Object.getOwnPropertyDescriptor(
  HTMLDialogElement.prototype,
  "close",
);

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      if (!this.open) this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      if (!this.open) return;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    },
  });
});

afterAll(() => {
  if (showModalDescriptor) {
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "showModal",
      showModalDescriptor,
    );
  } else {
    Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  }
  if (closeDescriptor) {
    Object.defineProperty(
      HTMLDialogElement.prototype,
      "close",
      closeDescriptor,
    );
  } else {
    Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
  }
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("BudgetEngagementPreset", () => {
  it("opens an accessible unchecked preset dialog and marks existing suggestions", () => {
    const { container } = render(
      <BudgetEngagementPreset
        workspaceId="workspace_internal"
        existingSuggestionKeys={new Set(["ENGAGEMENT_GROOM_RED_ENVELOPE"])}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "加入更多文定項目",
    });
    expect(trigger).toHaveClass("min-h-11");
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", {
      name: "加入文定建議品項",
    }) as HTMLDialogElement;
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveClass(
      "max-h-[calc(100dvh-2rem)]",
      "w-[calc(100%-2rem)]",
      "overflow-x-hidden",
      "overflow-y-auto",
    );
    expect(dialog).toHaveAccessibleDescription(
      "只會加入勾選的品項；加入後金額為 NT$0、狀態為規劃中，之後可再編輯。",
    );
    expect(
      screen.getByRole("heading", { name: "加入文定建議品項" }),
    ).toHaveFocus();
    expect(screen.getByRole("group", { name: "男方準備" })).toBeVisible();
    expect(screen.getByRole("group", { name: "女方準備" })).toBeVisible();

    const existing = screen.getByRole("checkbox", {
      name: /男方工作人員紅包/u,
    });
    expect(existing).toBeDisabled();
    expect(existing).not.toBeChecked();
    expect(
      within(existing.closest("label")!).getByText("已加入", { exact: true }),
    ).toBeVisible();

    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect(checkbox).not.toBeChecked();
      expect(checkbox.closest("label")).toHaveClass("min-h-11");
    }
    expect(screen.getByText("已選 0 個品項")).toHaveAttribute("role", "status");
    expect(
      screen.getByRole("button", { name: "加入選取的文定品項" }),
    ).toBeDisabled();
    expect(container).not.toHaveTextContent("workspace_internal");

    fireEvent.click(
      screen.getByRole("button", { name: "取消加入文定品項" }),
    );
    expect(dialog).not.toHaveAttribute("open");
    expect(trigger).toHaveFocus();
  });

  it("submits only selected suggestionKey values, closes, reports success, and restores focus", async () => {
    actions.addBudgetEngagementSuggestionsAction.mockResolvedValueOnce({
      status: "success",
      message: "已加入 2 個文定品項。",
    });
    const onSuccess = vi.fn();
    render(
      <BudgetEngagementPreset
        workspaceId="workspace_internal"
        existingSuggestionKeys={new Set()}
        onSuccess={onSuccess}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "加入文定儀式項目",
    });
    fireEvent.click(trigger);
    fireEvent.click(
      screen.getByRole("checkbox", { name: /男方文定禮品/u }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /奉茶用品/u }));
    expect(screen.getByText("已選 2 個品項")).toBeVisible();

    const submit = screen.getByRole("button", {
      name: "加入 2 個文定品項",
    });
    fireEvent.click(submit);

    await waitFor(() => {
      expect(actions.addBudgetEngagementSuggestionsAction).toHaveBeenCalledOnce();
    });
    expect(
      actions.addBudgetEngagementSuggestionsAction.mock.calls[0].slice(0, 2),
    ).toEqual(["workspace_internal", { status: "idle" }]);
    const formData = actions.addBudgetEngagementSuggestionsAction.mock
      .calls[0][2] as FormData;
    expect(formData.getAll("suggestionKey")).toEqual([
      "ENGAGEMENT_GROOM_GIFT",
      "ENGAGEMENT_BRIDE_TEA_SET",
    ]);
    expect(formData.get("workspaceId")).toBeNull();
    expect(formData.get("parentId")).toBeNull();

    await waitFor(() => {
      expect(document.querySelector("dialog")).not.toHaveAttribute("open");
    });
    expect(onSuccess).toHaveBeenCalledWith("已加入 2 個文定品項。");
    expect(trigger).toHaveFocus();
  });

  it("keeps an error inside the open dialog and preserves the selection", async () => {
    actions.addBudgetEngagementSuggestionsAction.mockResolvedValueOnce({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法加入文定品項，請稍後再試。",
    });
    render(
      <BudgetEngagementPreset
        workspaceId="workspace_internal"
        existingSuggestionKeys={new Set()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "加入文定儀式項目" }),
    );
    const selected = screen.getByRole("checkbox", { name: /奉茶用品/u });
    fireEvent.click(selected);
    fireEvent.click(
      screen.getByRole("button", { name: "加入 1 個文定品項" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "目前無法加入文定品項，請稍後再試。",
    );
    expect(
      screen.getByRole("dialog", { name: "加入文定建議品項" }),
    ).toHaveAttribute("open");
    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: /奉茶用品/u }),
      ).toBeChecked();
    });
  });

  it("locks the dialog while pending and prevents duplicate submission", async () => {
    let resolveAction:
      | ((value: { status: "success"; message: string }) => void)
      | undefined;
    actions.addBudgetEngagementSuggestionsAction.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAction = resolve;
        }),
    );
    render(
      <BudgetEngagementPreset
        workspaceId="workspace_internal"
        existingSuggestionKeys={new Set()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "加入文定儀式項目" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /男方文定禮品/u }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "加入 1 個文定品項" }),
    );

    const fieldset = await screen.findByRole("group", { name: "建議品項" });
    expect(fieldset).toBeDisabled();
    expect(fieldset).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "加入中…" })).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "取消加入文定品項" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "加入中…" }));
    expect(actions.addBudgetEngagementSuggestionsAction).toHaveBeenCalledOnce();

    resolveAction?.({
      status: "success",
      message: "已加入 1 個文定品項。",
    });
    await waitFor(() => {
      expect(document.querySelector("dialog")).not.toHaveAttribute("open");
    });
  });

  it("does not render a trigger after every suggestion has been added", () => {
    const { container } = render(
      <BudgetEngagementPreset
        workspaceId="workspace_internal"
        existingSuggestionKeys={
          new Set([
            "ENGAGEMENT_GROOM_RED_ENVELOPE",
            "ENGAGEMENT_GROOM_GIFT",
            "ENGAGEMENT_BRIDE_TEA_SET",
          ])
        }
      />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(
      screen.queryByRole("button", { name: /文定/u }),
    ).not.toBeInTheDocument();
  });
});
