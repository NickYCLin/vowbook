-- 移除廠商管理功能。
-- OWNER 於 2026-09-07 決定整個功能連資料表一起拿掉；正式站兩張表都是 0 筆。
-- 為了避免在任何還有資料的環境誤刪，先確認兩張表為空，否則整個 migration 失敗。
BEGIN;

DO $guard$
DECLARE
  vendor_count bigint;
  link_count bigint;
BEGIN
  SELECT count(*) INTO vendor_count FROM "wedding_vendors";
  SELECT count(*) INTO link_count FROM "wedding_vendor_budget_items";
  IF vendor_count <> 0 OR link_count <> 0 THEN
    RAISE EXCEPTION
      'refusing to drop vendor tables with data: wedding_vendors=% wedding_vendor_budget_items=%',
      vendor_count, link_count;
  END IF;
END
$guard$;

DROP TABLE "wedding_vendor_budget_items";
DROP TABLE "wedding_vendors";
DROP TYPE "WeddingVendorStatus";

COMMIT;
