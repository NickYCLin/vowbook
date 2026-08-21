import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TasksRouteError from "./error";

describe("TasksRouteError", () => {
  it("shows fixed recovery copy and never exposes an unknown runtime error", () => {
    const reset = vi.fn();

    render(
      <TasksRouteError
        error={new Error("postgres://user:secret@database/internal")}
        reset={reset}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "婚宴任務暫時無法開啟" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/postgres:\/\/user:secret/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "再試一次" }));
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByRole("link", { name: "回到我的婚宴" })).toHaveAttribute(
      "href",
      "/dashboard",
    );
  });
});
