import "server-only";

import type { User } from "@prisma/client";
import { getServerSession } from "next-auth";
import { authOptions } from "@/auth";
import {
  AuthenticationRequiredError,
  resolveCurrentUser,
} from "@/lib/current-user";

export async function getApiCurrentUser(): Promise<User | null> {
  const session = await getServerSession(authOptions);

  try {
    return await resolveCurrentUser(session);
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return null;
    }
    throw error;
  }
}
