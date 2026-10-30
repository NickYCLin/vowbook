export type InvitationQuestion = { id: string; label: string; type: "TEXT" | "CHOICE"; required: boolean; options: string[] };
export type InvitationReply = { attendance: "ATTENDING" | "DECLINED"; partySize: number; vegetarianCount: number; phone: string; dietaryNotes: string; answers: Record<string, string> };
export class GuestInvitationValidationError extends Error {}
const invalid = (): never => { throw new GuestInvitationValidationError("邀請表單格式有誤，請檢查題目、選項與回覆。"); };
export function invitationObject(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number, required = false) {
  if (typeof value !== "string") return invalid();
  const result = value.trim();
  if (Array.from(result).length > maximum || (required && !result) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(result)) return invalid();
  return result;
}
export function normalizeInvitationQuestions(value: unknown): InvitationQuestion[] {
  if (!Array.isArray(value) || value.length > 8) return invalid();
  const ids = new Set<string>();
  return value.map((raw) => {
    const item = invitationObject(raw, ["id", "label", "type", "required", "options"]);
    const id = text(item.id, 64, true);
    if (!/^[a-zA-Z0-9_-]+$/.test(id) || ["__proto__", "constructor", "prototype"].includes(id) || ids.has(id) || typeof item.required !== "boolean" || (item.type !== "TEXT" && item.type !== "CHOICE")) return invalid();
    ids.add(id);
    if (!Array.isArray(item.options) || item.options.length > 6) return invalid();
    const options = item.options.map((option) => text(option, 50, true));
    if (new Set(options).size !== options.length || (item.type === "TEXT" ? options.length !== 0 : options.length < 2)) return invalid();
    return { id, label: text(item.label, 100, true), type: item.type, required: item.required, options };
  });
}
export function normalizeInvitationReply(value: unknown, questions: readonly InvitationQuestion[], maxPartySize: number): InvitationReply {
  const input = invitationObject(value, ["attendance", "partySize", "vegetarianCount", "phone", "dietaryNotes", "answers"]);
  if (input.attendance !== "ATTENDING" && input.attendance !== "DECLINED") return invalid();
  const size = input.partySize, veggie = input.vegetarianCount;
  if (typeof size !== "number" || !Number.isInteger(size) || size < 0 || size > Math.min(20, maxPartySize) ||
      (input.attendance === "ATTENDING" ? size < 1 : size !== 0) || typeof veggie !== "number" || !Number.isInteger(veggie) || veggie < 0 || veggie > size) return invalid();
  const rawAnswers = invitationObject(input.answers, questions.map((question) => question.id));
  const answers: Record<string, string> = {};
  for (const question of questions) {
    const answer = text(rawAnswers[question.id] ?? "", 200, question.required);
    if (answer && question.type === "CHOICE" && !question.options.includes(answer)) return invalid();
    answers[question.id] = answer;
  }
  return { attendance: input.attendance, partySize: size, vegetarianCount: veggie, phone: text(input.phone, 40), dietaryNotes: text(input.dietaryNotes, 300), answers };
}
export function parseCheckInCode(value: unknown): string {
  if (typeof value !== "string") return invalid();
  const match = /^vowbook:check-in:v1:([A-Za-z0-9_-]{43})$/.exec(value.trim());
  return match?.[1] ?? invalid();
}
