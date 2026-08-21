import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("seating schema and migration contract", () => {
  const schema = fs.readFileSync(
    path.join(process.cwd(), "prisma", "schema.prisma"),
    "utf8",
  );
  const migrationsPath = path.join(process.cwd(), "prisma", "migrations");
  const migration = fs
    .readdirSync(migrationsPath, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.includes("seating"))
    .map((entry) =>
      fs.readFileSync(path.join(migrationsPath, entry.name, "migration.sql"), "utf8"),
    )
    .join("\n");
  const positionMigrationName = "20260731163000_seating_table_positions";
  const positionMigrationPath = path.join(
    migrationsPath,
    positionMigrationName,
    "migration.sql",
  );
  const floorPlanMigrationName = "20260813160000_seating_table_floor_plan";
  const floorPlanMigrationPath = path.join(
    migrationsPath,
    floorPlanMigrationName,
    "migration.sql",
  );
  const duplicateNamesMigrationName =
    "20260817120000_seating_table_duplicate_names";
  const duplicateNamesMigrationPath = path.join(
    migrationsPath,
    duplicateNamesMigrationName,
    "migration.sql",
  );

  it("defines workspace-owned seating tables and stable composite selectors", () => {
    const guestModel = schema.match(/model Guest\s*{[\s\S]*?\n}/)?.[0] ?? "";
    const seatingTableModel =
      schema.match(/model SeatingTable\s*{[\s\S]*?\n}/)?.[0] ?? "";

    expect(schema).toMatch(/model SeatingTable\s*{/);
    expect(schema).toMatch(/seatingTables\s+SeatingTable\[\]/);
    expect(schema).toMatch(/seatingTableId\s+String\?/);
    expect(schema).toMatch(
      /seatingTable\s+SeatingTable\?[\s\S]*fields:\s*\[seatingTableId, workspaceId\][\s\S]*references:\s*\[id, workspaceId\][\s\S]*onDelete:\s*NoAction/,
    );
    expect(seatingTableModel).not.toMatch(/@@unique\(\[workspaceId, name\]\)/);
    expect(guestModel).toMatch(/@@unique\(\[id, workspaceId\]\)/);
    expect(seatingTableModel).toMatch(/@@unique\(\[id, workspaceId\]\)/);
    expect(seatingTableModel).toMatch(/position\s+Int/);
    expect(seatingTableModel).toMatch(/version\s+Int\s+@default\(0\)/);
    expect(seatingTableModel).toMatch(/layoutX\s+Int\?\s+@map\("layout_x"\)/);
    expect(seatingTableModel).toMatch(/layoutY\s+Int\?\s+@map\("layout_y"\)/);
    expect(seatingTableModel).toMatch(/@@unique\(\[workspaceId, position\]\)/);
    expect(schema).toMatch(/@@index\(\[workspaceId, seatingTableId\]\)/);
    expect(guestModel).not.toMatch(/onDelete:\s*SetNull/);
  });

  it("allows repeated table labels while preserving table identity by position", () => {
    expect(fs.existsSync(duplicateNamesMigrationPath)).toBe(true);
    const duplicateNamesMigration = fs.readFileSync(
      duplicateNamesMigrationPath,
      "utf8",
    );

    expect(duplicateNamesMigration).toContain(
      'DROP INDEX "seating_tables_workspace_id_name_key"',
    );
    expect(duplicateNamesMigration).not.toMatch(
      /DROP INDEX\s+"seating_tables_workspace_id_position_key"/u,
    );
  });

  it("adds nullable paired bounded floor-plan coordinates without backfilling legacy rows", () => {
    expect(fs.existsSync(floorPlanMigrationPath)).toBe(true);
    const floorPlanMigration = fs.readFileSync(floorPlanMigrationPath, "utf8");

    expect(floorPlanMigration).toContain(
      'ADD COLUMN "layout_x" INTEGER',
    );
    expect(floorPlanMigration).toContain(
      'ADD COLUMN "layout_y" INTEGER',
    );
    expect(floorPlanMigration).toContain(
      'CONSTRAINT "seating_tables_layout_pair_range_check"',
    );
    expect(floorPlanMigration).toMatch(
      /\("layout_x" IS NULL AND "layout_y" IS NULL\)[\s\S]*"layout_x" IS NOT NULL[\s\S]*"layout_y" IS NOT NULL[\s\S]*"layout_x" BETWEEN 0 AND 1000[\s\S]*"layout_y" BETWEEN 0 AND 1000/u,
    );
    expect(floorPlanMigration).not.toMatch(/\bUPDATE\s+"seating_tables"/iu);
    expect(floorPlanMigration).not.toMatch(/SET\s+NOT\s+NULL/iu);
  });

  it("creates constraints and indexes without allowing a table delete to delete guests", () => {
    expect(migration).toContain('CREATE TABLE "seating_tables"');
    expect(migration).toContain('CONSTRAINT "seating_tables_name_length_check"');
    expect(migration).toContain('CONSTRAINT "seating_tables_capacity_check"');
    expect(migration).toContain('CONSTRAINT "seating_tables_notes_length_check"');
    expect(migration).toMatch(
      /"name" = btrim\("name"\) AND char_length\("name"\) BETWEEN 1 AND 80/,
    );
    expect(migration).toMatch(/"capacity" BETWEEN 1 AND 100/);
    expect(migration).toMatch(/char_length\("notes"\) <= 500/);
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "seating_tables_workspace_id_name_key"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "seating_tables_id_workspace_id_key"',
    );
    expect(migration).toContain(
      'CREATE INDEX "seating_tables_workspace_id_created_at_id_idx"',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "guests_id_workspace_id_key"',
    );
    expect(migration).toContain(
      'CREATE INDEX "guests_workspace_id_seating_table_id_idx"',
    );
    expect(migration).toMatch(
      /FOREIGN KEY \("seating_table_id", "workspace_id"\)[\s\S]*REFERENCES "seating_tables"\("id", "workspace_id"\)[\s\S]*ON DELETE NO ACTION/,
    );
    expect(migration).not.toMatch(
      /FOREIGN KEY \("seating_table_id"\)[\s\S]*ON DELETE CASCADE/,
    );
  });

  it("adds positions in an independent migration with deterministic tenant-scoped backfill", () => {
    expect(fs.existsSync(positionMigrationPath)).toBe(true);
    const positionMigration = fs.readFileSync(positionMigrationPath, "utf8");
    expect(positionMigration).toContain(
      'ALTER TABLE "seating_tables" ADD COLUMN "position" INTEGER',
    );
    expect(positionMigration).toMatch(
      /ROW_NUMBER\(\) OVER \(\s*PARTITION BY "workspace_id"\s*ORDER BY "created_at", "id"\s*\)/u,
    );
    expect(positionMigration).toContain(
      'ALTER COLUMN "position" SET NOT NULL',
    );
    expect(positionMigration).toContain(
      'ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0',
    );
    expect(positionMigration).toContain(
      'CONSTRAINT "seating_tables_position_check" CHECK ("position" > 0)',
    );
    expect(positionMigration).toContain(
      'CREATE UNIQUE INDEX "seating_tables_workspace_id_position_key"',
    );

    const genericMigration = fs.readFileSync(
      path.join(
        migrationsPath,
        "20260729222233_generic_guest_import_sources",
        "migration.sql",
      ),
      "utf8",
    );
    expect(genericMigration).not.toContain(
      'ALTER TABLE "seating_tables" ADD COLUMN "position"',
    );
  });
});
