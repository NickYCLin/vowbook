import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Wordmark } from "./wordmark";

describe("Wordmark", () => {
  it("provides a 44px navigation target while preserving a custom destination", () => {
    render(<Wordmark href="/dashboard" />);

    expect(
      screen.getByRole("link", { name: "誓約簿 VowBook 我的婚宴" }),
    ).toHaveClass("min-h-11");
    expect(
      screen.getByRole("link", { name: "誓約簿 VowBook 我的婚宴" }),
    ).toHaveAttribute("href", "/dashboard");
  });

  it("keeps the public default labeled as the homepage", () => {
    render(<Wordmark />);

    expect(
      screen.getByRole("link", { name: "誓約簿 VowBook 首頁" }),
    ).toHaveAttribute("href", "/");
  });
});