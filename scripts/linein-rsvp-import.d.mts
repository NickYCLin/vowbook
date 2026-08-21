export type NormalizedLineinRsvpRecord = {
  source: "LINEIN";
  externalUserId: string;
  name: string;
  side: "PARTNER_A" | "PARTNER_B" | "SHARED";
  relationshipLabel: string;
  phone: string;
  email: string | null;
  attendanceStatus: "ATTENDING" | "DECLINED";
  attendanceReply: string;
  ceremonyAttendance: boolean | null;
  partySize: number;
  childSeatCount: number;
  vegetarianCount: number;
  invitationDelivery: "PAPER" | "DIGITAL" | "NONE" | "UNKNOWN";
  invitationReply: string | null;
  mailingAddress: string | null;
  message: string | null;
  respondedAt: Date;
};

export type LineinRsvpImportSummary = {
  mode: "dry-run" | "apply";
  applied: boolean;
  input: number;
  create: number;
  update: number;
  unchanged: number;
  conflict: number;
  attendingGroups: number;
  declinedGroups: number;
  attendingPartySize: number;
};

export class LineinRsvpValidationError extends Error {}
export class LineinRsvpImportError extends Error {}
export const LINEIN_RSVP_REPOSITORY_ROOT: string;

export type LineinRsvpManifestAggregates = {
  recordCount: number;
  uniqueExternalIds: number;
  partnerA: number;
  partnerB: number;
  shared: number;
  attending: number;
  declined: number;
  attendingPartySize: number;
  childSeatCount: number;
  vegetarianCount: number;
  unknownInvitation: number;
};

export type LineinRsvpManifest = LineinRsvpManifestAggregates & {
  version: 1;
  source: "LINEIN";
  inputSha256: string;
};

export function parseNormalizedLineinRsvpJson(
  json: string,
): NormalizedLineinRsvpRecord[];

export function computeLineinRsvpManifestAggregates(
  records: NormalizedLineinRsvpRecord[],
): LineinRsvpManifestAggregates;

export function parseAndValidateLineinRsvpManifestJson(
  manifestJson: string,
  inputBytes: Uint8Array,
  records: NormalizedLineinRsvpRecord[],
): LineinRsvpManifest;

export function importLineinRsvpRecords(options: {
  client: unknown;
  workspaceId: string;
  records: NormalizedLineinRsvpRecord[];
  apply?: boolean;
}): Promise<LineinRsvpImportSummary>;

export function formatLineinRsvpImportSummary(
  summary: LineinRsvpImportSummary,
): string;

export function parseLineinRsvpCliArguments(argv: string[]): {
  workspaceId: string;
  confirmWorkspaceId: string;
  inputPath: string;
  manifestPath: string;
  apply: boolean;
};

export function readVerifiedExternalFileBytes(
  resolvedRepositoryRoot: string,
  resolvedFilePath: string,
): Promise<Buffer>;

export function runLineinRsvpCli(
  argv: string[],
  dependencies?: Record<string, unknown>,
): Promise<number>;
