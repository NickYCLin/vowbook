"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { withBasePath } from "@/lib/base-path";

export function SignOutButton() {
  return (
    <Button
      variant="secondary"
      onClick={() => void signOut({ callbackUrl: withBasePath("/") })}
    >
      登出
    </Button>
  );
}
