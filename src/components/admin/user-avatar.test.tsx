import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UserAvatar } from "./user-avatar";

describe("管理頁頭貼", () => {
  it("優先顯示自訂頭貼，失敗時依序回退帳號圖片與姓名縮寫", () => {
    render(<UserAvatar userId="user_test" name="測試帳號" image="https://lh3.googleusercontent.com/a/test" avatarUpdatedAt="2026-11-07T00:00:00.000Z" />);
    expect(screen.getByRole("img")).toHaveAttribute("src", expect.stringContaining("/api/admin/users/user_test/avatar?v="));
    fireEvent.error(screen.getByRole("img"));
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://lh3.googleusercontent.com/a/test");
    fireEvent.error(screen.getByRole("img"));
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByLabelText("測試帳號的頭貼")).toHaveTextContent("測");
  });

  it("沒有圖片時顯示預設縮寫，更新圖片後可重新載入", () => {
    const { rerender } = render(<UserAvatar userId="user_test" name={null} image={null} />);
    expect(screen.getByLabelText("使用者的頭貼")).toHaveTextContent("使");
    rerender(<UserAvatar userId="user_test" name={null} image={null} avatarUpdatedAt="new" />);
    expect(screen.getByRole("img")).toHaveAttribute("referrerpolicy", "no-referrer");
  });
});
