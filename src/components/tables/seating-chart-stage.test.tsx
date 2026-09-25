import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SeatingChartStage } from "./seating-chart-stage";

describe("SeatingChartStage", () => {
  it("opens the chart full screen and closes it again", async () => {
    render(
      <SeatingChartStage>
        <div data-testid="seating-chart-poster" />
      </SeatingChartStage>,
    );

    const stage = screen.getByTestId("seating-chart-stage");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "全螢幕顯示桌圖" }));
    });
    expect(stage).not.toHaveAttribute("data-fullscreen", "off");
    expect(stage.className).toContain("fixed");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "離開全螢幕" }));
    });
    expect(stage).toHaveAttribute("data-fullscreen", "off");
    expect(stage.className).not.toContain("fixed");
  });
});
