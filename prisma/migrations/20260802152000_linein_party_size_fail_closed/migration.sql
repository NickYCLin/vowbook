-- Repair stale v1 ownership once more, then prevent LINEIN/default from reclaiming PARTY_SIZE.
UPDATE "guest_rsvps" AS "guest_rsvps"
SET
  "source_party_size" = COALESCE(
    "guest_rsvps"."source_party_size",
    "guests"."party_size"
  ),
  "managed_fields" = array_remove(
    "guest_rsvps"."managed_fields",
    'PARTY_SIZE'::"GuestManagedField"
  ),
  "source_managed" = cardinality(
    array_remove(
      "guest_rsvps"."managed_fields",
      'PARTY_SIZE'::"GuestManagedField"
    )
  ) > 0,
  "updated_at" = CURRENT_TIMESTAMP
FROM "guests" AS "guests"
WHERE "guest_rsvps"."guest_id" = "guests"."id"
  AND "guest_rsvps"."workspace_id" = "guests"."workspace_id"
  AND "guest_rsvps"."source" = 'LINEIN'
  AND "guest_rsvps"."source_instance" = 'default'
  AND "guest_rsvps"."source_managed" = TRUE
  AND 'PARTY_SIZE'::"GuestManagedField" = ANY(
    "guest_rsvps"."managed_fields"
  );

DO $migration$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'guest_rsvps_linein_default_no_party_size_check'
      AND conrelid = '"guest_rsvps"'::regclass
  ) THEN
    ALTER TABLE "guest_rsvps"
      ADD CONSTRAINT "guest_rsvps_linein_default_no_party_size_check"
      CHECK (
        "source" <> 'LINEIN'
        OR "source_instance" <> 'default'
        OR NOT (
          'PARTY_SIZE'::"GuestManagedField" = ANY("managed_fields")
        )
      ) NOT VALID;
  END IF;
END
$migration$;

ALTER TABLE "guest_rsvps"
  VALIDATE CONSTRAINT "guest_rsvps_linein_default_no_party_size_check";
