import {familyRelationshipRank} from "./family-relationship";
const immediateFamilyRanks = new Set(["父親", "母親", "哥哥", "弟弟", "姊姊", "妹妹"].map(familyRelationshipRank));
/** 畫面、紙本及服務端共用；不從姓名猜測親屬關係。 */
export function isGiftCollectionExcluded(guest:{category?:string;relationshipLabel?:string|null;giftExemptWithCake?:boolean}) {
 return guest.category === "COUPLE" || !!guest.giftExemptWithCake || immediateFamilyRanks.has(familyRelationshipRank(guest.relationshipLabel));
}
