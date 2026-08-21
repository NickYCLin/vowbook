import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import WorkspaceSectionLoading from "./loading";

describe("WorkspaceSectionLoading", () => {
  it("provides an immediate, accessible fallback while a dynamic tab streams", () => {
    const { container } = render(<WorkspaceSectionLoading />);

    expect(
      screen.getByRole("status", { name: "正在切換工作區頁面" }),
    ).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("正在載入最新資料…")).toBeInTheDocument();
    expect(
      container.querySelectorAll("[data-loading-line]").length,
    ).toBeGreaterThan(2);
  });
});
