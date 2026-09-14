BEGIN;

-- 禮到人不到的賓客要回禮回喜餅。有 return_gift_sent_at 代表已回禮，
-- 順帶記下回禮時間；備註可在尚未寄出前先寫下要準備什麼。
ALTER TABLE "wedding_gifts"
  ADD COLUMN "return_gift_sent_at" TIMESTAMP(3),
  ADD COLUMN "return_gift_note" VARCHAR(200);

ALTER TABLE "wedding_gifts"
  ADD CONSTRAINT "wedding_gifts_return_gift_note_check" CHECK (
    "return_gift_note" IS NULL OR (
      "return_gift_note" = btrim("return_gift_note")
      AND char_length("return_gift_note") BETWEEN 1 AND 200
      AND "return_gift_note" ~ '[^[:space:]]'
    )
  );

COMMIT;
