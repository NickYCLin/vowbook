import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Field, Input, Select, Textarea } from "./field";

describe("Field", () => {
  it("associates its hint with an input while preserving a datalist sibling", () => {
    render(
      <Field htmlFor="role" label="職務" hint="可從常見職務挑選。">
        <Input id="role" list="role-options" />
        <datalist id="role-options">
          <option value="主持人" />
        </datalist>
      </Field>,
    );

    const input = screen.getByRole("combobox", { name: "職務" });
    expect(input).toHaveAttribute("aria-describedby", "role-hint");
    expect(input).toHaveAccessibleDescription("可從常見職務挑選。");
    expect(document.querySelector("datalist#role-options")).toBeInTheDocument();
  });

  it("associates an error with a select and exposes its invalid state", () => {
    render(
      <Field
        htmlFor="status"
        label="狀態"
        hint="請選擇目前狀態。"
        error="狀態不可空白。"
      >
        <Select id="status" aria-invalid="false">
          <option value="">請選擇</option>
        </Select>
      </Field>,
    );

    const select = screen.getByRole("combobox", { name: "狀態" });
    expect(select).toHaveAttribute("aria-invalid", "true");
    expect(select).toHaveAttribute("aria-describedby", "status-error");
    expect(select).toHaveAccessibleDescription("狀態不可空白。");
    expect(screen.queryByText("請選擇目前狀態。")).not.toBeInTheDocument();
  });

  it("merges and deduplicates an explicit description with its generated hint", () => {
    render(
      <>
        <p id="format-help">每行一筆。</p>
        <Field htmlFor="notes" label="備註" hint="最多 500 個字元。">
          <Textarea
            id="notes"
            aria-describedby="format-help notes-hint format-help"
          />
        </Field>
      </>,
    );

    const textarea = screen.getByRole("textbox", { name: "備註" });
    expect(textarea).toHaveAttribute(
      "aria-describedby",
      "format-help notes-hint",
    );
    expect(textarea).toHaveAccessibleDescription(
      "每行一筆。 最多 500 個字元。",
    );
  });
});
