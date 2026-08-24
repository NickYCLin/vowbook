type GuestDetailRecord = {
  source: string;
  sourceInstance?: string;
  sourceManaged: boolean;
};

/**
 * 人工儲存的賓客明細代表整份表單的目前狀態，即使某欄是 null 也不能回頭
 * 採用舊匯入值；沒有人工明細時，才優先採用仍由來源管理的非空值。
 */
export function effectiveGuestDetailValue<T, RecordType extends GuestDetailRecord>(
  records: readonly RecordType[],
  valueOf: (record: RecordType) => T | null,
): T | null {
  const manual = records.find(
    (record) =>
      record.source === "MANUAL" &&
      record.sourceInstance === "guest-details",
  );
  if (manual) return valueOf(manual);

  const ordered = [...records].sort(
    (left, right) => Number(right.sourceManaged) - Number(left.sourceManaged),
  );
  return valueOfFirstNonNull(ordered, valueOf);
}

function valueOfFirstNonNull<T, RecordType>(
  records: readonly RecordType[],
  valueOf: (record: RecordType) => T | null,
): T | null {
  for (const record of records) {
    const value = valueOf(record);
    if (value !== null) return value;
  }
  return null;
}
