-- Narrow the default LINEIN importer ownership without changing source details or Guest rows.
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
  ) > 0
FROM "guests" AS "guests"
WHERE "guest_rsvps"."guest_id" = "guests"."id"
  AND "guest_rsvps"."workspace_id" = "guests"."workspace_id"
  AND "guest_rsvps"."source" = 'LINEIN'
  AND "guest_rsvps"."source_instance" = 'default'
  AND "guest_rsvps"."source_managed" = TRUE
  AND 'PARTY_SIZE'::"GuestManagedField" = ANY(
    "guest_rsvps"."managed_fields"
  );
