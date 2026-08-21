import { NextResponse } from "next/server";

/**
 * Keep the landing document out of shared edge caches. Its deployment-hashed
 * CSS and JavaScript assets may be replaced by a later app image.
 */
export function proxy() {
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export const config = {
  matcher: "/",
};
