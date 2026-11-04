CREATE TABLE "product_feedback" (
    "id" UUID NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,
    "section" VARCHAR(40) NOT NULL,
    "category" VARCHAR(20) NOT NULL,
    "message" VARCHAR(3000) NOT NULL,
    "contact" VARCHAR(254),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "product_feedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_feedback_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "product_feedback_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "product_feedback_author_id_created_at_idx" ON "product_feedback"("author_id", "created_at");
CREATE INDEX "product_feedback_created_at_id_idx" ON "product_feedback"("created_at", "id");
