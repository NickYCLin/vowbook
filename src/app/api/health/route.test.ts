import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => {
  throw new Error("The health route must not load Prisma");
});

import { GET } from "./route";

describe("GET /api/health", () => {
  it("returns JSON without loading the database client", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });
});
