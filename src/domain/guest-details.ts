import { GuestValidationError } from "./guest";

export const INVITATION_DELIVERIES = [
  "PAPER",
  "DIGITAL",
  "NONE",
  "UNKNOWN",
] as const;

export type InvitationDeliveryValue =
  (typeof INVITATION_DELIVERIES)[number];

export type GuestDetailsInput = {
  relationshipLabel?: unknown;
  contactPhone?: unknown;
  contactEmail?: unknown;
  ceremonyAttendance?: unknown;
  childSeatCount?: unknown;
  vegetarianCount?: unknown;
  invitationDelivery?: unknown;
  mailingAddress?: unknown;
  guestMessage?: unknown;
  attendanceReply?: unknown;
  invitationReply?: unknown;
};

export type NormalizedGuestDetailsInput = {
  relationshipLabel: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  ceremonyAttendance: boolean | null;
  childSeatCount: number | null;
  vegetarianCount: number | null;
  invitationDelivery: InvitationDeliveryValue | null;
  mailingAddress: string | null;
  guestMessage: string | null;
  attendanceReply: string | null;
  invitationReply: string | null;
};

function characterCount(value: string): number {
  return Array.from(value).length;
}

function optionalText(
  value: unknown,
  maximum: number,
  errorMessage: string,
): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (characterCount(normalized) > maximum) {
    throw new GuestValidationError(errorMessage);
  }
  return normalized === "" ? null : normalized;
}

function optionalCount(
  value: unknown,
  label: string,
): number | null {
  if (value === null || value === undefined || value === "") return null;
  const normalized = typeof value === "string" ? value.trim() : value;
  if (normalized === "") return null;
  const parsed =
    typeof normalized === "number"
      ? normalized
      : typeof normalized === "string" && /^\d+$/u.test(normalized)
        ? Number(normalized)
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 20) {
    throw new GuestValidationError(`${label}需為 0 到 20 的整數。`);
  }
  return parsed;
}

function ceremonyAttendance(value: unknown): boolean | null {
  if (value === null || value === undefined || value === "") return null;
  if (value === true || value === "ATTENDING") return true;
  if (value === false || value === "DECLINED") return false;
  throw new GuestValidationError("請選擇有效的證婚儀式出席狀態。");
}

function invitationDelivery(
  value: unknown,
): InvitationDeliveryValue | null {
  if (value === null || value === undefined || value === "") return null;
  if (
    typeof value === "string" &&
    (INVITATION_DELIVERIES as readonly string[]).includes(value)
  ) {
    return value as InvitationDeliveryValue;
  }
  throw new GuestValidationError("請選擇有效的喜帖方式。");
}

export function normalizeGuestDetailsInput(
  input: GuestDetailsInput,
): NormalizedGuestDetailsInput {
  const contactEmail = optionalText(
    input.contactEmail,
    254,
    "電子信箱最多 254 個字元。",
  );
  if (
    contactEmail &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(contactEmail)
  ) {
    throw new GuestValidationError("電子信箱格式不正確。");
  }

  const normalized: NormalizedGuestDetailsInput = {
    relationshipLabel: optionalText(
      input.relationshipLabel,
      100,
      "關係補充最多 100 個字元。",
    ),
    contactPhone: optionalText(
      input.contactPhone,
      40,
      "聯絡電話最多 40 個字元。",
    ),
    contactEmail,
    ceremonyAttendance: ceremonyAttendance(input.ceremonyAttendance),
    childSeatCount: optionalCount(input.childSeatCount, "兒童座椅"),
    vegetarianCount: optionalCount(input.vegetarianCount, "素食人數"),
    invitationDelivery: invitationDelivery(input.invitationDelivery),
    mailingAddress: optionalText(
      input.mailingAddress,
      500,
      "寄送地址最多 500 個字元。",
    ),
    guestMessage: optionalText(
      input.guestMessage,
      1000,
      "賓客留言最多 1000 個字元。",
    ),
    attendanceReply: optionalText(
      input.attendanceReply,
      120,
      "出席回覆補充最多 120 個字元。",
    ),
    invitationReply: optionalText(
      input.invitationReply,
      120,
      "喜帖回覆補充最多 120 個字元。",
    ),
  };

  if (
    normalized.invitationDelivery === "PAPER" &&
    normalized.mailingAddress === null
  ) {
    throw new GuestValidationError("選擇紙本喜帖時請填寫寄送地址。");
  }
  if (
    normalized.invitationReply !== null &&
    (normalized.invitationDelivery === null ||
      normalized.invitationDelivery === "UNKNOWN")
  ) {
    throw new GuestValidationError(
      "填寫喜帖回覆補充前，請先選擇喜帖方式。",
    );
  }

  return normalized;
}

export function hasGuestDetails(details: NormalizedGuestDetailsInput): boolean {
  return Object.values(details).some((value) => value !== null);
}
