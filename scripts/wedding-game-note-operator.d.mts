export type WeddingGameNoteUpdate = {
  participantId: string;
  game: "BOUQUET" | "BROCCOLI";
  name: string;
  expectedVersion: number;
  note: string;
};

export type WeddingGameNotePlan = { version: 1; updates: WeddingGameNoteUpdate[] };

export type WeddingGameNoteSummary = {
  mode: "dry-run" | "apply";
  applied: boolean;
  update: number;
  conflict: number;
};

export class WeddingGameNoteValidationError extends Error {}
export class WeddingGameNoteConflictError extends Error {}

export const WEDDING_GAME_NOTE_REPOSITORY_ROOT: string;

export function parseWeddingGameNotePlanJson(json: string): WeddingGameNotePlan;
export function parseWeddingGameNoteCliArguments(argv: string[]): {
  workspaceId: string;
  confirmWorkspaceId: string;
  actorUserId: string;
  confirmActorUserId: string;
  planPath: string;
  apply: boolean;
};
export function updateWeddingGameNotes(options: {
  client: unknown;
  workspaceId: string;
  actorUserId: string;
  plan: WeddingGameNotePlan;
  apply?: boolean;
}): Promise<WeddingGameNoteSummary>;
export function formatWeddingGameNoteSummary(summary: WeddingGameNoteSummary): string;
export function runWeddingGameNoteCli(
  argv: string[],
  dependencies?: Record<string, unknown>,
): Promise<number>;
