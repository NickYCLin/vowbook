export function isSameOriginMutationRequest(request: Request): boolean {
  const originValue = request.headers.get("origin");
  const hostValue = request.headers.get("host");
  if (!originValue || originValue === "null" || !hostValue) {
    return false;
  }

  const forwardedProto = request.headers.get("x-forwarded-proto");
  if (forwardedProto?.includes(",")) return false;

  try {
    const requestUrl = new URL(request.url);
    const origin = new URL(originValue);
    const protocol = forwardedProto
      ? `${forwardedProto.toLowerCase()}:`
      : requestUrl.protocol;
    const expectedOrigin = new URL(
      `${protocol}//${hostValue.toLowerCase()}`,
    );

    if (
      (protocol !== "https:" && protocol !== "http:") ||
      origin.username !== "" ||
      origin.password !== "" ||
      expectedOrigin.username !== "" ||
      expectedOrigin.password !== "" ||
      expectedOrigin.pathname !== "/" ||
      expectedOrigin.search !== "" ||
      expectedOrigin.hash !== "" ||
      origin.pathname !== "/" ||
      origin.search !== "" ||
      origin.hash !== ""
    ) {
      return false;
    }

    return origin.origin === expectedOrigin.origin;
  } catch {
    return false;
  }
}

export function hasBoundedContentLength(
  request: Request,
  maxBytes: number,
): boolean {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) return false;

  const contentLength = request.headers.get("content-length");
  if (contentLength === null || !/^[1-9][0-9]*$/u.test(contentLength)) {
    return false;
  }

  const parsed = Number(contentLength);
  return Number.isSafeInteger(parsed) && parsed <= maxBytes;
}
