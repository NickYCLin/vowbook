BEGIN;

-- 婚宴結束時要發給工作人員的紅包。金額與「已發放」分開：金額是事前決定的，
-- 發放是當天一個一個交出去的動作，需要知道誰拿了誰還沒。
ALTER TABLE "wedding_staff_assignments"
  ADD COLUMN "red_envelope_amount" INTEGER,
  ADD COLUMN "red_envelope_sent_at" TIMESTAMP(3);

ALTER TABLE "wedding_staff_assignments"
  ADD CONSTRAINT "wedding_staff_assignments_red_envelope_amount_check" CHECK (
    "red_envelope_amount" IS NULL OR "red_envelope_amount" > 0
  );

-- 沒有金額就沒有紅包可發，因此不得只有發放時間。
ALTER TABLE "wedding_staff_assignments"
  ADD CONSTRAINT "wedding_staff_assignments_red_envelope_sent_check" CHECK (
    "red_envelope_sent_at" IS NULL OR "red_envelope_amount" IS NOT NULL
  );

COMMIT;
