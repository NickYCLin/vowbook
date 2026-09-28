import { createHash } from "node:crypto";

export class MobileRequestError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export function invalidRequest(): never {
  throw new MobileRequestError(400, "INVALID_REQUEST", "請重新從 App 開始登入。");
}

export function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function validateAuthorization(challenge: unknown, state: unknown) {
  if (typeof challenge !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
      typeof state !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(state)) invalidRequest();
  return { challenge, state };
}

export function validateExchange(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) invalidRequest();
  const fields = body as Record<string, unknown>;
  if (Object.keys(fields).some((key) => !["code", "verifier"].includes(key)) ||
      typeof fields.code !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(fields.code) ||
      typeof fields.verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(fields.verifier)) invalidRequest();
  return { code: fields.code, verifier: fields.verifier };
}

export function callbackURL(code: string, state: string) {
  return `vowbook://oauth/callback?${new URLSearchParams({ code, state })}`;
}
