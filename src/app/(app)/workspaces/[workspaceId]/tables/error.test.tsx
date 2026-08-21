import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TablesRouteError from "./error";

describe("TablesRouteError", () => {
  it("shows fixed safe recovery copy without exposing unknown errors", () => {
    const reset = vi.fn();
    render(
      <TablesRouteError
        error={new Error("postgres://user:secret@database/internal")}
        reset={reset}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "桌次安排暫時無法開啟" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/postgres:\/\/user:secret/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "再試一次" }));
    expect(reset).toHaveBeenCalledOnce();
  });
});
