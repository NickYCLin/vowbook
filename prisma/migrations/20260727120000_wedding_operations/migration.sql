BEGIN;

-- CreateTable
CREATE TABLE "wedding_staff_assignments" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "role_name" VARCHAR(60) NOT NULL,
    "person_name" VARCHAR(120) NOT NULL,
    "contact_phone" VARCHAR(40),
    "notes" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wedding_staff_assignments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wedding_staff_assignments_role_name_check"
        CHECK (
            char_length("role_name") BETWEEN 1 AND 60
            AND "role_name" ~ '[^[:space:]]'
            AND left("role_name", 1) !~ '[[:space:]]'
            AND right("role_name", 1) !~ '[[:space:]]'
        ),
    CONSTRAINT "wedding_staff_assignments_person_name_check"
        CHECK (
            char_length("person_name") BETWEEN 1 AND 120
            AND "person_name" ~ '[^[:space:]]'
            AND left("person_name", 1) !~ '[[:space:]]'
            AND right("person_name", 1) !~ '[[:space:]]'
        ),
    CONSTRAINT "wedding_staff_assignments_contact_phone_check"
        CHECK (
            "contact_phone" IS NULL OR (
                char_length("contact_phone") BETWEEN 1 AND 40
                AND "contact_phone" ~ '[^[:space:]]'
                AND left("contact_phone", 1) !~ '[[:space:]]'
                AND right("contact_phone", 1) !~ '[[:space:]]'
            )
        ),
    CONSTRAINT "wedding_staff_assignments_notes_check"
        CHECK (
            "notes" IS NULL OR (
                char_length("notes") BETWEEN 1 AND 500
                AND "notes" ~ '[^[:space:]]'
                AND left("notes", 1) !~ '[[:space:]]'
                AND right("notes", 1) !~ '[[:space:]]'
            )
        ),
    CONSTRAINT "wedding_staff_assignments_version_check" CHECK ("version" >= 0)
);

-- CreateTable
CREATE TABLE "wedding_timeline_items" (
    "id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER,
    "phase" VARCHAR(60) NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "location" VARCHAR(120),
    "details" VARCHAR(2000),
    "media_cue" VARCHAR(500),
    "notes" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wedding_timeline_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "wedding_timeline_items_time_check"
        CHECK (
            "start_minute" BETWEEN 0 AND 1439
            AND (
                "end_minute" IS NULL
                OR (
                    "end_minute" BETWEEN 0 AND 1439
                    AND "end_minute" > "start_minute"
                )
            )
        ),
    CONSTRAINT "wedding_timeline_items_phase_check"
        CHECK (
            char_length("phase") BETWEEN 1 AND 60
            AND "phase" ~ '[^[:space:]]'
            AND left("phase", 1) !~ '[[:space:]]'
            AND right("phase", 1) !~ '[[:space:]]'
        ),
    CONSTRAINT "wedding_timeline_items_title_check"
        CHECK (
            char_length("title") BETWEEN 1 AND 120
            AND "title" ~ '[^[:space:]]'
            AND left("title", 1) !~ '[[:space:]]'
            AND right("title", 1) !~ '[[:space:]]'
        ),
    CONSTRAINT "wedding_timeline_items_location_check"
        CHECK (
            "location" IS NULL OR (
                char_length("location") BETWEEN 1 AND 120
                AND "location" ~ '[^[:space:]]'
                AND left("location", 1) !~ '[[:space:]]'
                AND right("location", 1) !~ '[[:space:]]'
            )
        ),
    CONSTRAINT "wedding_timeline_items_details_check"
        CHECK (
            "details" IS NULL OR (
                char_length("details") BETWEEN 1 AND 2000
                AND "details" ~ '[^[:space:]]'
                AND left("details", 1) !~ '[[:space:]]'
                AND right("details", 1) !~ '[[:space:]]'
            )
        ),
    CONSTRAINT "wedding_timeline_items_media_cue_check"
        CHECK (
            "media_cue" IS NULL OR (
                char_length("media_cue") BETWEEN 1 AND 500
                AND "media_cue" ~ '[^[:space:]]'
                AND left("media_cue", 1) !~ '[[:space:]]'
                AND right("media_cue", 1) !~ '[[:space:]]'
            )
        ),
    CONSTRAINT "wedding_timeline_items_notes_check"
        CHECK (
            "notes" IS NULL OR (
                char_length("notes") BETWEEN 1 AND 1000
                AND "notes" ~ '[^[:space:]]'
                AND left("notes", 1) !~ '[[:space:]]'
                AND right("notes", 1) !~ '[[:space:]]'
            )
        ),
    CONSTRAINT "wedding_timeline_items_version_check" CHECK ("version" >= 0)
);

-- CreateTable
CREATE TABLE "wedding_timeline_staff_assignments" (
    "timeline_item_id" TEXT NOT NULL,
    "staff_assignment_id" TEXT NOT NULL,
    "workspace_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wedding_timeline_staff_assignments_pkey"
        PRIMARY KEY ("timeline_item_id", "staff_assignment_id", "workspace_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "wedding_staff_assignments_id_workspace_id_key"
    ON "wedding_staff_assignments"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "wedding_staff_assignments_ws_role_person_created_id_idx"
    ON "wedding_staff_assignments"("workspace_id", "role_name", "person_name", "created_at", "id");

-- CreateIndex
CREATE UNIQUE INDEX "wedding_timeline_items_id_workspace_id_key"
    ON "wedding_timeline_items"("id", "workspace_id");

-- CreateIndex
CREATE INDEX "wedding_timeline_items_ws_start_end_created_id_idx"
    ON "wedding_timeline_items"("workspace_id", "start_minute", "end_minute", "created_at", "id");

-- CreateIndex
CREATE INDEX "wedding_timeline_staff_ws_staff_item_idx"
    ON "wedding_timeline_staff_assignments"("workspace_id", "staff_assignment_id", "timeline_item_id");

-- AddForeignKey
ALTER TABLE "wedding_staff_assignments"
    ADD CONSTRAINT "wedding_staff_assignments_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wedding_timeline_items"
    ADD CONSTRAINT "wedding_timeline_items_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wedding_timeline_staff_assignments"
    ADD CONSTRAINT "wedding_timeline_staff_assignments_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "wedding_workspaces"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wedding_timeline_staff_assignments"
    ADD CONSTRAINT "timeline_staff_timeline_ws_fkey"
    FOREIGN KEY ("timeline_item_id", "workspace_id")
    REFERENCES "wedding_timeline_items"("id", "workspace_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wedding_timeline_staff_assignments"
    ADD CONSTRAINT "timeline_staff_staff_ws_fkey"
    FOREIGN KEY ("staff_assignment_id", "workspace_id")
    REFERENCES "wedding_staff_assignments"("id", "workspace_id")
    ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
