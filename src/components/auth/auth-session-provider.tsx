"use client";

import type { ReactNode } from "react";
import { SessionProvider } from "next-auth/react";
import { withBasePath } from "@/lib/base-path";

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  return (
    <SessionProvider basePath={withBasePath("/api/auth")}>
      {children}
    </SessionProvider>
  );
}
