-- Guest contact and RSVP details are editable outside any importer. The
-- normalized delivery choice can stand on its own; a source-specific reply is
-- optional, while paper delivery still requires an address.
ALTER TABLE "guest_rsvps"
  DROP CONSTRAINT "guest_rsvps_invitation_state_check",
  ADD CONSTRAINT "guest_rsvps_invitation_state_check" CHECK (
    ("invitation_delivery" IS NULL AND "invitation_reply" IS NULL)
    OR (
      "invitation_delivery" = 'UNKNOWN'
      AND "invitation_reply" IS NULL
    )
    OR (
      "invitation_delivery" = 'PAPER'
      AND "mailing_address" IS NOT NULL
    )
    OR "invitation_delivery" IN ('DIGITAL', 'NONE')
  );
