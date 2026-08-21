ALTER TABLE "guest_rsvps"
  ADD COLUMN "source_party_size" INTEGER;

ALTER TABLE "guest_rsvps"
  ADD CONSTRAINT "guest_rsvps_source_party_size_check" CHECK (
    "source_party_size" IS NULL
    OR "source_party_size" BETWEEN 1 AND 20
  );
