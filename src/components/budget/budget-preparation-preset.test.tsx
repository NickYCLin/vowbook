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
  addBudgetPreparationSuggestionsAction: vi.fn(),
}));

vi.mock("@/actions/budget-items", () => actions);
vi.mock("@/domain/budget-preparation-preset", () => ({
  BUDGET_PREPARATION_PRESET_STAGES: [
    {
      stageKey: "STAGE_PREPARATION_1_2_MONTHS",
      label: "籌備第1-2月",
      groups: [
        {
          taxonomyItemKey: "ITEM_PROPOSAL",
          label: "求婚",
          items: [
            {
              key: "PREPARATION_PROPOSAL_FAMILY_MEAL",
              name: "兩家人見面餐費",
            },
            {
              key: "PREPARATION_PROPOSAL_WEDDING_RINGS",
              name: "婚戒（求婚戒與對戒）",
              notes: "依實際選購內容調整。",
            },
          ],
        },
        {
          taxonomyItemKey: "ITEM_WEDDING_VENUE",
          label: "婚宴場地",
          items: [
            {
              key: "PREPARATION_VENUE_BANQUET_TABLES_SITE",
              name: "婚宴桌席／場地費",
            },
          ],
        },
      ],
    },
    {
      stageKey: "STAGE_WEDDING_PROCESSION",
      label: "迎娶儀式用品、工作人員紅包",
      optional: true,
      groups: [
        {
          taxonomyItemKey: "ITEM_PROCESSION_GROOM",
          label: "迎娶儀式男方準備",
          items: [
            {
              key: "PREPARATION_PROCESSION_GROOM_ESCORT_GIFT",
              name: "陪娶禮",
            },
          ],
        },
      ],
    },
  ],
}));

import { BudgetPreparationPreset } from "./budget-preparation-preset";

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

