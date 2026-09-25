import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LinkifiedText } from "./linkified-text";

describe("LinkifiedText", () => {
  it("turns URLs into links and keeps surrounding text", () => {
    const { container } = render(
      <p>
        <LinkifiedText text="手機（分貝機網頁 https://example.com/meter/）備好" />
      </p>,
    );
    const link = screen.getByRole("link", { name: "https://example.com/meter/" });
    expect(link).toHaveAttribute("href", "https://example.com/meter/");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(container.textContent).toBe("手機（分貝機網頁 https://example.com/meter/）備好");
  });

  it("leaves plain text alone", () => {
    const { container } = render(<LinkifiedText text="沒有網址" />);
    expect(container.querySelector("a")).toBeNull();
  });
});
