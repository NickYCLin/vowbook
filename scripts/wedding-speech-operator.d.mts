export type WeddingSpeechOperatorKind = "GROOM_PARENTS" | "BRIDE_PARENTS";

export type WeddingSpeechPlan = {
  version: 1;
  speeches: Array<{ kind: WeddingSpeechOperatorKind; content: string }>;
};

export type WeddingSpeechSummary = {
  mode: "dry-run" | "apply";
  applied: boolean;
  create: number;
  conflict: number;
};

export class WeddingSpeechOperatorValidationError extends Error {}
export class WeddingSpeechOperatorConflictError extends Error {}

export const WEDDING_SPEECH_REPOSITORY_ROOT: string;

export function parseWeddingSpeechPlanJson(json: string): WeddingSpeechPlan;
export function parseWeddingSpeechCliArguments(argv: string[]): {
  workspaceId: string;
  confirmWorkspaceId: string;
  actorUserId: string;
  confirmActorUserId: string;
  planPath: string;
  apply: boolean;
};
export function appendWeddingSpeeches(options: {
  client: unknown;
  workspaceId: string;
  actorUserId: string;
  plan: WeddingSpeechPlan;
  apply?: boolean;
}): Promise<WeddingSpeechSummary>;
export function formatWeddingSpeechSummary(summary: WeddingSpeechSummary): string;
export function runWeddingSpeechCli(
  argv: string[],
  dependencies?: Record<string, unknown>,
): Promise<number>;
