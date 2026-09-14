import { compareGuestsBySeniorityThenSurnameStroke, type GuestCategoryValue, type GuestSeniorityValue, type GuestSideValue } from "./guest";
export type CakeGuest = { id: string; category: GuestCategoryValue; name: string; seniority: GuestSeniorityValue; side: GuestSideValue; attendanceStatus: string; checkedIn: boolean; relationshipLabel: string | null; cakeHouseholdId: string | null };
export function cakeRelationshipLabel(guest: Pick<CakeGuest, "side" | "relationshipLabel">): string {
  const title = guest.relationshipLabel?.trim();
  if (guest.side === "SHARED") return title ? `共同親友：${title}` : "共同親友（稱謂未填）";
  const partner = guest.side === "PARTNER_A" ? "新郎" : "新娘";
  return title ? `${partner}的${title}` : `${partner}親友（稱謂未填）`;
}
export type CakeRow = { key: string; names: string; relationships: string; boxes: number };
export function cakeRows(guests: readonly CakeGuest[], households: readonly { id: string; boxes: number }[]): CakeRow[] {
  const counts = new Map(households.map(h => [h.id, h.boxes]));
  const groups = new Map<string, CakeGuest[]>();
  for (const guest of [...guests].sort(compareGuestsBySeniorityThenSurnameStroke)) {
    if (guest.category === "COUPLE") continue;
    if (guest.attendanceStatus !== "ATTENDING" && !guest.checkedIn) continue;
    const key = guest.cakeHouseholdId ? `household:${guest.cakeHouseholdId}` : `guest:${guest.id}`;
    groups.set(key, [...(groups.get(key) ?? []), guest]);
  }
  return [...groups].map(([key, members]) => ({ key, names: members.map(g => g.name).join("、"), relationships: members.map(g => `${g.name}：${cakeRelationshipLabel(g)}`).join("；"), boxes: members[0].cakeHouseholdId ? (counts.get(members[0].cakeHouseholdId) ?? 1) : 1 }));
}
export function cakeCsv(rows: readonly CakeRow[]): string {
  const cell = (value: string | number) => {
    let text = String(value);
    if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || /^[\t\r\n]/u.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return "\uFEFF" + [["姓名", "稱謂", "喜餅盒數", "領取勾選"], ...rows.map(r => [r.names, r.relationships, r.boxes, ""])].map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
export class CakeValidationError extends Error {}
export function normalizeCakeHousehold(data: FormData) {
  const name = data.get("name"); const rawBoxes = data.get("boxes"); const ids = data.getAll("guestId");
  if (typeof name !== "string" || !name.trim() || name.trim().length > 100) throw new CakeValidationError("請填寫 100 字以內的家庭名稱。");
  if (typeof rawBoxes !== "string" || !/^\d{1,3}$/u.test(rawBoxes)) throw new CakeValidationError("喜餅盒數請填 0 到 999 的整數。");
  if (!ids.length || ids.length > 1000 || ids.some(id => typeof id !== "string" || !id || id.length > 100) || new Set(ids).size !== ids.length) throw new CakeValidationError("請選擇同一家人的名單成員。");
  return { name: name.trim(), boxes: Number(rawBoxes), guestIds: ids as string[] };
}
export function cakeMemberSnapshot(members: readonly { id: string; version: number }[]) {
  return JSON.stringify(members.map(m => [m.id, m.version]).sort((a,b) => String(a[0]).localeCompare(String(b[0]))));
}
