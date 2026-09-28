CREATE TABLE "mobile_login_grants" (
  "code_hash" VARCHAR(64) PRIMARY KEY,
  "challenge" VARCHAR(43) NOT NULL,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "expires_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "mobile_login_grants_user_id_idx" ON "mobile_login_grants"("user_id");
CREATE INDEX "mobile_login_grants_expires_at_idx" ON "mobile_login_grants"("expires_at");
CREATE TABLE "mobile_sessions" (
  "token_hash" VARCHAR(64) PRIMARY KEY,
  "user_id" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "expires_at" TIMESTAMPTZ(3) NOT NULL
);
CREATE INDEX "mobile_sessions_user_id_idx" ON "mobile_sessions"("user_id");
CREATE INDEX "mobile_sessions_expires_at_idx" ON "mobile_sessions"("expires_at");
