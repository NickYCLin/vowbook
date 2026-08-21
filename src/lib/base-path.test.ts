import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getSignInPath,
  normalizeBasePath,
  normalizeCallbackUrl,
  withBasePath,
} from "./base-path";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("base path contract", () => {
  it.each([undefined, ""])("defaults %s to the domain root", (value) => {
    expect(normalizeBasePath(value)).toBe("");
  });

  it("accepts a normalized deployment path", () => {
    expect(normalizeBasePath("/VowBook")).toBe("/VowBook");
  });

  it.each([
    "/",
    "VowBook",
    "/VowBook/",
    "//VowBook",
    "/Vow Book",
    "/VowBook?unsafe=true",
  ])("rejects an unsafe or non-normalized base path: %s", (value) => {
    expect(() => normalizeBasePath(value)).toThrow(/NEXT_PUBLIC_BASE_PATH/);
  });

  it("prefixes application paths exactly once", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/VowBook");

    expect(withBasePath("/dashboard")).toBe("/VowBook/dashboard");
    expect(withBasePath("/VowBook/dashboard")).toBe("/VowBook/dashboard");
    expect(withBasePath("/")).toBe("/VowBook");
    expect(withBasePath("/signin?callbackUrl=/VowBook/dashboard")).toBe(
      "/VowBook/signin?callbackUrl=/VowBook/dashboard",
    );
  });

  it("keeps root deployment paths unchanged", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "");

    expect(withBasePath("/dashboard")).toBe("/dashboard");
    expect(withBasePath("/")).toBe("/");
  });

  it("normalizes safe sign-in callbacks under the deployment path", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/VowBook");

    expect(normalizeCallbackUrl("/dashboard")).toBe("/VowBook/dashboard");
    expect(normalizeCallbackUrl("/VowBook/dashboard?view=mine")).toBe(
      "/VowBook/dashboard?view=mine",
    );
  });

  it("keeps the server redirect app-relative and encodes a base-path callback", () => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/VowBook");

    expect(getSignInPath("/dashboard")).toBe(
      "/signin?callbackUrl=%2FVowBook%2Fdashboard",
    );
  });

  it.each([
    undefined,
    "https://attacker.example/steal",
    "//attacker.example/steal",
    "/\\attacker.example/steal",
    "/VowBook/../other-service",
    "/VowBook/./dashboard",
    "/VowBook/%2e%2e/other-service",
    "/VowBook/%2E%2E/other-service",
    "/VowBook/%252e%252e/other-service",
    "/VowBook/dashboard%2f..%2fother-service",
    "/VowBook/dashboard%5c..%5cother-service",
    "/VowBook//other-service",
  ])("falls back safely for an untrusted callback: %s", (value) => {
    vi.stubEnv("NEXT_PUBLIC_BASE_PATH", "/VowBook");

    expect(normalizeCallbackUrl(value)).toBe("/VowBook/dashboard");
  });
});
