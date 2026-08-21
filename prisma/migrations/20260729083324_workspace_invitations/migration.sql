DROP INDEX "users_email_key";

UPDATE "users"
SET "email" = lower(btrim("email"));

ALTER TABLE "users"
ADD CONSTRAINT "users_email_check" CHECK (
    "email" = lower(btrim("email"))
    AND char_length("email") BETWEEN 3 AND 254
    AND octet_length("email") = char_length("email")
    AND "email" ~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
);

CREATE INDEX "users_email_idx"
ON "users"("email");

CREATE TYPE "WorkspaceInvitationStatus" AS ENUM (
    'PENDING',
    'ACCEPTED',
    'REVOKED',
    'EXPIRED'
);

CREATE TABLE "workspace_invitations" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "status" "WorkspaceInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "operation_key" UUID NOT NULL,
    "invited_by_user_id" TEXT NOT NULL,
    "accepted_by_user_id" TEXT,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "superseded_by_invitation_id" TEXT,
    "superseded_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "workspace_invitations_email_check" CHECK (
        "email" = lower(btrim("email"))
        AND char_length("email") BETWEEN 3 AND 254
        AND octet_length("email") = char_length("email")
        AND "email" ~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
    ),
    CONSTRAINT "workspace_invitations_role_check" CHECK (
        "role" <> 'OWNER'::"MembershipRole"
    ),
    CONSTRAINT "workspace_invitations_expiry_check" CHECK (
        "expires_at" > "created_at"
    ),
    CONSTRAINT "workspace_invitations_version_check" CHECK (
        "version" >= 1
    ),
    CONSTRAINT "workspace_invitations_state_check" CHECK (
        (
            "status" = 'PENDING'::"WorkspaceInvitationStatus"
            AND "accepted_by_user_id" IS NULL
            AND "accepted_at" IS NULL
            AND "revoked_at" IS NULL
        )
        OR (
            "status" = 'ACCEPTED'::"WorkspaceInvitationStatus"
            AND "accepted_by_user_id" IS NOT NULL
            AND "accepted_at" IS NOT NULL
            AND "accepted_at" >= "created_at"
            AND "accepted_at" < "expires_at"
            AND "revoked_at" IS NULL
        )
        OR (
            "status" = 'REVOKED'::"WorkspaceInvitationStatus"
            AND "accepted_by_user_id" IS NULL
            AND "accepted_at" IS NULL
            AND "revoked_at" IS NOT NULL
            AND "revoked_at" >= "created_at"
        )
        OR (
            "status" = 'EXPIRED'::"WorkspaceInvitationStatus"
            AND "accepted_by_user_id" IS NULL
            AND "accepted_at" IS NULL
            AND "revoked_at" IS NULL
            AND "expires_at" <= "updated_at"
        )
    ),
    CONSTRAINT "workspace_invitations_lineage_check" CHECK (
        (
            "superseded_by_invitation_id" IS NULL
            AND "superseded_at" IS NULL
        )
        OR (
            "superseded_by_invitation_id" IS NOT NULL
            AND "superseded_at" IS NOT NULL
            AND "superseded_by_invitation_id" <> "id"
            AND "status" IN (
                'REVOKED'::"WorkspaceInvitationStatus",
                'EXPIRED'::"WorkspaceInvitationStatus"
            )
            AND "superseded_at" >= "created_at"
        )
    )
);

CREATE UNIQUE INDEX "workspace_invitations_operation_key_key"
ON "workspace_invitations"("operation_key");

CREATE UNIQUE INDEX "workspace_invitations_superseded_by_invitation_id_key"
ON "workspace_invitations"("superseded_by_invitation_id");

CREATE UNIQUE INDEX "workspace_invitations_one_pending_per_email_idx"
ON "workspace_invitations"("workspace_id", "email")
WHERE "status" = 'PENDING'::"WorkspaceInvitationStatus";

