import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/actions/wedding-speeches", () => ({
  saveWeddingSpeechAction: vi.fn(),
}));

import { WeddingSpeechCards } from "./wedding-speeches";

const speeches = {
  GROOM_PARENTS: { content: "爸、媽\n謝謝你們", version: 2 },
  BRIDE_PARENTS: null,
};

describe("WeddingSpeechCards", () => {
  it("shows the saved speech with reading time and an empty card for the other side", () => {
    render(<WeddingSpeechCards workspaceId="w" speeches={speeches} canEdit />);
    const groom = screen.getByRole("article", { name: "新郎謝親恩" });
    expect(within(groom).getByText(/爸、媽/)).toBeInTheDocument();
    expect(within(groom).getByText("約 5 秒")).toBeInTheDocument();
    const bride = screen.getByRole("article", { name: "新娘謝親恩" });
    expect(within(bride).getByText("尚未撰寫")).toBeInTheDocument();
    expect(within(bride).queryByRole("button", { name: "新娘謝親恩提詞模式" })).toBeNull();
  });

  it("fills the starter draft into an empty editor and flags placeholders", () => {
    render(<WeddingSpeechCards workspaceId="w" speeches={speeches} canEdit />);
    const bride = screen.getByRole("article", { name: "新娘謝親恩" });
    fireEvent.click(within(bride).getByRole("button", { name: "開始寫" }));
    const editor = within(bride).getByRole("form", { name: "編輯新娘謝親恩" });
    const textarea = within(editor).getByRole("textbox", { name: "新娘謝親恩內容" });
    expect(textarea).toHaveValue("");
    fireEvent.click(within(editor).getByRole("button", { name: "帶入草稿" }));
    expect((textarea as HTMLTextAreaElement).value).toContain("爸、媽，今天我要嫁人了。");
    expect(within(editor).getByText("還有【】要換成你們自己的內容")).toBeInTheDocument();
    expect(
      editor.querySelector<HTMLInputElement>('input[name="expectedVersion"]')?.value,
    ).toBe("");
  });

  it("opens a full-screen prompter that closes with Escape", () => {
    render(<WeddingSpeechCards workspaceId="w" speeches={speeches} canEdit={false} />);
    expect(screen.queryByRole("button", { name: "編輯新郎謝親恩" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "新郎謝親恩提詞模式" }));
    const prompter = screen.getByRole("dialog", { name: "新郎謝親恩提詞" });
    expect(within(prompter).getByText("謝謝你們")).toBeInTheDocument();
    fireEvent.click(within(prompter).getByRole("button", { name: "字放大" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
