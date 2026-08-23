import { createHash } from "node:crypto";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";

const runDatabaseIntegration = process.env.VOWBOOK_DB_INTEGRATION === "1";
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;
const prisma = new PrismaClient();
const subjectPrefix = `avatar-it-${process.pid}-`;
let sequence = 0;
let validWebp: Uint8Array<ArrayBuffer>;

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

async function createUser(label: string) {
  sequence += 1;
  return prisma.user.create({
    data: {
      googleSubject: `${subjectPrefix}${label}-${sequence}`,
      email: `${subjectPrefix}${label}-${sequence}@example.test`,
    },
  });
}

describeDatabase("profile avatar PostgreSQL invariants", () => {
  beforeAll(async () => {
    const generated = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: { r: 121, g: 149, b: 132 },
      },
    })
      .webp()
      .toBuffer();
    validWebp = Uint8Array.from(generated);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { googleSubject: { startsWith: subjectPrefix } },
    });
    await prisma.$disconnect();
  });

  it("stores at most one private avatar per user and cascades with the user", async () => {
    const user = await createUser("cascade");
    await prisma.userAvatar.create({
      data: {
        userId: user.id,
        data: validWebp,
        mediaType: "image/webp",
        byteSize: validWebp.byteLength,
        sha256: sha256(validWebp),
      },
    });

    expect(await prisma.userAvatar.count({ where: { userId: user.id } })).toBe(1);
    await expect(
      prisma.userAvatar.create({
        data: {
          userId: user.id,
          data: validWebp,
          mediaType: "image/webp",
          byteSize: validWebp.byteLength,
          sha256: sha256(validWebp),
        },
      }),
    ).rejects.toBeDefined();

    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.userAvatar.count({ where: { userId: user.id } })).toBe(0);
  });

  it("rejects rows outside the normalized WebP storage contract", async () => {
    const invalidMediaUser = await createUser("media");
    await expect(
      prisma.userAvatar.create({
        data: {
          userId: invalidMediaUser.id,
          data: validWebp,
          mediaType: "image/png",
          byteSize: validWebp.byteLength,
          sha256: sha256(validWebp),
        },
      }),
    ).rejects.toBeDefined();

    const invalidSizeUser = await createUser("size");
    await expect(
      prisma.userAvatar.create({
        data: {
          userId: invalidSizeUser.id,
          data: validWebp,
          mediaType: "image/webp",
          byteSize: 0,
          sha256: sha256(validWebp),
        },
      }),
    ).rejects.toBeDefined();

    const invalidHashUser = await createUser("hash");
    await expect(
      prisma.userAvatar.create({
        data: {
          userId: invalidHashUser.id,
          data: validWebp,
          mediaType: "image/webp",
          byteSize: validWebp.byteLength,
          sha256: "d".repeat(64),
        },
      }),
    ).rejects.toBeDefined();

    const invalidSignatureUser = await createUser("signature");
    const invalidSignature = Uint8Array.from(
      Buffer.from("not-a-valid-webp"),
    );
    await expect(
      prisma.userAvatar.create({
        data: {
          userId: invalidSignatureUser.id,
          data: invalidSignature,
          mediaType: "image/webp",
          byteSize: invalidSignature.byteLength,
          sha256: sha256(invalidSignature),
        },
      }),
    ).rejects.toBeDefined();
  });
});
