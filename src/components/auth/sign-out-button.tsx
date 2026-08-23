"use client";

import { signOut } from "next-auth/react";
import {
  Button,
  type ButtonVariant,
} from "@/components/ui/button";
import { withBasePath } from "@/lib/base-path";

export function SignOutButton({
  variant = "secondary",
  className,
}: {
  variant?: ButtonVariant;
  className?: string;
} = {}) {
  return (
    <Button
      variant={variant}
      className={className}
      onClick={() => void signOut({ callbackUrl: withBasePath("/") })}
    >
      登出
    </Button>
  );
}
