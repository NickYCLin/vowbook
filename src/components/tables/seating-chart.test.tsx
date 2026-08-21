import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { seatingTableNumber } from "@/domain/seating-table";
import { SeatingChart, type SeatingChartTable } from "./seating-chart";

function chartTable(index: number, overrides: Partial<SeatingChartTable> = {}): SeatingChartTable {
  return {
    id: `table_${index}`,
    number: seatingTableNumber(index + 1),
    position: index + 1,
    name: `宴客桌 ${index + 1}`,
    layoutX: null,
    layoutY: null,
    guests: [],
    ...overrides,
  };
}

describe("SeatingChart", () => {
  it("renders the poster title, date and every numbered table", () => {
    render(
      <SeatingChart
        workspaceId="workspace_1"
        workspaceName="我們的婚宴"
        weddingDateLabel="2026年10月10日"
        tables={[
          chartTable(0, {
            name: "主桌",
            guests: [{ side: "PARTNER_A" }, { side: "PARTNER_B" }],
          }),
          chartTable(1, { guests: [{ side: "PARTNER_A" }] }),
          chartTable(2),
        ]}
      />,
    );

    const poster = screen.getByTestId("seating-chart-poster");
    expect(within(poster).getByText("婚宴桌次圖")).toBeInTheDocument();
    expect(
      within(poster).getByRole("heading", { name: "我們的婚宴" }),
    ).toBeInTheDocument();
    expect(within(poster).getByText("2026年10月10日")).toBeInTheDocument();
    expect(within(poster).getByRole("img", { name: "舞台" })).toBeInTheDocument();

    // 混坐的主桌標成共同，單一側的桌子標那一側，空桌不標。
    expect(
      within(poster).getByRole("article", { name: "1 號桌 主桌，共同親友" }),
    ).toHaveTextContent("主桌");
    expect(
      within(poster).getByRole("article", { name: "2 號桌 宴客桌 2，男方親友" }),
    ).toBeInTheDocument();
    expect(
      within(poster).getByRole("article", { name: "3 號桌 宴客桌 3" }),
    ).toBeInTheDocument();

    // 圖例只列出實際出現的側別，共同因主桌混坐而出現，女方沒有整桌就不列。
    expect(within(poster).getByText("男方親友")).toBeInTheDocument();
    expect(within(poster).getByText("共同親友")).toBeInTheDocument();
    expect(within(poster).queryByText("女方親友")).toBeNull();
    expect(within(poster).getByText("共 3 桌")).toBeInTheDocument();
  });

  it("keeps only the table number once the poster gets dense", () => {
    render(
      <SeatingChart
        workspaceId="workspace_1"
        workspaceName="我們的婚宴"
        weddingDateLabel={null}
        tables={Array.from({ length: 40 }, (_, index) =>
          chartTable(index, { guests: [{ side: "PARTNER_A" }] }),
        )}
      />,
    );

    // 40 桌時圓桌只剩 4.5cqw，桌名與側別點都印不下，只留桌號。
    const first = screen.getByRole("article", {
      name: "1 號桌 宴客桌 1，男方親友",
    });
    expect(first).toHaveTextContent(/^1$/u);
    expect(screen.getByText("共 40 桌")).toBeInTheDocument();
  });

  it("points an empty workspace back to the seating planner instead of an empty poster", () => {
    render(
      <SeatingChart
        workspaceId="workspace_1"
        workspaceName="我們的婚宴"
        weddingDateLabel={null}
        tables={[]}
      />,
    );

    expect(screen.getByText("還沒有桌次可以輸出")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "前往桌次安排" }),
    ).toHaveAttribute("href", "/workspaces/workspace_1/tables");
    expect(screen.queryByTestId("seating-chart-poster")).toBeNull();
  });
});
