-- CreateEnum
CREATE TYPE "GuestSide" AS ENUM ('PARTNER_A', 'PARTNER_B', 'SHARED');

-- CreateEnum
CREATE TYPE "GuestAttendanceStatus" AS ENUM ('UNDECIDED', 'ATTENDING', 'DECLINED');

-- CreateTable
CREATE TABLE "guests" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "side" "GuestSide" NOT NULL,
    "attendance_status" "GuestAttendanceStatus" NOT NULL DEFAULT 'UNDECIDED',
    "party_size" INTEGER NOT NULL DEFAULT 1,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "guests_name_length_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 80),
    CONSTRAINT "guests_party_size_check" CHECK ("party_size" BETWEEN 1 AND 20),
    CONSTRAINT "guests_notes_length_check" CHECK ("notes" IS NULL OR char_length("notes") <= 500)
);

-- CreateIndex
CREATE INDEX "guests_workspace_id_idx" ON "guests"("workspace_id");

-- AddForeignKey
ALTER TABLE "guests" ADD CONSTRAINT "guests_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
