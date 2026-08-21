import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import MembersError from "./error";

describe("MembersError", () => {
  it("offers a 44px retry and a basePath-safe dashboard link", () => {
    const reset = vi.fn();
    render(<MembersError reset={reset} />);

    const retry = screen.getByRole("button", { name: "重新嘗試" });
    expect(retry).toHaveClass("min-h-11");
    fireEvent.click(retry);
    expect(reset).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("link", { name: "返回我的婚宴" }),
    ).toHaveAttribute("href", "/dashboard");
  });
});
