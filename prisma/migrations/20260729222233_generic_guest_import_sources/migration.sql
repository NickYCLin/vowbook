-- Preserve existing LINEIN provenance while making guest imports source-independent.
CREATE TYPE "GuestManagedField" AS ENUM (
  'NAME',
  'SIDE',
  'ATTENDANCE_STATUS',
  'PARTY_SIZE'
);
CREATE TYPE "GuestImportBatchStatus" AS ENUM (
  'RUNNING',
  'SUCCEEDED',
  'PARTIAL',
  'FAILED'
);
CREATE TYPE "GuestImportRowStatus" AS ENUM (
  'SUCCEEDED',
  'FAILED',
  'SKIPPED',
  'CONFLICT'
);

ALTER TABLE "guests"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "guests_version_check" CHECK ("version" >= 0);

ALTER TABLE "guest_rsvps"
  DROP CONSTRAINT "guest_rsvps_pkey",
  DROP CONSTRAINT "guest_rsvps_relationship_label_check",
  DROP CONSTRAINT "guest_rsvps_contact_phone_check",
  DROP CONSTRAINT "guest_rsvps_child_seat_count_check",
  DROP CONSTRAINT "guest_rsvps_vegetarian_count_check",
  DROP CONSTRAINT "guest_rsvps_attendance_reply_check",
  DROP CONSTRAINT "guest_rsvps_paper_address_check",
  DROP CONSTRAINT "guest_rsvps_invitation_state_check";

DROP INDEX "guest_rsvps_guest_id_workspace_id_key";
DROP INDEX "guest_rsvps_workspace_id_source_external_id_key";

ALTER TABLE "guest_rsvps"
  ADD COLUMN "id" TEXT,
  ADD COLUMN "source_instance" VARCHAR(120) NOT NULL DEFAULT 'default',
  ADD COLUMN "source_label" VARCHAR(120),
  ADD COLUMN "source_managed" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN "managed_fields" "GuestManagedField"[] NOT NULL
    DEFAULT ARRAY[]::"GuestManagedField"[];

UPDATE "guest_rsvps"
SET
  "id" = "guest_id",
  "source_label" = CASE
    WHEN "source"::text = 'LINEIN' THEN '拍拍印'
    ELSE "source"::text
  END,
  "source_managed" = TRUE,
  "managed_fields" = ARRAY[
    'NAME'::"GuestManagedField",
    'SIDE'::"GuestManagedField",
    'ATTENDANCE_STATUS'::"GuestManagedField",
    'PARTY_SIZE'::"GuestManagedField"
  ];

