CREATE TABLE "guest_invitation_settings" (
 "workspace_id" TEXT PRIMARY KEY REFERENCES "wedding_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "version" INTEGER NOT NULL DEFAULT 0 CHECK ("version" >= 0),
 "questions" JSONB NOT NULL DEFAULT '[]', "venue_name" VARCHAR(100), "venue_address" VARCHAR(200),
 "map_bytes" BYTEA, "map_mime" TEXT,
 CONSTRAINT "guest_invitation_map_pair" CHECK (("map_bytes" IS NULL AND "map_mime" IS NULL) OR ("map_bytes" IS NOT NULL AND "map_mime" = 'image/png'))
);
CREATE TABLE "guest_invitations" (
 "id" TEXT PRIMARY KEY, "workspace_id" TEXT NOT NULL REFERENCES "wedding_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "guest_id" TEXT NOT NULL, "token_hash" CHAR(64) NOT NULL UNIQUE, "check_in_token_hash" CHAR(64) NOT NULL UNIQUE,
 "expires_at" TIMESTAMP(3) NOT NULL, "revoked_at" TIMESTAMP(3), "version" INTEGER NOT NULL DEFAULT 0 CHECK ("version" >= 0),
 "response_version" INTEGER NOT NULL DEFAULT 0 CHECK ("response_version" >= 0), "response" JSONB,
 "submitted_at" TIMESTAMP(3), "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "guest_invitations_guest_id_workspace_id_fkey" FOREIGN KEY ("guest_id", "workspace_id") REFERENCES "guests"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "guest_invitations_guest_id_workspace_id_key" ON "guest_invitations"("guest_id", "workspace_id");
CREATE INDEX "guest_invitations_workspace_id_idx" ON "guest_invitations"("workspace_id");
