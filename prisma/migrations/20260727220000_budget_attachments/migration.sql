CREATE TABLE "budget_attachments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "budget_item_id" TEXT NOT NULL,
    "original_name" VARCHAR(200) NOT NULL,
    "media_type" VARCHAR(30) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_attachments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "budget_attachments_original_name_check" CHECK (
        "original_name" = btrim("original_name")
        AND char_length("original_name") BETWEEN 1 AND 200
        AND "original_name" NOT IN ('.', '..')
        AND position('/' IN "original_name") = 0
        AND position(chr(92) IN "original_name") = 0
        AND "original_name" !~ '[[:cntrl:]]'
    ),
    CONSTRAINT "budget_attachments_media_type_check" CHECK (
        "media_type" IN (
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/webp'
        )
    ),
    CONSTRAINT "budget_attachments_byte_size_check" CHECK (
        "byte_size" BETWEEN 1 AND 10485760
    ),
    CONSTRAINT "budget_attachments_data_length_check" CHECK (
        octet_length("data") = "byte_size"
    ),
    CONSTRAINT "budget_attachments_sha256_check" CHECK (
        "sha256" ~ '^[0-9a-f]{64}$'
        AND "sha256" = encode(sha256("data"), 'hex')
    ),
    CONSTRAINT "budget_attachments_signature_check" CHECK (
        CASE "media_type"
            WHEN 'application/pdf' THEN
                substring("data" FROM 1 FOR 5) = decode('255044462d', 'hex')
            WHEN 'image/jpeg' THEN
                substring("data" FROM 1 FOR 3) = decode('ffd8ff', 'hex')
            WHEN 'image/png' THEN
                substring("data" FROM 1 FOR 8) = decode('89504e470d0a1a0a', 'hex')
            WHEN 'image/webp' THEN
                octet_length("data") >= 16
                AND substring("data" FROM 1 FOR 4) = convert_to('RIFF', 'UTF8')
                AND substring("data" FROM 9 FOR 4) = convert_to('WEBP', 'UTF8')
                AND substring("data" FROM 13 FOR 4) IN (
                    convert_to('VP8 ', 'UTF8'),
                    convert_to('VP8L', 'UTF8'),
                    convert_to('VP8X', 'UTF8')
                )
                AND (
                    get_byte("data", 4)
                    + get_byte("data", 5) * 256
                    + get_byte("data", 6) * 65536
                    + get_byte("data", 7) * 16777216
                    + 8
                ) = octet_length("data")
            ELSE FALSE
        END
    )
);

CREATE UNIQUE INDEX "budget_attachments_id_workspace_id_budget_item_id_key"
ON "budget_attachments"("id", "workspace_id", "budget_item_id");

CREATE INDEX "budget_attachments_ws_item_created_id_idx"
ON "budget_attachments"("workspace_id", "budget_item_id", "created_at", "id");

CREATE INDEX "budget_attachments_uploader_idx"
ON "budget_attachments"("uploaded_by_user_id");

ALTER TABLE "budget_attachments"
ADD CONSTRAINT "budget_attachments_workspace_id_fkey"
FOREIGN KEY ("workspace_id")
REFERENCES "wedding_workspaces"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "budget_attachments"
ADD CONSTRAINT "budget_attachments_budget_item_id_workspace_id_fkey"
FOREIGN KEY ("budget_item_id", "workspace_id")
REFERENCES "budget_items"("id", "workspace_id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "budget_attachments"
ADD CONSTRAINT "budget_attachments_uploaded_by_user_id_fkey"
FOREIGN KEY ("uploaded_by_user_id")
REFERENCES "users"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

CREATE FUNCTION "budget_attachment_expense_only"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM 1
    FROM "budget_items"
    WHERE "id" = NEW."budget_item_id"
      AND "workspace_id" = NEW."workspace_id"
      AND "kind" = 'EXPENSE'::"BudgetItemKind"
    FOR SHARE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'budget_attachments_expense_only_check',
            MESSAGE = 'budget attachment target must be an EXPENSE';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "budget_attachments_expense_only_trigger"
BEFORE INSERT OR UPDATE OF "budget_item_id", "workspace_id"
ON "budget_attachments"
FOR EACH ROW
EXECUTE FUNCTION "budget_attachment_expense_only"();

CREATE FUNCTION "budget_item_group_has_no_attachments"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."kind" = 'GROUP'::"BudgetItemKind"
       AND EXISTS (
           SELECT 1
           FROM "budget_attachments"
           WHERE "budget_item_id" = NEW."id"
             AND "workspace_id" = NEW."workspace_id"
       ) THEN
        RAISE EXCEPTION USING
            ERRCODE = '23514',
            CONSTRAINT = 'budget_attachments_expense_only_check',
            MESSAGE = 'budget item with attachments must remain an EXPENSE';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER "budget_items_group_has_no_attachments_trigger"
BEFORE UPDATE OF "kind"
ON "budget_items"
FOR EACH ROW
WHEN (OLD."kind" IS DISTINCT FROM NEW."kind")
EXECUTE FUNCTION "budget_item_group_has_no_attachments"();