describe("BudgetPreparationPreset", () => {
  it("groups suggestions by Drive stage and taxonomy with select-all and clear controls", () => {
    const { container } = render(
      <BudgetPreparationPreset
        workspaceId="workspace_internal"
        existingSuggestionKeys={new Set(["PREPARATION_VENUE_BANQUET_TABLES_SITE"])}
        coveredSuggestionKeys={
          new Set(["PREPARATION_PROPOSAL_FAMILY_MEAL"])
        }
        showProcessionCeremony
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "補齊常見婚禮項目",
    });
    expect(trigger).toHaveClass("min-h-11");
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", {
      name: "補齊常見婚禮項目",
    }) as HTMLDialogElement;
    expect(dialog).toHaveAttribute("open");
    expect(dialog).toHaveClass(
      "max-h-[calc(100dvh-2rem)]",
      "w-[calc(100%-2rem)]",
      "overflow-x-hidden",
      "overflow-y-auto",
    );
    expect(dialog).toHaveAccessibleDescription(
      "依 Drive 籌備階段列出常見項目；勾選後可分別標示需要安排、已有自備或不打算準備。已明確選擇有迎娶儀式，因此一併提供迎娶項目。",
    );
    expect(
      screen.getByRole("heading", { name: "補齊常見婚禮項目" }),
    ).toHaveFocus();

    const preparationStage = screen.getByRole("group", {
      name: "籌備第1-2月",
    });
    expect(
      within(preparationStage).getByRole("group", { name: "求婚" }),
    ).toBeVisible();
    expect(
      within(preparationStage).getByRole("group", { name: "婚宴場地" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("group", {
        name: "迎娶儀式用品、工作人員紅包",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "有迎娶流程？加入迎娶項目" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.getByText(
        "沒有中式迎娶流程時不需要加入；西式證婚不等於迎娶，不會自動帶入這些項目。展開後再挑選實際會用到的項目。",
      ),
    ).toBeVisible();
    expect(container).not.toHaveTextContent("文定");
    expect(container).not.toHaveTextContent("提親");
    expect(container).toHaveTextContent("婚戒（求婚戒與對戒）");

    const existing = screen.getByRole("checkbox", { name: /婚宴桌席／場地費/u });
    expect(existing).toBeDisabled();
    expect(
      within(existing.closest("label")!).getByText("已加入", { exact: true }),
    ).toBeVisible();
    const covered = screen.getByRole("checkbox", {
      name: /兩家人見面餐費/u,
    });
    expect(covered).toBeDisabled();
    expect(
      within(covered.closest("label")!).getByText("已有相關紀錄", {
        exact: true,
      }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "全選一般項目" }),
    );
    expect(screen.getByText("已選 1 個項目")).toBeVisible();
    expect(existing).not.toBeChecked();
    expect(covered).not.toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: /婚戒/u }),
    ).toBeChecked();
    expect(
      screen.getByRole("combobox", { name: "婚戒（求婚戒與對戒）的準備方式" }),
    ).toHaveValue("NEEDS_ACTION");
    expect(screen.queryByRole("checkbox", { name: /陪娶禮/u })).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "有迎娶流程？加入迎娶項目" }),
    );
    expect(
      screen.getByRole("group", {
        name: "迎娶儀式用品、工作人員紅包",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("checkbox", { name: /陪娶禮/u }),
    ).not.toBeChecked();

    fireEvent.click(screen.getByRole("button", { name: "清除選取" }));
    expect(screen.getByText("已選 0 個項目")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "加入選取的常見項目" }),
    ).toBeDisabled();
    expect(container).not.toHaveTextContent("workspace_internal");

    fireEvent.click(screen.getByRole("button", { name: "取消補齊常見項目" }));
    expect(dialog).not.toHaveAttribute("open");
    expect(trigger).toHaveFocus();
  });

  it("submits only selected keys with independent preparation decisions and reports success", async () => {
    actions.addBudgetPreparationSuggestionsAction.mockResolvedValueOnce({
      status: "success",
      message: "已記錄 2 筆常見婚禮項目。",
    });
    const onSuccess = vi.fn();
    render(
      <BudgetPreparationPreset
        workspaceId="workspace_internal"
        existingSuggestionKeys={new Set()}
        showProcessionCeremony
        onSuccess={onSuccess}
      />,
    );

    const trigger = screen.getByRole("button", {
      name: "補齊常見婚禮項目",
    });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("checkbox", { name: /婚戒/u }));
    fireEvent.change(
      screen.getByRole("combobox", {
        name: "婚戒（求婚戒與對戒）的準備方式",
      }),
      { target: { value: "ALREADY_OWNED" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "有迎娶流程？加入迎娶項目" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /陪娶禮/u }),
    );
    fireEvent.change(
      screen.getByRole("combobox", { name: "陪娶禮的準備方式" }),
      { target: { value: "NOT_PLANNED" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "加入 2 個常見項目" }),
    );

    await waitFor(() => {
      expect(actions.addBudgetPreparationSuggestionsAction).toHaveBeenCalledOnce();
    });
    expect(
      actions.addBudgetPreparationSuggestionsAction.mock.calls[0].slice(0, 2),
    ).toEqual(["workspace_internal", { status: "idle" }]);
    const formData = actions.addBudgetPreparationSuggestionsAction.mock
      .calls[0][2] as FormData;
    expect(formData.getAll("suggestionKey")).toEqual([
      "PREPARATION_PROPOSAL_WEDDING_RINGS",
      "PREPARATION_PROCESSION_GROOM_ESCORT_GIFT",
    ]);
    expect(
      formData.get(
        "preparationStatus:PREPARATION_PROPOSAL_WEDDING_RINGS",
      ),
    ).toBe("ALREADY_OWNED");
    expect(
      formData.get(
        "preparationStatus:PREPARATION_PROCESSION_GROOM_ESCORT_GIFT",
      ),
    ).toBe("NOT_PLANNED");
    expect(formData.get("workspaceId")).toBeNull();
    expect(formData.get("parentId")).toBeNull();

    await waitFor(() => {
      expect(document.querySelector("dialog")).not.toHaveAttribute("open");
    });
    expect(onSuccess).toHaveBeenCalledWith("已記錄 2 筆常見婚禮項目。");
    expect(trigger).toHaveFocus();
  });

  it("keeps an error and the submitted selection inside the open dialog", async () => {
    actions.addBudgetPreparationSuggestionsAction.mockResolvedValueOnce({
      status: "error",
      code: "UNAVAILABLE",
      message: "目前無法記錄常見婚禮項目，請稍後再試。",
    });
    render(
      <BudgetPreparationPreset
        workspaceId="workspace_internal"
        existingSuggestionKeys={new Set()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "補齊常見婚禮項目" }),
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /婚戒/u }));
    fireEvent.change(
      screen.getByRole("combobox", {
        name: "婚戒（求婚戒與對戒）的準備方式",
      }),
      { target: { value: "ALREADY_OWNED" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "加入 1 個常見項目" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "目前無法記錄常見婚禮項目，請稍後再試。",
    );
    expect(
      screen.getByRole("dialog", { name: "補齊常見婚禮項目" }),
    ).toHaveAttribute("open");
    await waitFor(() => {
      expect(screen.getByRole("checkbox", { name: /婚戒/u })).toBeChecked();
    });
  });

  it("does not expose procession suggestions without a configured procession ceremony", () => {
    render(
      <BudgetPreparationPreset
        workspaceId="workspace_internal"
        existingSuggestionKeys={new Set()}
        showProcessionCeremony={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "補齊常見婚禮項目" }));
    expect(
      screen.getByRole("dialog", { name: "補齊常見婚禮項目" }),
    ).toHaveAccessibleDescription(
      "依 Drive 籌備階段列出常見項目；勾選後可分別標示需要安排、已有自備或不打算準備。此清單目前只包含一般婚禮項目。",
    );
    expect(
      screen.queryByRole("button", { name: "有迎娶流程？加入迎娶項目" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("陪娶禮")).not.toBeInTheDocument();
  });

  it("does not render after every suggestion is already added or covered", () => {
    const { container } = render(
      <BudgetPreparationPreset
        workspaceId="workspace_internal"
        existingSuggestionKeys={
          new Set([
            "PREPARATION_PROPOSAL_FAMILY_MEAL",
            "PREPARATION_PROPOSAL_WEDDING_RINGS",
          ])
        }
        coveredSuggestionKeys={
          new Set([
            "PREPARATION_VENUE_BANQUET_TABLES_SITE",
            "PREPARATION_PROCESSION_GROOM_ESCORT_GIFT",
          ])
        }
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
