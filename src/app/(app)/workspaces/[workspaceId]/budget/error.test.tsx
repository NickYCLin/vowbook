import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BudgetRouteError from "./error";

describe("BudgetRouteError", () => {
  it("shows fixed recovery copy without exposing runtime details", () => {
    const reset = vi.fn();
    render(
      <BudgetRouteError
        error={new Error("postgres://user:secret@database/internal")}
        reset={reset}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "婚禮花費暫時無法開啟" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/postgres:\/\//)).not.toBeInTheDocument();
    expect(screen.queryByText(/database\/internal/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "再試一次" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "回到我的婚宴" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });
});
