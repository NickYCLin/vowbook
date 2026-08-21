export type BudgetBookingStatus =
  | "PLANNING"
  | "BOOKED_BALANCE_DUE"
  | "PAID";

export type BudgetPrimaryContact = "PARTNER_A" | "PARTNER_B";
export type BudgetItemKind = "GROUP" | "EXPENSE";
export type BudgetCostCategory =
  | "RINGS_KEEPSAKES"
  | "PHOTOGRAPHY_VIDEO"
  | "ATTIRE_STYLING"
  | "VENUE_CATERING"
  | "TRANSPORT_LODGING"
  | "DECOR_GIFTS"
  | "PEOPLE_SERVICES"
  | "OTHER_PENDING";

export type NormalizedNotionBudgetRecord = {
  source: "NOTION";
  externalId: string;
  parentExternalId: string | null;
  sourceOrder: number;
  name: string;
  kind: BudgetItemKind;
  category: BudgetCostCategory | null;
  legacyCategory: string;
  importTaxonomyItemKey: string | null;
  relatedTaxonomyItemKey: string | null;
  plannedAmount: number;
  actualAmount: number | null;
  dueDate: null;
  notes: string | null;
  paid: boolean;
  paidAt: null;
  bookingStatus: BudgetBookingStatus;
  depositAmount: number | null;
  balanceAmount: number | null;
  additionalAmount: number | null;
  estimatedRange: string | null;
  candidateVendors: string | null;
  confirmedVendor: string | null;
  vendorContact: string | null;
  primaryContact: BudgetPrimaryContact | null;
  totalAmount: number;
  rollupAmount: number;
  depth: number;
  sourceHierarchyPath: string[];
  sourceHash: string;
  previousSourceHash: string;
  legacySourceHash: string;
};

export type NotionBudgetManifestAggregates = {
  recordCount: number;
  uniqueExternalIds: number;
  rootCount: number;
  parentCount: number;
  leafCount: number;
  maxDepth: number;
  paidCount: number;
  bookedBalanceDueCount: number;
  planningCount: number;
  rootRollupTotal: number;
  formulaMismatchCount: number;
};

export type NotionBudgetImportSummary = {
  mode: "dry-run" | "apply";
  applied: boolean;
  input: number;
  create: number;
  unchanged: number;
  conflict: number;
  roots: number;
  parents: number;
  maximumDepth: number;
  plannedTotal: string;
};

export class NotionBudgetValidationError extends Error {}
export class NotionBudgetImportError extends Error {}
export const NOTION_BUDGET_REPOSITORY_ROOT: string;

export function parseNormalizedNotionBudgetJson(
  json: string,
): NormalizedNotionBudgetRecord[];
export function computeNotionBudgetManifestAggregates(
  records: NormalizedNotionBudgetRecord[],
): NotionBudgetManifestAggregates;
export function computeNotionBudgetSourceHash(
  record: Partial<NormalizedNotionBudgetRecord>,
): string;
export function parseAndValidateNotionBudgetManifestJson(
  manifestJson: string,
  inputBytes: Uint8Array,
  records: NormalizedNotionBudgetRecord[],
): NotionBudgetManifestAggregates & {
  version: 1;
  source: "NOTION";
  inputSha256: string;
};
export function importNotionBudgetRecords(options: {
  client: unknown;
  workspaceId: string;
  records: NormalizedNotionBudgetRecord[];
  apply?: boolean;
}): Promise<NotionBudgetImportSummary>;
export function formatNotionBudgetImportSummary(
  summary: NotionBudgetImportSummary,
): string;
export function parseNotionBudgetCliArguments(argv: string[]): {
  workspaceId: string;
  confirmWorkspaceId: string;
  inputPath: string;
  manifestPath: string;
  apply: boolean;
};
export function runNotionBudgetCli(
  argv: string[],
  dependencies?: Record<string, unknown>,
): Promise<number>;
