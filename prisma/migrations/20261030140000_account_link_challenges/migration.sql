CREATE TABLE "account_link_challenges" (
    "token_hash" VARCHAR(64) NOT NULL,
    "user_id" TEXT NOT NULL,
    "session_hash" VARCHAR(64) NOT NULL,
    "provider" VARCHAR(6) NOT NULL,
    "subject" VARCHAR(255),
    "email" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "account_link_challenges_pkey" PRIMARY KEY ("token_hash"),
    CONSTRAINT "account_link_challenges_provider_check" CHECK ("provider" IN ('GOOGLE', 'APPLE')),
    CONSTRAINT "account_link_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "account_link_challenges_session_hash_fkey" FOREIGN KEY ("session_hash") REFERENCES "mobile_sessions"("token_hash") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "account_link_challenges_user_id_idx" ON "account_link_challenges"("user_id");
CREATE INDEX "account_link_challenges_session_hash_idx" ON "account_link_challenges"("session_hash");
