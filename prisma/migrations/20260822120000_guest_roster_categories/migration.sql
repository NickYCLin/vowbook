-- CreateEnum
CREATE TYPE "GuestCategory" AS ENUM ('GUEST', 'COUPLE', 'FAMILY');

-- AlterTable
-- Existing RSVP and manually entered rows remain ordinary guests.
ALTER TABLE "guests"
  ADD COLUMN "category" "GuestCategory" NOT NULL DEFAULT 'GUEST';

-- Newlyweds and family are individual roster members and must belong to one side.
ALTER TABLE "guests"
  ADD CONSTRAINT "guests_roster_category_check"
  CHECK (
    "category" = 'GUEST'
    OR (
      "side" IN ('PARTNER_A', 'PARTNER_B')
      AND "party_size" = 1
    )
  ) NOT VALID;

ALTER TABLE "guests"
  VALIDATE CONSTRAINT "guests_roster_category_check";

-- A workspace has at most one groom and one bride.
CREATE UNIQUE INDEX "guests_workspace_couple_side_key"
  ON "guests"("workspace_id", "side")
  WHERE "category" = 'COUPLE';

CREATE INDEX "guests_workspace_category_idx"
  ON "guests"("workspace_id", "category");