CREATE INDEX "workspace_invitations_ws_email_status_expires_created_id_idx"
ON "workspace_invitations"(
    "workspace_id",
    "email",
    "status",
    "expires_at",
    "created_at",
    "id"
);

CREATE INDEX "workspace_invitations_ws_status_expires_created_id_idx"
ON "workspace_invitations"(
    "workspace_id",
    "status",
    "expires_at",
    "created_at",
    "id"
);

CREATE INDEX "workspace_invitations_email_status_expires_created_id_idx"
ON "workspace_invitations"(
    "email",
    "status",
    "expires_at",
    "created_at",
    "id"
);

CREATE INDEX "workspace_invitations_inviter_idx"
ON "workspace_invitations"("invited_by_user_id");

CREATE INDEX "workspace_invitations_accepter_idx"
ON "workspace_invitations"("accepted_by_user_id");

ALTER TABLE "workspace_invitations"
ADD CONSTRAINT "workspace_invitations_workspace_id_fkey"
FOREIGN KEY ("workspace_id")
REFERENCES "wedding_workspaces"("id")
ON DELETE CASCADE
ON UPDATE CASCADE;

ALTER TABLE "workspace_invitations"
ADD CONSTRAINT "workspace_invitations_invited_by_user_id_fkey"
FOREIGN KEY ("invited_by_user_id")
REFERENCES "users"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "workspace_invitations"
ADD CONSTRAINT "workspace_invitations_accepted_by_user_id_fkey"
FOREIGN KEY ("accepted_by_user_id")
REFERENCES "users"("id")
ON DELETE RESTRICT
ON UPDATE CASCADE;

ALTER TABLE "workspace_invitations"
ADD CONSTRAINT "workspace_invitations_superseded_by_invitation_id_fkey"
FOREIGN KEY ("superseded_by_invitation_id")
REFERENCES "workspace_invitations"("id")
ON DELETE NO ACTION
ON UPDATE NO ACTION
DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION "enforce_workspace_invitation_immutability"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF ROW(
        NEW."id",
        NEW."workspace_id",
        NEW."email",
        NEW."role",
        NEW."operation_key",
        NEW."invited_by_user_id",
        NEW."created_at",
        NEW."expires_at"
    ) IS DISTINCT FROM ROW(
        OLD."id",
        OLD."workspace_id",
        OLD."email",
        OLD."role",
        OLD."operation_key",
        OLD."invited_by_user_id",
        OLD."created_at",
        OLD."expires_at"
    ) THEN
        RAISE EXCEPTION 'workspace invitation core fields are immutable'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'workspace_invitations_immutable_core';
    END IF;

    IF OLD."status" <> 'PENDING'::"WorkspaceInvitationStatus"
       AND ROW(
           NEW."status",
           NEW."accepted_by_user_id",
           NEW."accepted_at",
           NEW."revoked_at"
       ) IS DISTINCT FROM ROW(
           OLD."status",
           OLD."accepted_by_user_id",
           OLD."accepted_at",
           OLD."revoked_at"
       ) THEN
        RAISE EXCEPTION 'workspace invitation terminal state is immutable'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'workspace_invitations_immutable_terminal';
    END IF;

    IF OLD."superseded_by_invitation_id" IS NOT NULL
       AND ROW(
           NEW."superseded_by_invitation_id",
           NEW."superseded_at"
       ) IS DISTINCT FROM ROW(
           OLD."superseded_by_invitation_id",
           OLD."superseded_at"
       ) THEN
        RAISE EXCEPTION 'workspace invitation lineage is immutable'
            USING ERRCODE = '23514',
                  CONSTRAINT = 'workspace_invitations_immutable_lineage';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "workspace_invitations_immutability_trigger"
BEFORE UPDATE ON "workspace_invitations"
FOR EACH ROW
EXECUTE FUNCTION "enforce_workspace_invitation_immutability"();
