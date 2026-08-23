import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const runner = readFileSync(
  path.join(process.cwd(), "scripts/postgres-integration-command.mjs"),
  "utf8",
);

describe("PostgreSQL canonical integration runner", () => {
  it("runs fresh-chain, prior-head, and production-like drift gates in isolated schemas", () => {
    expect(runner).toContain("freshSchemaName");
    expect(runner).toContain("upgradeSchemaName");
    expect(runner).toContain("productionDriftSchemaName");
    expect(runner).toContain("runPriorHeadUpgrade");
    expect(runner).toContain("runProductionDriftRepair");
    expect(runner).toMatch(/migrationEntries\.at\(-1\)/);
    expect(runner).toMatch(/migrationEntries\.at\(-2\)/);
    expect(runner).toMatch(/migrationEntries\.at\(-3\)/);
    expect(runner).toMatch(/migrationEntries\.at\(-4\)/);
    expect(runner).toMatch(/migrationEntries\.at\(-5\)/);
    expect(runner).toMatch(/migrationEntries\.at\(-6\)/);
    expect(runner).toMatch(/migrationEntries\.at\(-7\)/);
    expect(runner).toMatch(/migrationEntries\.at\(-8\)/);
    expect(runner).toMatch(/migrationEntries\.at\(-9\)/);
    expect(runner).toMatch(/migrationEntries\.at\(-10\)/);
    expect(runner).toMatch(/migrationEntries\.at\(-11\)/);
    expect(runner).toMatch(/migrationEntries\.at\(-12\)/);
    expect(runner).toMatch(/migrationEntries\.at\(-13\)/);
    expect(runner).toMatch(/migrationEntries\.at\(-14\)/);
    expect(runner).toMatch(/migrationEntries\.at\(-15\)/);
    expect(runner).toMatch(/migrationEntries\.at\(-16\)/);
    expect(runner).toContain("userAccessMigration");
    expect(runner).toContain("avatarMigration");
    expect(runner).toContain("guestDetailsMigration");
    expect(runner).toContain("taskSidesMigration");
    expect(runner).toContain("rosterCategoriesMigration");
    expect(runner).toContain("duplicateNamesMigration");
    expect(runner).toContain("floorPlanMigration");
    expect(runner).toContain("priorHeadMigration");
    expect(runner).toContain("preparationSuggestionMigration");
    expect(runner).toContain("engagementSuggestionMigration");
    expect(runner).toContain("proposalLabelMigration");
    expect(runner).toContain("repairMigration");
    expect(runner).toContain("sourceHierarchyMigration");
    expect(runner).toContain("relatedTaxonomyMigration");
    expect(runner).toContain("migrationEntries.slice(0, priorHeadPosition)");
    expect(runner).toContain("mkdtempSync");
    expect(runner).toContain('path.join(process.cwd(), ".tmp-prior-head-")');
    expect(runner).toContain(
      'path.join(process.cwd(), ".tmp-production-drift-head-")',
    );
    expect(runner).not.toContain(
      'path.join(process.cwd(), ".loops", ".tmp-prior-head-")',
    );
  });

  it("seeds the prior head with version-stable SQL before verifying the upgraded client", () => {
    const seedSection = runner.slice(
      runner.indexOf("async function seedPriorHeadData"),
      runner.indexOf("const upgradeStatus"),
    );

    expect(seedSection.match(/INSERT INTO "users"/gu)).toHaveLength(2);
    expect(seedSection).toContain("legacyCollisionUserEmail");
    expect(seedSection).toContain("legacyCollisionUserId");
    expect(seedSection).toContain('INSERT INTO "wedding_workspaces"');
    expect(seedSection).toContain('INSERT INTO "memberships"');
    expect(seedSection).toContain('INSERT INTO "seating_tables"');
    expect(seedSection).toContain('"id", "workspace_id", "position", "name", "capacity"');
    expect(seedSection.match(/INSERT INTO "guests"/gu)).toHaveLength(4);
    expect(seedSection).toContain('INSERT INTO "wedding_tasks"');
    expect(seedSection.match(/INSERT INTO "guest_rsvps"/gu)).toHaveLength(3);
    expect(seedSection).toContain("prior_target_linein_default");
    expect(seedSection).toContain("prior_linein_secondary");
    expect(seedSection).toContain("prior_future_rsvp");
    expect(seedSection).toContain("prior_unrelated_guest");
    expect(seedSection).not.toContain('"GuestRsvpSource"');
    expect(seedSection).toContain('INSERT INTO "guest_import_batches"');
    expect(seedSection).toContain('INSERT INTO "guest_import_batch_rows"');
    expect(seedSection).toContain('"GuestManagedField"');
    expect(seedSection).toContain('INSERT INTO "budget_items"');
    expect(seedSection.match(/INSERT INTO "budget_items"/gu)).toHaveLength(5);
    expect(seedSection).toContain('"booking_status"');
    expect(seedSection).toContain('"deposit_amount"');
    expect(seedSection).toContain('"balance_amount"');
    expect(seedSection).toContain('"additional_amount"');
    expect(seedSection).toContain('CAST(${"MANUAL"} AS "BudgetItemSource")');
    expect(seedSection).toContain(
      'CAST(${"BOOKED_BALANCE_DUE"} AS "BudgetBookingStatus")',
    );
    expect(seedSection).not.toMatch(
      /\.(?:user|weddingWorkspace|membership|seatingTable|guest|weddingTask|guestImportRecord|budgetItem)\.create\(/,
    );
    expect(runner).toContain("upgradedClient.weddingTask.count");
    expect(runner).toContain("upgradedClient.guestImportRecord.count");
    expect(runner).toContain("upgradedClient.guestImportRecord.findUnique");
    expect(runner).toContain("storedGuest?.seatingTableId !== tableId");
    expect(runner).toContain("storedTable?.layoutX !== null");
    expect(runner).toContain("storedTable?.layoutY !== null");
    expect(runner).toContain("upgradedClient.budgetItem.count");
    expect(runner).toContain("storedTask?.workspaceId !== workspaceId");
    expect(runner).toContain('storedTask?.side !== "SHARED"');
    expect(runner).toContain("storedRsvp?.workspaceId !== workspaceId");
    expect(runner).toContain("storedRsvp?.id !== guestId");
    expect(runner).toContain('storedRsvp?.source !== "LINEIN"');
    expect(runner).toContain('storedRsvp?.sourceLabel !== "拍拍印"');
    expect(runner).toContain("storedRsvp?.sourceManaged !== true");
    expect(runner).toContain("storedRsvp?.sourcePartySize !== 3");
    expect(runner).toContain('"NAME,SIDE,ATTENDANCE_STATUS"');
    expect(runner).toContain("storedGuest?.partySize !== 3");
    expect(runner).toContain("storedRsvp?.createdAt?.toISOString()");
    expect(runner).toContain("storedRsvp?.updatedAt?.toISOString()");
  });

  it("runs Guest RSVP PostgreSQL invariants in the canonical fresh-chain gate", () => {
    expect(runner).toContain("src/test/postgres-guest-rsvp.integration.test.ts");
    expect(runner).toContain("src/test/postgres-profile-avatar.integration.test.ts");
    expect(runner).toContain("src/test/postgres-user-access.integration.test.ts");
  });

  it("runs workspace invitation races and preserves prior-head invitation state", () => {
    expect(runner).toContain(
      "src/test/postgres-workspace-invitations.integration.test.ts",
    );
    expect(runner).toContain("upgradedClient.workspaceInvitation.count");
    expect(runner).toContain("workspaceInvitations !== 0");
    expect(runner).toContain("migration_name = ${priorHeadMigration}");
    expect(runner).toContain("migration_name = ${guestDetailsMigration}");
    expect(runner).toContain("migration_name = ${userAccessMigration}");
    expect(runner).toContain(
      "preserved all scalar provenance values for LINEIN/secondary and FUTURE_RSVP",
    );
    expect(runner).toContain("usersEmailConstraint");
    expect(runner).toContain('"users_email_check"');
    expect(runner).toContain("priorUserEmail");
    expect(runner).toContain("storedCollisionUser");
    expect(runner).toContain("users !== 2");
    expect(runner).toContain("storedCollisionUser?.email !== priorUserEmail");
    expect(runner).toContain("usersEmailUniqueIndex");
    expect(runner).toContain("usersEmailIndexes");
    expect(runner).toContain("prior-${runId}@example.test");
    expect(runner).toContain("migrationEntries.length !== 31");
    expect(runner).toContain(
      'userAccessMigration !== "20260824004000_user_access_admin"',
    );
    expect(runner).toContain(
      'guestDetailsMigration !==\n    "20260823155000_guest_details_invitation_reply_optional"',
    );
    expect(runner).toContain("priorHeadPosition !== 16");
    expect(runner).toContain('storedPriorUser?.accessStatus !== "ACTIVE"');
    expect(runner).toContain("storedPriorUser?.accessStatusChangedAt !== null");
    expect(runner).toContain("storedPriorUser?.lastLoginAt !== null");
    expect(runner).toContain("storedPriorUser?.version !== 0");
    expect(runner).toContain("priorGuestSnapshotSelect");
    expect(runner).toContain("select: priorGuestSnapshotSelect");
    expect(runner).toContain(
      'avatarMigration !== "20260823153000_user_profile_avatar"',
    );
    expect(runner).toContain(
      'taskSidesMigration !== "20260822130000_wedding_task_sides"',
    );
    expect(runner).toContain(
      'rosterCategoriesMigration !==\n    "20260822120000_guest_roster_categories"',
    );
    expect(runner).toContain(
      'duplicateNamesMigration !==\n    "20260817120000_seating_table_duplicate_names"',
    );
    expect(runner).toContain(
      'floorPlanMigration !== "20260813160000_seating_table_floor_plan"',
    );
    expect(runner).toContain(
      'preparationSuggestionMigration !==\n    "20260805130000_budget_preparation_suggestion_key"',
    );
    expect(runner).toContain(
      'engagementSuggestionMigration !==\n    "20260805120000_budget_engagement_suggestion_key"',
    );
    expect(runner).toContain(
      'proposalLabelMigration !== "20260804150000_budget_proposal_label"',
    );
    expect(runner).toContain(
      'repairMigration !== "20260804140000_budget_fixed_taxonomy_drift_repair"',
    );
    expect(runner).toContain(
      'sourceHierarchyMigration !== "20260804113000_budget_notion_source_hierarchy_path"',
    );
    expect(runner).toContain(
      'relatedTaxonomyMigration !== "20260803170000_budget_related_taxonomy_item"',
    );
    expect(runner).toContain(
      'fixedGroupsMigration !== "20260803120000_budget_fixed_category_groups"',
    );
    expect(runner).toContain(
      'failClosedMigration !== "20260802152000_linein_party_size_fail_closed"',
    );
    expect(runner).toContain(
      'priorHeadMigration !== "20260802151000_linein_party_size_ownership"',
    );
    expect(runner).toContain("migration_name = ${failClosedMigration}");
    expect(runner).toContain("migration_name = ${fixedGroupsMigration}");
    expect(runner).toContain("migration_name = ${relatedTaxonomyMigration}");
    expect(runner).toContain("migration_name = ${sourceHierarchyMigration}");
    expect(runner).toContain("migration_name = ${repairMigration}");
    expect(runner).toContain("migration_name = ${proposalLabelMigration}");
    expect(runner).toContain(
      'migration_name = ${preparationSuggestionMigration}',
    );
    expect(runner).toContain(
      'migration_name = ${engagementSuggestionMigration}',
    );
    expect(runner).toContain("migration_name = ${floorPlanMigration}");
    expect(runner).toContain("migration_name = ${rosterCategoriesMigration}");
    expect(runner).toContain("migration_name = ${taskSidesMigration}");
    expect(runner).toContain("migration_name = ${avatarMigration}");
    expect(runner).toContain("appliedDuplicateNames");
    expect(runner).toContain("appliedRosterCategories");
    expect(runner).toContain("appliedTaskSides");
    expect(runner).toContain("appliedAvatar");
    expect(runner).toContain("userAvatars !== 0");
    expect(runner).toContain('storedGuest?.category !== "GUEST"');
    expect(runner).toContain("duplicateNameIndexes");
    expect(runner).toContain("seating_tables_workspace_id_name_key");
    expect(runner).toContain("fixedTaxonomyNodes.length === 28");
    expect(runner).toContain('.filter((key) => key.startsWith("ITEM_"))');
    expect(runner).toContain(
      'fixedTaxonomyByKey.get("ITEM_PROPOSAL")?.name === "求婚"',
    );
    expect(runner).toContain("expectedStageKeys.size === 7");
    expect(runner).toContain("expectedItemParentKeys.size === 21");
    expect(runner).toContain("storedTable?.position !== 1");
    expect(runner).toContain(
      "preserved the table ID, name, capacity, position, and target Guest assignment",
    );
    expect(runner).toContain("normalized the stale LINEIN/default target");
    expect(runner).toContain(
      '"guest_rsvps_linein_default_no_party_size_check"',
    );
    expect(runner).toContain("lineinPartySizeConstraint[0]?.validated !== true");
    expect(runner).toContain("storedGuestSnapshots !== priorGuestSnapshots");
    expect(runner).toContain("storedRsvpSnapshots !== expectedRsvpSnapshots");
    expect(runner).toContain("guests !== 4");
    expect(runner).toContain("rsvps !== 3");
    expect(runner).toContain("preserved all scalar values across 4 Guests");
    expect(runner).toContain(
      "changed only the target sourcePartySize, managedFields, sourceManaged, and updatedAt values",
    );
  });

  it("runs wedding operations invariants and verifies empty prior-head tables", () => {
    expect(runner).toContain(
      "src/test/postgres-wedding-operations.integration.test.ts",
    );
    expect(runner).toContain("upgradedClient.weddingStaffAssignment.count");
    expect(runner).toContain("upgradedClient.weddingTimelineItem.count");
    expect(runner).toContain(
      "upgradedClient.weddingTimelineStaffAssignment.count",
    );
    expect(runner).toContain("weddingTimelineStaffAssignments !== 0");
  });

  it("runs Budget invariants and preserves the prior-head Budget fixtures", () => {
    expect(runner).toContain("src/test/postgres-budget.integration.test.ts");
    expect(runner).toContain(
      "src/test/postgres-budget-attachments.integration.test.ts",
    );
    expect(runner).toContain('INSERT INTO "wedding_tasks"');
    expect(runner).toContain('INSERT INTO "guest_rsvps"');
    expect(runner).toContain("budgetItems !== 33");
    expect(runner).toContain("fixedTaxonomyTopologyIsValid");
    expect(runner).toContain("systemTaxonomyKey: { not: null }");
    expect(runner).toContain(
      'fixedTaxonomyByKey.get(\n      "INTERNAL_UNCLASSIFIED_ITEM",',
    );
    expect(runner).toContain(
      "storedPlanningBudget?.parentId !== internalItemId",
    );
    expect(runner).toContain(
      "storedNeutralGroup?.parentId !== internalItemId",
    );
    expect(runner).toContain('storedPlanningBudget?.source !== "MANUAL"');
    expect(runner).toContain(
      'storedPlanningBudget?.bookingStatus !== "PLANNING"',
    );
    expect(runner).toContain("storedPlanningBudget?.actualAmount !== 120000");
    expect(runner).toContain("storedPlanningBudget?.version !== 8");
    expect(runner).toContain(
      'storedBookedBudget?.bookingStatus !== "BOOKED_BALANCE_DUE"',
    );
    expect(runner).toContain("storedBookedBudget?.actualAmount !== 444444");
    expect(runner).toContain("storedBookedBudget?.version !== 9");
    expect(runner).toContain('storedPaidBudget?.bookingStatus !== "PAID"');
    expect(runner).toContain("storedPaidBudget?.actualAmount !== 650000");
    expect(runner).toContain("storedPaidBudget?.paidAt?.toISOString()");
    expect(runner).toContain("storedPaidBudget?.version !== 10");
    expect(runner).toContain('storedNeutralGroup?.kind !== "GROUP"');
    expect(runner).toContain("storedNeutralGroup?.category !== null");
    expect(runner).toContain(
      'storedKnownChild?.category !== "VENUE_CATERING"',
    );
    expect(runner).toContain("verified prior-head task, audit, Budget");
    expect(runner).toContain(
      '"budget_items_related_taxonomy_item_key_check"',
    );
    expect(runner).toContain(
      "budgetRelatedTaxonomyConstraint[0]?.validated !== true",
    );
    expect(runner).toContain(
      '"budget_items_source_hierarchy_path_check"',
    );
    expect(runner).toContain(
      "budgetSourceHierarchyPathConstraint[0]?.validated !== true",
    );
    expect(runner).toContain(
      "budgetTaxonomyNameConstraint[0]?.validated !== true",
    );
    expect(runner).toContain(
      'budgetTaxonomyNameConstraint[0]?.definition?.includes("求婚")',
    );
    expect(runner).toContain("storedPlanningBudget?.relatedTaxonomyItemKey !== null");
    expect(runner).toContain(
      "storedPlanningBudget?.sourceHierarchyPath.length !== 0",
    );
    expect(runner).toContain('"kind", "category", "legacy_category"');
    expect(runner).toContain('AS "BudgetItemKind"');
    expect(runner).toContain('AS "BudgetCostCategory"');
    expect(runner).toContain("migration_name = ${repairMigration}");
    expect(runner).toContain("storedTask");
    expect(runner).toContain("storedRsvp");
    expect(runner).toContain("upgradedClient.budgetAttachment.count");
    expect(runner).toContain("budgetAttachments !== 0");
  });

  it("models and verifies the exact production-like modified-checksum drift", () => {
    const driftSection = runner.slice(
      runner.indexOf("function prepareProductionDriftMigrations"),
      runner.indexOf("async function dropSchema"),
    );

    expect(driftSection).toContain("production_like_original_marked_applied");
    expect(driftSection).toContain('ADD COLUMN "system_category"');
    expect(driftSection).toContain("productionDriftCategories");
    expect(driftSection).toContain("rootCount !== 8");
    expect(driftSection).toContain("categoryCount !== 8");
    expect(driftSection).toContain('"checksum"');
    expect(driftSection).toContain("checkedInFixedChecksum === driftFixedChecksum");
    expect(driftSection).toContain("storedFixedMigration?.checksum !== driftFixedChecksum");
    expect(driftSection).toContain('"related_taxonomy_item_key" = \'ITEM_PRE_WEDDING_PHOTOGRAPHY\'');
    expect(driftSection).toContain("拍攝婚紗/服裝與造型/小白鞋");
    expect(driftSection).toContain("snapshotProductionDriftAttachments");
    expect(driftSection).toContain("snapshotProductionDriftChildren");
    expect(driftSection).toContain("snapshotProductionDriftOrdinaryRows");
    expect(driftSection).toContain("to_jsonb(\"child\")");
    expect(driftSection).toContain("- 'system_category'");
    expect(driftSection).toContain("- 'system_taxonomy_key'");
    expect(driftSection).toContain("- 'suggestion_key'");
    expect(driftSection).toContain("beforeRoots.length !== 16");
    expect(driftSection).toContain("postRepairCounts?.ordinaryRows !== 20");
    expect(driftSection).toContain("row.nodeCount !== 28");
    expect(driftSection).toContain("row.stageCount !== 7");
    expect(driftSection).toContain("row.itemCount !== 21");
    expect(driftSection).toContain("row.publicItemCount !== 20");
    expect(driftSection).toContain("fixedTaxonomyExpectedParents.size === 28");
    expect(driftSection).toContain("taxonomyNodes.length === 56");
    expect(driftSection).toContain("node.parentKey === fixedTaxonomyExpectedParents.get(node.key)");
    expect(driftSection).toContain(
      'node.key !== "ITEM_PROPOSAL" || node.name === "求婚"',
    );
    expect(driftSection).toContain("proposalLabelConstraintExact !== true");
    expect(driftSection).toContain('"index_meta"."indpred" IS NULL');
    expect(driftSection).toContain('"index_meta"."indexprs" IS NULL');
    expect(driftSection).toContain("afterAttachmentSnapshot?.digest");
    expect(driftSection).toContain("afterChildSnapshot?.digest");
    expect(driftSection).toContain("afterOrdinarySnapshot?.digest");
    expect(driftSection).toContain("root.version === before.version + 1");
    expect(driftSection).toContain("repairedHistory.length !== 1");
    expect(driftSection).toContain("proposalLabelHistory.length !== 1");
    expect(driftSection).toContain("snapshotAllBudgetRows");
    expect(driftSection).toContain("currentHeadNoOpStatus");
    expect(driftSection).toContain(
      'throw new Error("current-head migration no-op verification failed")',
    );
    expect(driftSection).toContain(
      "afterNoOpBudgetSnapshot?.digest !== currentHeadBudgetSnapshot?.digest",
    );
    expect(driftSection).toContain("appliedProposalLabels.length !== 1");
  });

  it("always removes all temporary schemas and copied migration trees", () => {
    expect(runner).toMatch(/dropSchema\(freshSchemaName/);
    expect(runner).toMatch(/dropSchema\(upgradeSchemaName/);
    expect(runner).toMatch(/dropSchema\(\s*productionDriftSchemaName/);
    expect(runner).toContain("rmSync(priorHeadDirectory");
    expect(runner).toContain("rmSync(productionDriftDirectory");
  });
});
