-- CreateEnum
CREATE TYPE "WeddingTaskSide" AS ENUM ('SHARED', 'PARTNER_A', 'PARTNER_B');

-- AlterTable
ALTER TABLE "wedding_tasks"
ADD COLUMN "side" "WeddingTaskSide" NOT NULL DEFAULT 'SHARED';
