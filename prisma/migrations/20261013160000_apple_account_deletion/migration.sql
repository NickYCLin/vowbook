ALTER TABLE "users"
  ADD COLUMN "apple_deletion_nonce_hash" VARCHAR(64),
  ADD COLUMN "apple_deletion_expires_at" TIMESTAMPTZ(3),
  ADD COLUMN "apple_deletion_token" TEXT,
  ADD COLUMN "apple_deletion_revoked_at" TIMESTAMPTZ(3),
  ADD COLUMN "apple_deletion_lease_until" TIMESTAMPTZ(3);
