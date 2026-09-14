BEGIN;

ALTER TABLE "guests"
  ADD CONSTRAINT "guests_declined_seating_consistency_check"
  CHECK ("attendance_status" <> 'DECLINED' OR "seating_table_id" IS NULL);

COMMIT;