ALTER TABLE "guest_rsvps"
  ALTER COLUMN "id" SET NOT NULL,
  ALTER COLUMN "source_label" SET NOT NULL,
  ALTER COLUMN "source" TYPE VARCHAR(64) USING "source"::text,
  ALTER COLUMN "relationship_label" DROP NOT NULL,
  ALTER COLUMN "contact_phone" DROP NOT NULL,
  ALTER COLUMN "child_seat_count" DROP DEFAULT,
  ALTER COLUMN "child_seat_count" DROP NOT NULL,
  ALTER COLUMN "vegetarian_count" DROP DEFAULT,
  ALTER COLUMN "vegetarian_count" DROP NOT NULL,
  ALTER COLUMN "invitation_delivery" DROP NOT NULL,
  ALTER COLUMN "attendance_reply" DROP NOT NULL,
  ALTER COLUMN "source_submitted_at" DROP NOT NULL,
  ADD CONSTRAINT "guest_rsvps_pkey" PRIMARY KEY ("id"),
  ADD CONSTRAINT "guest_rsvps_source_check" CHECK (
    "source" ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  ADD CONSTRAINT "guest_rsvps_source_instance_check" CHECK (
    "source_instance" = btrim("source_instance")
    AND char_length("source_instance") BETWEEN 1 AND 120
  ),
  ADD CONSTRAINT "guest_rsvps_source_label_check" CHECK (
    "source_label" = btrim("source_label")
    AND char_length("source_label") BETWEEN 1 AND 120
  ),
  ADD CONSTRAINT "guest_rsvps_managed_fields_check" CHECK (
    "source_managed" = (cardinality("managed_fields") > 0)
    AND cardinality(array_positions("managed_fields", 'NAME'::"GuestManagedField")) <= 1
    AND cardinality(array_positions("managed_fields", 'SIDE'::"GuestManagedField")) <= 1
    AND cardinality(array_positions("managed_fields", 'ATTENDANCE_STATUS'::"GuestManagedField")) <= 1
    AND cardinality(array_positions("managed_fields", 'PARTY_SIZE'::"GuestManagedField")) <= 1
  ),
  ADD CONSTRAINT "guest_rsvps_relationship_label_check" CHECK (
    "relationship_label" IS NULL
    OR (
      "relationship_label" = btrim("relationship_label")
      AND char_length("relationship_label") BETWEEN 1 AND 100
    )
  ),
  ADD CONSTRAINT "guest_rsvps_contact_phone_check" CHECK (
    "contact_phone" IS NULL
    OR (
      "contact_phone" = btrim("contact_phone")
      AND char_length("contact_phone") BETWEEN 1 AND 40
    )
  ),
  ADD CONSTRAINT "guest_rsvps_child_seat_count_check" CHECK (
    "child_seat_count" IS NULL OR "child_seat_count" BETWEEN 0 AND 20
  ),
  ADD CONSTRAINT "guest_rsvps_vegetarian_count_check" CHECK (
    "vegetarian_count" IS NULL OR "vegetarian_count" BETWEEN 0 AND 20
  ),
  ADD CONSTRAINT "guest_rsvps_attendance_reply_check" CHECK (
    "attendance_reply" IS NULL
    OR (
      "attendance_reply" = btrim("attendance_reply")
      AND char_length("attendance_reply") BETWEEN 1 AND 120
    )
  ),
  ADD CONSTRAINT "guest_rsvps_paper_address_check" CHECK (
    "invitation_delivery" IS NULL
    OR "invitation_delivery" <> 'PAPER'
    OR "mailing_address" IS NOT NULL
  ),
  ADD CONSTRAINT "guest_rsvps_invitation_state_check" CHECK (
    ("invitation_delivery" IS NULL AND "invitation_reply" IS NULL)
    OR ("invitation_delivery" = 'UNKNOWN' AND "invitation_reply" IS NULL)
    OR (
      "invitation_delivery" = 'PAPER'
      AND "mailing_address" IS NOT NULL
      AND "invitation_reply" IS NOT NULL
    )
    OR (
      "invitation_delivery" IN ('DIGITAL', 'NONE')
      AND "invitation_reply" IS NOT NULL
    )
  );

DROP TYPE "GuestRsvpSource";

CREATE UNIQUE INDEX "guest_rsvps_id_workspace_id_key"
  ON "guest_rsvps"("id", "workspace_id");
CREATE UNIQUE INDEX "guest_rsvps_workspace_source_instance_external_id_key"
  ON "guest_rsvps"(
    "workspace_id",
    "source",
    "source_instance",
    "external_id"
  );
CREATE UNIQUE INDEX "guest_rsvps_one_managed_owner_per_guest_key"
  ON "guest_rsvps"("guest_id", "workspace_id")
  WHERE "source_managed";

CREATE TABLE "guest_import_batches" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "source" VARCHAR(64) NOT NULL,
  "source_instance" VARCHAR(120) NOT NULL,
  "source_label" VARCHAR(120) NOT NULL,
  "idempotency_key" VARCHAR(191) NOT NULL,
  "mapping_version" VARCHAR(64) NOT NULL,
  "status" "GuestImportBatchStatus" NOT NULL DEFAULT 'RUNNING',
  "retry_of_batch_id" TEXT,
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "succeeded_rows" INTEGER NOT NULL DEFAULT 0,
  "failed_rows" INTEGER NOT NULL DEFAULT 0,
  "skipped_rows" INTEGER NOT NULL DEFAULT 0,
  "conflict_rows" INTEGER NOT NULL DEFAULT 0,
  "error_summary" JSONB,
  "rerun_count" INTEGER NOT NULL DEFAULT 0,
  "last_rerun_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "guest_import_batches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "guest_import_batches_source_check" CHECK (
    "source" ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  CONSTRAINT "guest_import_batches_source_instance_check" CHECK (
    "source_instance" = btrim("source_instance")
    AND char_length("source_instance") BETWEEN 1 AND 120
  ),
  CONSTRAINT "guest_import_batches_source_label_check" CHECK (
    "source_label" = btrim("source_label")
    AND char_length("source_label") BETWEEN 1 AND 120
  ),
  CONSTRAINT "guest_import_batches_idempotency_key_check" CHECK (
    "idempotency_key" = btrim("idempotency_key")
    AND char_length("idempotency_key") BETWEEN 1 AND 191
  ),
  CONSTRAINT "guest_import_batches_mapping_version_check" CHECK (
    "mapping_version" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  ),
  CONSTRAINT "guest_import_batches_counts_check" CHECK (
    "total_rows" >= 0
    AND "succeeded_rows" >= 0
    AND "failed_rows" >= 0
    AND "skipped_rows" >= 0
    AND "conflict_rows" >= 0
    AND (
      (
        "status" = 'RUNNING'
        AND (
          "succeeded_rows" + "failed_rows" + "skipped_rows" + "conflict_rows"
        ) <= "total_rows"
      )
      OR (
        "status" <> 'RUNNING'
        AND (
          "succeeded_rows" + "failed_rows" + "skipped_rows" + "conflict_rows"
        ) = "total_rows"
      )
    )
  ),
  CONSTRAINT "guest_import_batches_completion_check" CHECK (
    ("status" = 'RUNNING' AND "completed_at" IS NULL)
    OR (
      "status" = 'SUCCEEDED'
      AND "completed_at" IS NOT NULL
      AND "failed_rows" = 0
      AND "conflict_rows" = 0
    )
    OR (
      "status" = 'PARTIAL'
      AND "completed_at" IS NOT NULL
      AND ("succeeded_rows" + "skipped_rows") > 0
      AND ("failed_rows" + "conflict_rows") > 0
    )
    OR (
      "status" = 'FAILED'
      AND "completed_at" IS NOT NULL
      AND ("failed_rows" + "conflict_rows") > 0
    )
  )
);

CREATE UNIQUE INDEX "guest_import_batches_id_workspace_id_key"
  ON "guest_import_batches"("id", "workspace_id");
CREATE UNIQUE INDEX "guest_import_batches_identity_key"
  ON "guest_import_batches"(
    "workspace_id",
    "source",
    "source_instance",
    "idempotency_key"
  );
CREATE INDEX "guest_import_batches_ws_source_started_idx"
  ON "guest_import_batches"(
    "workspace_id",
    "source",
    "source_instance",
    "started_at",
    "id"
  );

CREATE TABLE "guest_import_batch_rows" (
  "id" TEXT NOT NULL,
  "workspace_id" TEXT NOT NULL,
  "batch_id" TEXT NOT NULL,
  "row_key" VARCHAR(191) NOT NULL,
  "external_id" VARCHAR(191),
  "guest_import_record_id" TEXT,
  "status" "GuestImportRowStatus" NOT NULL,
  "error_code" VARCHAR(64),
  "error_message" VARCHAR(500),
  "source_payload_hash" CHAR(64),
  "attempt_count" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "guest_import_batch_rows_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "guest_import_batch_rows_row_key_check" CHECK (
    "row_key" = btrim("row_key")
    AND char_length("row_key") BETWEEN 1 AND 191
  ),
  CONSTRAINT "guest_import_batch_rows_external_id_check" CHECK (
    "external_id" IS NULL
    OR (
      char_length("external_id") BETWEEN 1 AND 191
      AND char_length(btrim("external_id")) >= 1
    )
  ),
  CONSTRAINT "guest_import_batch_rows_error_code_check" CHECK (
    "error_code" IS NULL
    OR "error_code" ~ '^[A-Z][A-Z0-9_]{0,63}$'
  ),
  CONSTRAINT "guest_import_batch_rows_error_message_check" CHECK (
    "error_message" IS NULL
    OR (
      "error_message" = btrim("error_message")
      AND char_length("error_message") BETWEEN 1 AND 500
    )
  ),
  CONSTRAINT "guest_import_batch_rows_payload_hash_check" CHECK (
    "source_payload_hash" IS NULL
    OR "source_payload_hash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "guest_import_batch_rows_attempt_count_check" CHECK (
    "attempt_count" >= 1
  ),
  CONSTRAINT "guest_import_batch_rows_outcome_check" CHECK (
    (
      "status" IN ('SUCCEEDED', 'SKIPPED')
      AND "error_code" IS NULL
      AND "error_message" IS NULL
    )
    OR (
      "status" IN ('FAILED', 'CONFLICT')
      AND "error_code" IS NOT NULL
      AND "error_message" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "guest_import_batch_rows_batch_row_key"
  ON "guest_import_batch_rows"("batch_id", "row_key");
CREATE INDEX "guest_import_batch_rows_ws_status_idx"
  ON "guest_import_batch_rows"("workspace_id", "status", "batch_id", "id");

-- Preserve an explicit audit baseline for provenance created before batches existed.
INSERT INTO "guest_import_batches" (
  "id",
  "workspace_id",
  "source",
  "source_instance",
  "source_label",
  "idempotency_key",
  "mapping_version",
  "status",
  "total_rows",
  "succeeded_rows",
  "failed_rows",
  "skipped_rows",
  "conflict_rows",
  "rerun_count",
  "started_at",
  "completed_at",
  "created_at",
  "updated_at"
)
SELECT
  'legacy-linein-default:' || "workspace_id",
  "workspace_id",
  'LINEIN',
  'default',
  MIN("source_label"),
  'legacy-unknown',
  'legacy-unknown',
  'SUCCEEDED',
  COUNT(*)::INTEGER,
  COUNT(*)::INTEGER,
  0,
  0,
  0,
  0,
  MIN("created_at"),
  MAX("updated_at"),
  MIN("created_at"),
  MAX("updated_at")
FROM "guest_rsvps"
WHERE "source" = 'LINEIN'
GROUP BY "workspace_id";

WITH legacy_rows AS (
  SELECT
    "id" AS "record_id",
    "workspace_id",
    "external_id",
    "created_at",
    "updated_at",
    row_number() OVER (
      PARTITION BY "workspace_id"
      ORDER BY "external_id", "id"
    ) AS "row_number"
  FROM "guest_rsvps"
  WHERE "source" = 'LINEIN'
)
INSERT INTO "guest_import_batch_rows" (
  "id",
  "workspace_id",
  "batch_id",
  "row_key",
  "external_id",
  "guest_import_record_id",
  "status",
  "attempt_count",
  "created_at",
  "updated_at"
)
SELECT
  'legacy-linein-default-row:' || "workspace_id" || ':' || "row_number",
  "workspace_id",
  'legacy-linein-default:' || "workspace_id",
  'legacy-' || "row_number",
  "external_id",
  "record_id",
  'SUCCEEDED',
  1,
  "created_at",
  "updated_at"
FROM legacy_rows;

ALTER TABLE "guest_import_batches"
  ADD CONSTRAINT "guest_import_batches_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "guest_import_batches_retry_of_batch_id_workspace_id_fkey"
  FOREIGN KEY ("retry_of_batch_id", "workspace_id")
  REFERENCES "guest_import_batches"("id", "workspace_id")
  ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "guest_import_batch_rows"
  ADD CONSTRAINT "guest_import_batch_rows_workspace_id_fkey"
  FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "guest_import_batch_rows_batch_id_workspace_id_fkey"
  FOREIGN KEY ("batch_id", "workspace_id")
  REFERENCES "guest_import_batches"("id", "workspace_id")
  ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "guest_import_batch_rows_guest_import_record_id_fkey"
  FOREIGN KEY ("guest_import_record_id")
  REFERENCES "guest_rsvps"("id")
  ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "guest_import_batch_rows_record_tenant_fkey"
  FOREIGN KEY ("guest_import_record_id", "workspace_id")
  REFERENCES "guest_rsvps"("id", "workspace_id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
