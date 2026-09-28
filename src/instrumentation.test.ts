import { afterEach, describe, expect, it, vi } from "vitest";

const installResilientDns = vi.fn();

vi.mock("@/lib/resilient-dns", () => ({ installResilientDns }));

afterEach(() => {
  installResilientDns.mockClear();
  delete process.env.NEXT_RUNTIME;
});

describe("instrumentation", () => {
  it("installs the resilient dns lookup on the node runtime", async () => {
    process.env.NEXT_RUNTIME = "nodejs";
    const { register } = await import("@/instrumentation");
    await register();
    expect(installResilientDns).toHaveBeenCalledTimes(1);
  });

  it("stays out of the way on the edge runtime", async () => {
    process.env.NEXT_RUNTIME = "edge";
    const { register } = await import("@/instrumentation");
    await register();
    expect(installResilientDns).not.toHaveBeenCalled();
  });
});
