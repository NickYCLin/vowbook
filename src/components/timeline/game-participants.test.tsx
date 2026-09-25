import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/actions/wedding-games", () => ({
  addWeddingGameParticipantsAction: vi.fn(),
  updateWeddingGameParticipantAction: vi.fn(),
  deleteWeddingGameParticipantAction: vi.fn(),
}));

import { WeddingGameParticipantLists } from "./game-participants";

const games = {
  BOUQUET: [
    { id: "p1", name: "小美", note: "大學室友", version: 0 },
    { id: "p2", name: "小安", note: null, version: 3 },
  ],
  BROCCOLI: [],
};

describe("WeddingGameParticipantLists", () => {
  it("shows both games with numbered names, notes and editor controls", () => {
    render(
      <WeddingGameParticipantLists workspaceId="workspace_1" games={games} canEdit />,
    );
    const bouquet = screen.getByRole("article", { name: "新娘捧花遊戲" });
    expect(within(bouquet).getByText("2 位")).toBeInTheDocument();
    const rows = within(
      within(bouquet).getByRole("list", { name: "新娘捧花遊戲名單" }),
    ).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      "1小美「大學室友」",
      "2小安",
    ]);
    expect(within(bouquet).getByRole("button", { name: "編輯 小美" })).toBeInTheDocument();
    expect(within(bouquet).getByRole("button", { name: "移除 小安" })).toBeInTheDocument();
    expect(
      within(bouquet).getByRole("textbox", { name: "新娘捧花遊戲姓名" }),
    ).toBeInTheDocument();

    const broccoli = screen.getByRole("article", { name: "新郎花椰菜遊戲" });
    expect(within(broccoli).getByText("0 位")).toBeInTheDocument();
    expect(within(broccoli).getByText("尚未填寫名單")).toBeInTheDocument();
    expect(
      within(broccoli).getByRole("form", { name: "新增新郎花椰菜遊戲名單" }),
    ).toBeInTheDocument();
  });

  it("is read-only for members who cannot edit", () => {
    render(
      <WeddingGameParticipantLists
        workspaceId="workspace_1"
        games={games}
        canEdit={false}
      />,
    );
    expect(screen.getByText("小美")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("switches a row into inline edit and back", () => {
    render(
      <WeddingGameParticipantLists workspaceId="workspace_1" games={games} canEdit />,
    );
    fireEvent.click(screen.getByRole("button", { name: "編輯 小美" }));
    const editor = screen.getByRole("form", { name: "編輯 小美" });
    expect(within(editor).getByRole("textbox", { name: "姓名" })).toHaveValue("小美");
    expect(within(editor).getByRole("textbox", { name: "介紹詞" })).toHaveValue("大學室友");
    fireEvent.click(within(editor).getByRole("button", { name: "取消編輯" }));
    expect(screen.queryByRole("form", { name: "編輯 小美" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "編輯 小美" })).toBeInTheDocument();
  });
});
