import { describe, expect, it } from "vitest";
import { digest, pkceChallenge, validateAuthorization, validateExchange, callbackURL } from "./protocol";

describe("mobile authorization protocol", () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  it("uses RFC 7636 S256 and stores only SHA-256 digests", () => {
    expect(pkceChallenge(verifier)).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    expect(digest(verifier)).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects weak, malformed and duplicate parameters", () => {
    for (const value of ["", "short", "A".repeat(129), "<".repeat(43), ["A".repeat(43)]]) {
      expect(() => validateAuthorization(value, "B".repeat(43))).toThrow();
      expect(() => validateAuthorization("B".repeat(43), value)).toThrow();
    }
    expect(() => validateExchange({ code: "A".repeat(43), verifier: "short" })).toThrow();
    expect(() => validateExchange({ code: "A".repeat(43), verifier, userId: "owner" })).toThrow();
  });
  it("accepts only a fixed callback carrying a one-time code and bound state", () => {
    const state = "B".repeat(43);
    expect(validateAuthorization(pkceChallenge(verifier), state)).toEqual({ challenge: pkceChallenge(verifier), state });
    expect(callbackURL("A".repeat(43), state)).toBe(`vowbook://oauth/callback?code=${"A".repeat(43)}&state=${state}`);
    expect(validateExchange({ code: "A".repeat(43), verifier })).toEqual({ code: "A".repeat(43), verifier });
  });
});
