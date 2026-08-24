-- 家人名單可包含同行的伴侶、小孩或寶寶；新人仍維持新郎、新娘各一筆。
ALTER TABLE "guests"
  DROP CONSTRAINT "guests_roster_category_check",
  ADD CONSTRAINT "guests_roster_category_check"
  CHECK (
    "category" = 'GUEST'
    OR (
      "category" = 'FAMILY'
      AND "side" IN ('PARTNER_A', 'PARTNER_B')
    )
    OR (
      "category" = 'COUPLE'
      AND "side" IN ('PARTNER_A', 'PARTNER_B')
      AND "party_size" = 1
    )
  ) NOT VALID;

ALTER TABLE "guests"
  VALIDATE CONSTRAINT "guests_roster_category_check";
