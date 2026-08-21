BEGIN;

ALTER TABLE "budget_items"
  ADD COLUMN "related_taxonomy_item_key" VARCHAR(80);

ALTER TABLE "budget_items"
  ADD CONSTRAINT "budget_items_related_taxonomy_item_key_check"
  CHECK (
    "related_taxonomy_item_key" IS NULL
    OR (
      "kind" = 'EXPENSE'::"BudgetItemKind"
      AND "related_taxonomy_item_key" IN (
        'ITEM_PROPOSAL',
        'ITEM_WEDDING_VENUE',
        'ITEM_PRE_WEDDING_PHOTOGRAPHY',
        'ITEM_WEDDING_CAKES',
        'ITEM_BRIDAL_STYLIST',
        'ITEM_WEDDING_PHOTOGRAPHY',
        'ITEM_WEDDING_VIDEOGRAPHY',
        'ITEM_WEDDING_HOST',
        'ITEM_WEDDING_BAND',
        'ITEM_WEDDING_INTERACTION',
        'ITEM_ATTIRE_RENTAL',
        'ITEM_WEDDING_SHOES',
        'ITEM_WEDDING_DECOR',
        'ITEM_INVITATIONS_POSTAGE',
        'ITEM_BEAUTY_TREATMENTS',
        'ITEM_WEDDING_FAVORS',
        'ITEM_ENGAGEMENT_GROOM',
        'ITEM_ENGAGEMENT_BRIDE',
        'ITEM_PROCESSION_GROOM',
        'ITEM_PROCESSION_BRIDE'
      )
    )
  );

COMMIT;
