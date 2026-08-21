-- CreateEnum
CREATE TYPE "GuestRsvpSource" AS ENUM ('LINEIN');

-- CreateEnum
CREATE TYPE "InvitationDelivery" AS ENUM ('PAPER', 'DIGITAL', 'NONE', 'UNKNOWN');

-- CreateTable
CREATE TABLE "guest_rsvps" (
    "guest_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "source" "GuestRsvpSource" NOT NULL,
    "external_id" VARCHAR(191) NOT NULL,
    "relationship_label" VARCHAR(100) NOT NULL,
    "contact_phone" VARCHAR(40) NOT NULL,
    "contact_email" VARCHAR(254),
    "ceremony_attendance" BOOLEAN,
    "child_seat_count" INTEGER NOT NULL DEFAULT 0,
    "vegetarian_count" INTEGER NOT NULL DEFAULT 0,
    "invitation_delivery" "InvitationDelivery" NOT NULL,
    "mailing_address" VARCHAR(500),
    "guest_message" VARCHAR(1000),
    "attendance_reply" VARCHAR(120) NOT NULL,
    "invitation_reply" VARCHAR(120),
    "source_submitted_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_rsvps_pkey" PRIMARY KEY ("guest_id"),
    CONSTRAINT "guest_rsvps_external_id_check" CHECK (char_length("external_id") BETWEEN 1 AND 191 AND char_length(btrim("external_id")) >= 1),
    CONSTRAINT "guest_rsvps_relationship_label_check" CHECK ("relationship_label" = btrim("relationship_label") AND char_length("relationship_label") BETWEEN 1 AND 100),
    CONSTRAINT "guest_rsvps_contact_phone_check" CHECK ("contact_phone" = btrim("contact_phone") AND char_length("contact_phone") BETWEEN 1 AND 40),
    CONSTRAINT "guest_rsvps_contact_email_check" CHECK ("contact_email" IS NULL OR ("contact_email" = btrim("contact_email") AND char_length("contact_email") >= 1 AND char_length("contact_email") <= 254)),
    CONSTRAINT "guest_rsvps_child_seat_count_check" CHECK ("child_seat_count" BETWEEN 0 AND 20),
    CONSTRAINT "guest_rsvps_vegetarian_count_check" CHECK ("vegetarian_count" BETWEEN 0 AND 20),
    CONSTRAINT "guest_rsvps_mailing_address_check" CHECK ("mailing_address" IS NULL OR ("mailing_address" = btrim("mailing_address") AND char_length("mailing_address") >= 1 AND char_length("mailing_address") <= 500)),
    CONSTRAINT "guest_rsvps_guest_message_check" CHECK ("guest_message" IS NULL OR ("guest_message" = btrim("guest_message") AND char_length("guest_message") >= 1 AND char_length("guest_message") <= 1000)),
    CONSTRAINT "guest_rsvps_attendance_reply_check" CHECK ("attendance_reply" = btrim("attendance_reply") AND char_length("attendance_reply") BETWEEN 1 AND 120),
    CONSTRAINT "guest_rsvps_invitation_reply_check" CHECK ("invitation_reply" IS NULL OR ("invitation_reply" = btrim("invitation_reply") AND char_length("invitation_reply") BETWEEN 1 AND 120)),
    CONSTRAINT "guest_rsvps_paper_address_check" CHECK ("invitation_delivery" <> 'PAPER' OR "mailing_address" IS NOT NULL),
    CONSTRAINT "guest_rsvps_invitation_state_check" CHECK (
      ("invitation_delivery" = 'UNKNOWN' AND "invitation_reply" IS NULL)
      OR ("invitation_delivery" = 'PAPER' AND "mailing_address" IS NOT NULL AND "invitation_reply" IS NOT NULL)
      OR ("invitation_delivery" IN ('DIGITAL', 'NONE') AND "invitation_reply" IS NOT NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "guest_rsvps_guest_id_workspace_id_key" ON "guest_rsvps"("guest_id", "workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "guest_rsvps_workspace_id_source_external_id_key" ON "guest_rsvps"("workspace_id", "source", "external_id");

-- CreateIndex
CREATE INDEX "guest_rsvps_ws_submitted_guest_idx" ON "guest_rsvps"("workspace_id", "source_submitted_at", "guest_id");

-- AddForeignKey
ALTER TABLE "guest_rsvps" ADD CONSTRAINT "guest_rsvps_guest_id_workspace_id_fkey" FOREIGN KEY ("guest_id", "workspace_id") REFERENCES "guests"("id", "workspace_id") ON DELETE CASCADE ON UPDATE CASCADE;
