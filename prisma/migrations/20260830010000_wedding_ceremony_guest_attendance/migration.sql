BEGIN;

CREATE TYPE "WeddingCeremonyAttendanceStatus" AS ENUM (
  'NOT_INCLUDED',
  'UNDECIDED',
  'ATTENDING',
  'DECLINED'
);

CREATE TABLE "wedding_ceremony_guest_attendances" (
  "ceremony_id" TEXT NOT NULL,
  "guest_id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "status" "WeddingCeremonyAttendanceStatus" NOT NULL DEFAULT 'UNDECIDED',
  "version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "wedding_ceremony_guest_attendances_pkey"
    PRIMARY KEY ("ceremony_id", "guest_id", "workspace_id"),
  CONSTRAINT "wedding_ceremony_guest_attendances_version_check"
    CHECK ("version" >= 0)
);

CREATE INDEX "ceremony_guest_attendance_ws_ceremony_status_guest_idx"
  ON "wedding_ceremony_guest_attendances"(
    "workspace_id",
    "ceremony_id",
    "status",
    "guest_id"
  );

CREATE INDEX "ceremony_guest_attendance_ws_guest_ceremony_idx"
  ON "wedding_ceremony_guest_attendances"(
    "workspace_id",
    "guest_id",
    "ceremony_id"
  );

ALTER TABLE "wedding_ceremony_guest_attendances"
  ADD CONSTRAINT "wedding_ceremony_guest_attendances_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wedding_ceremony_guest_attendances"
  ADD CONSTRAINT "ceremony_guest_attendance_ceremony_ws_fkey"
  FOREIGN KEY ("ceremony_id", "workspace_id")
  REFERENCES "wedding_ceremonies"("id", "workspace_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wedding_ceremony_guest_attendances"
  ADD CONSTRAINT "ceremony_guest_attendance_guest_ws_fkey"
  FOREIGN KEY ("guest_id", "workspace_id")
  REFERENCES "guests"("id", "workspace_id")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
