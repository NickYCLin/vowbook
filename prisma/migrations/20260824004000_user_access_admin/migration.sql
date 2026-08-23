CREATE TYPE "UserAccessStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'REMOVED');

ALTER TABLE "users"
  ADD COLUMN "access_status" "UserAccessStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "access_status_changed_at" TIMESTAMPTZ(3),
  ADD COLUMN "last_login_at" TIMESTAMPTZ(3),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "users_access_status_created_at_idx"
  ON "users"("access_status", "created_at");
