-- 電子喜帖與廠商文件：新表，不回填既有婚宴。
CREATE TYPE "WorkspaceDocumentCategory" AS ENUM ('INVITATION', 'VENDOR_SCHEDULE', 'VENDOR_CONTRACT', 'OTHER');

CREATE TABLE "workspace_documents" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "category" "WorkspaceDocumentCategory" NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "notes" VARCHAR(200),
    "original_name" VARCHAR(200) NOT NULL,
    "media_type" VARCHAR(100) NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "data" BYTEA NOT NULL,
    "uploaded_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workspace_documents_title_check" CHECK (
        "title" = btrim("title") AND char_length("title") BETWEEN 1 AND 80
    ),
    CONSTRAINT "workspace_documents_notes_check" CHECK (
        "notes" IS NULL OR ("notes" = btrim("notes") AND char_length("notes") BETWEEN 1 AND 200)
    ),
    CONSTRAINT "workspace_documents_media_type_check" CHECK (
        "media_type" IN (
            'application/pdf',
            'image/jpeg',
            'image/png',
            'image/webp',
            'image/gif',
            'video/mp4',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        )
    ),
    CONSTRAINT "workspace_documents_byte_size_check" CHECK (
        "byte_size" BETWEEN 1 AND 26214400 AND octet_length("data") = "byte_size"
    ),
    CONSTRAINT "workspace_documents_sha256_check" CHECK ("sha256" ~ '^[0-9a-f]{64}$')
);

CREATE INDEX "workspace_documents_ws_category_created_id_idx" ON "workspace_documents"("workspace_id", "category", "created_at", "id");
CREATE INDEX "workspace_documents_uploader_idx" ON "workspace_documents"("uploaded_by_user_id");

ALTER TABLE "workspace_documents" ADD CONSTRAINT "workspace_documents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "workspace_documents" ADD CONSTRAINT "workspace_documents_uploaded_by_user_id_fkey" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
