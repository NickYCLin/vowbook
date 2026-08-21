import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import {
  isRetryableTransactionConflict,
  runSerializableTransaction,
} from "./serializable-transaction";

describe("isRetryableTransactionConflict", () => {
  it.each(["40001", "40P01"])(
    "recognizes PostgreSQL %s wrapped as Prisma P2010",
    (code) => {
      expect(
        isRetryableTransactionConflict({
          code: "P2010",
          meta: { code },
        }),
      ).toBe(true);
    },
  );

  it("rejects unrelated Prisma and PostgreSQL errors", () => {
    expect(isRetryableTransactionConflict({ code: "P2025" })).toBe(false);
    expect(
      isRetryableTransactionConflict({
        code: "P2010",
        meta: { code: "23505" },
      }),
    ).toBe(false);
  });
});

describe("runSerializableTransaction", () => {
  it("retries P2034 conflicts and eventually returns the committed result", async () => {
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error("conflict"), { code: "P2034" }))
      .mockImplementationOnce(
        async (operation: (transaction: unknown) => Promise<string>) =>
          operation({ marker: "tx" }),
      );
    const operation = vi.fn().mockResolvedValue("完成");
    const client = {
      $transaction: transaction,
    } as unknown as Pick<PrismaClient, "$transaction">;

    await expect(
      runSerializableTransaction(operation, client),
    ).resolves.toBe("完成");
    expect(transaction).toHaveBeenCalledTimes(2);
    expect(transaction).toHaveBeenNthCalledWith(1, operation, {
      isolationLevel: "Serializable",
    });
    expect(transaction).toHaveBeenNthCalledWith(2, operation, {
      isolationLevel: "Serializable",
    });
  });

  it("retries PostgreSQL 40001 conflicts wrapped as Prisma P2010", async () => {
    const transaction = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("raw conflict"), {
          code: "P2010",
          meta: { code: "40001" },
        }),
      )
      .mockResolvedValueOnce("完成");
    const client = {
      $transaction: transaction,
    } as unknown as Pick<PrismaClient, "$transaction">;

    await expect(
      runSerializableTransaction(vi.fn(), client),
    ).resolves.toBe("完成");
    expect(transaction).toHaveBeenCalledTimes(2);
  });

  it("does not retry unrelated database failures", async () => {
    const databaseError = Object.assign(new Error("database failure"), {
      code: "P2025",
    });
    const transaction = vi.fn().mockRejectedValue(databaseError);
    const client = {
      $transaction: transaction,
    } as unknown as Pick<PrismaClient, "$transaction">;

    await expect(
      runSerializableTransaction(vi.fn(), client),
    ).rejects.toBe(databaseError);
    expect(transaction).toHaveBeenCalledOnce();
  });
});
