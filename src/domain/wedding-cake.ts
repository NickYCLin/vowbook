import { familyRelationshipRank } from "./family-relationship";
import { compareGuestsBySeniorityThenSurnameStroke, type GuestCategoryValue, type GuestSeniorityValue, type GuestSideValue } from "./guest";
export type CakeGuest = { id: string; category: GuestCategoryValue; name: string; seniority: GuestSeniorityValue; side: GuestSideValue; attendanceStatus: string; checkedIn: boolean; relationshipLabel: string | null; cakeHouseholdId: string | null };
/** 匯入的名單常把側別寫進稱謂，例如「男方親友」；再冠一次會變成「新郎的男方親友」。 */
const SIDE_STATED = /^(新郎|新娘|男方|女方)/;
/** 「男方親友」「男方」和沒填稱謂講的是同一件事，一律收斂成「新郎親友」。 */
const SIDE_ONLY = /^(新郎|新娘|男方|女方)(親友)?$/;
export function cakeRelationshipLabel(guest: Pick<CakeGuest, "side" | "relationshipLabel">): string {
  const title = guest.relationshipLabel?.trim();
  if (guest.side === "SHARED") return title ? `共同朋友：${title}` : "共同朋友";
  const partner = guest.side === "PARTNER_A" ? "新郎" : "新娘";
  if (!title || SIDE_ONLY.test(title)) return `${partner}親友`;
  return SIDE_STATED.test(title) ? title : `${partner}的${title}`;
}
export const CAKE_GROUPS = [
  {id:"GROOM_FAMILY",label:"新郎的親戚家人"},
  {id:"GROOM_FRIENDS",label:"新郎的朋友"},
  {id:"BRIDE_FAMILY",label:"新娘的親戚家人"},
  {id:"BRIDE_FRIENDS",label:"新娘的朋友"},
  {id:"SHARED",label:"共同朋友"},
] as const;
export type CakeGroup = typeof CAKE_GROUPS[number]["id"];
export type HouseholdMemberLabel = { name: string; relationship: string };
export type CakeRow = { key: string; group: CakeGroup; names: string; relationships: string; members: HouseholdMemberLabel[]; boxes: number };
export function householdMemberLabels(members: readonly Pick<CakeGuest, "name" | "side" | "relationshipLabel">[]): HouseholdMemberLabel[] {
  return members.map(member=>({name:member.name,relationship:cakeRelationshipLabel(member)}));
}
/** 區段標題已經講了是誰的親友，印出來時把重複的前綴拿掉；只剩「新郎親友」這種沒資訊的稱謂就不印。 */
export function printedRelationship(group: CakeGroup, relationship: string): string {
  if (group === "SHARED") return relationship === "共同朋友" ? "" : relationship.replace(/^共同朋友：/, "");
  const partner = group.startsWith("GROOM") ? "新郎" : "新娘";
  if (relationship === `${partner}親友`) return "";
  return relationship.startsWith(`${partner}的`) ? relationship.slice(partner.length + 1) : relationship;
}
export function householdGroup(members: readonly CakeGuest[]): CakeGroup {
  const sides=new Set(members.map(member=>member.side));
  if(sides.size!==1||sides.has("SHARED"))return "SHARED";
  const family=members.some(member=>member.category==="FAMILY"||familyRelationshipRank(member.relationshipLabel)<Number.MAX_SAFE_INTEGER);
  return members[0].side==="PARTNER_A"?(family?"GROOM_FAMILY":"GROOM_FRIENDS"):(family?"BRIDE_FAMILY":"BRIDE_FRIENDS");
}
export function cakeRowGroups<Row extends {group: CakeGroup}>(rows: readonly Row[]) {
  return CAKE_GROUPS.map(group=>({...group,rows:rows.filter(row=>row.group===group.id)}))
    .filter(group=>group.id!=="SHARED"||group.rows.length>0);
}
/** 發餅與紙本禮金簿共用家庭識別與親近關係排序；呼叫端決定出席範圍。 */
export function groupHouseholdMembers<Guest extends CakeGuest>(guests: readonly Guest[]) {
  const groups = new Map<string, Guest[]>();
  for(const guest of [...guests].sort((a,b)=>familyRelationshipRank(a.relationshipLabel)-familyRelationshipRank(b.relationshipLabel)||compareGuestsBySeniorityThenSurnameStroke(a,b))) {
    if(guest.category === "COUPLE")continue;
    const key=guest.cakeHouseholdId?`household:${guest.cakeHouseholdId}`:`guest:${guest.id}`;
    groups.set(key,[...(groups.get(key)??[]),guest]);
  }
  return [...groups].map(([key,members])=>({key,members,group:householdGroup(members)}))
    .sort((a,b)=>CAKE_GROUPS.findIndex(group=>group.id===a.group)-CAKE_GROUPS.findIndex(group=>group.id===b.group));
}
export function cakeRows(guests: readonly CakeGuest[], households: readonly { id: string; boxes: number }[]): CakeRow[] {
  const counts = new Map(households.map(h => [h.id, h.boxes]));
  return groupHouseholdMembers(guests).flatMap(({key,members,group})=>{
    const attending=members.filter(guest=>guest.attendanceStatus === "ATTENDING"||guest.checkedIn);
    if(!attending.length)return [];
    return [{key,group,names:attending.map(g=>g.name).join("、"),relationships:attending.map(g=>`${g.name}：${cakeRelationshipLabel(g)}`).join("；"),members:householdMemberLabels(attending),
      boxes:members[0].cakeHouseholdId?(counts.get(members[0].cakeHouseholdId)??1):1,
    }];
  });
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
