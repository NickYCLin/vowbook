import "server-only";

import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export class SerializationConflictError extends Error {
  constructor() {
    super("同時有其他座位變更，請重新確認後再試。");
    this.name = "SerializationConflictError";
  }
}

export function isRetryableTransactionConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return false;
  }
  if (error.code === "P2034") return true;

  // Prisma wraps PostgreSQL SQLSTATEs from raw statements as P2010, while
  // model operations normally surface the same retryable conflict as P2034.
  return (
    error.code === "P2010" &&
    "meta" in error &&
    typeof error.meta === "object" &&
    error.meta !== null &&
    "code" in error.meta &&
    (error.meta.code === "40001" || error.meta.code === "40P01")
  );
}

export async function runSerializableTransaction<T>(
  operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  client: Pick<PrismaClient, "$transaction"> = prisma,
  maxAttempts = 3,
): Promise<T> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await client.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryableTransactionConflict(error)) {
        throw error;
      }

      if (attempt === maxAttempts) {
        throw new SerializationConflictError();
      }
    }
  }

  throw new SerializationConflictError();
}
