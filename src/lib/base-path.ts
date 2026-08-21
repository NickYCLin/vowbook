const SAFE_BASE_PATH = /^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/;

export function normalizeBasePath(value: string | undefined): string {
  if (value === undefined || value === "") {
    return "";
  }

  if (!SAFE_BASE_PATH.test(value)) {
    throw new Error(
      "NEXT_PUBLIC_BASE_PATH 必須為空字串或不含尾端斜線的絕對路徑，例如 /VowBook。",
    );
  }

  return value;
}

export function getBasePath(): string {
  return normalizeBasePath(process.env.NEXT_PUBLIC_BASE_PATH);
}

function isSafeApplicationPath(path: string): boolean {
  const pathname = path.split(/[?#]/, 1)[0];

  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    !path.includes("\\") &&
    !pathname.includes("//") &&
    !/%(?:25|2e|2f|5c)/i.test(pathname) &&
    !pathname.split("/").some((segment) => segment === "." || segment === "..") &&
    !/[\u0000-\u001F\u007F]/.test(path)
  );
}

export function withBasePath(
  path: string,
  basePath = getBasePath(),
): string {
  if (!isSafeApplicationPath(path)) {
    throw new Error("應用程式路徑必須是安全的 root-relative path。");
  }

  if (basePath === "") {
    return path;
  }

  if (path === "/") {
    return basePath;
  }

  if (
    path === basePath ||
    path.startsWith(`${basePath}/`) ||
    path.startsWith(`${basePath}?`) ||
    path.startsWith(`${basePath}#`)
  ) {
    return path;
  }

  return `${basePath}${path}`;
}

export function normalizeCallbackUrl(
  value: string | string[] | undefined,
  fallback = "/dashboard",
): string {
  const candidate = Array.isArray(value) ? value[0] : value;
  const safePath =
    typeof candidate === "string" && isSafeApplicationPath(candidate)
      ? candidate
      : fallback;

  return withBasePath(safePath);
}

export function getSignInPath(callbackUrl = "/dashboard"): string {
  const normalizedCallbackUrl = normalizeCallbackUrl(callbackUrl);
  const params = new URLSearchParams({ callbackUrl: normalizedCallbackUrl });

  // next/navigation redirect() automatically applies Next.js basePath to its
  // destination. Keep the route app-relative while preserving the public
  // base path inside NextAuth's callbackUrl value.
  return `/signin?${params.toString()}`;
}
