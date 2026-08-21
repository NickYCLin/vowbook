import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  vowBookPrisma?: PrismaClient;
};

export const prisma = globalForPrisma.vowBookPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.vowBookPrisma = prisma;
}
