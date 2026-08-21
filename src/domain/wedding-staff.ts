export type WeddingStaffDetailsInput = {
  roleName: unknown;
  personName: unknown;
  contactPhone: unknown;
  notes: unknown;
};

export type NormalizedWeddingStaffDetails = {
  roleName: string;
  personName: string;
  contactPhone: string | null;
  notes: string | null;
};

export class WeddingStaffValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeddingStaffValidationError";
  }
}

function characterCount(value: string): number {
  return Array.from(value).length;
}

function requiredText(
  value: unknown,
  label: string,
  maximum: number,
): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  const count = characterCount(normalized);
  if (count < 1 || count > maximum) {
    throw new WeddingStaffValidationError(
      `${label}需為 1 到 ${maximum} 個字元。`,
    );
  }
  return normalized;
}

function optionalText(
  value: unknown,
  label: string,
  maximum: number,
): string | null {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (characterCount(normalized) > maximum) {
    throw new WeddingStaffValidationError(`${label}最多 ${maximum} 個字元。`);
  }
  return normalized === "" ? null : normalized;
}

export function normalizeWeddingStaffDetails(
  input: WeddingStaffDetailsInput,
): NormalizedWeddingStaffDetails {
  return {
    roleName: requiredText(input.roleName, "職務", 60),
    personName: requiredText(input.personName, "姓名", 120),
    contactPhone: optionalText(input.contactPhone, "聯絡電話", 40),
    notes: optionalText(input.notes, "備註", 500),
  };
}
