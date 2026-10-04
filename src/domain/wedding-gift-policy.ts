import {familyRelationshipRank} from "./family-relationship";
const immediateFamilyRanks = new Set(["父親", "母親", "哥哥", "弟弟", "姊姊", "妹妹", "嫂嫂", "弟媳", "姊夫", "妹夫"].map(familyRelationshipRank));
/** 雙方父母、手足與手足的配偶都是自家人，不收禮金。畫面、紙本及服務端共用；不從姓名猜測親屬關係。 */
export function isGiftCollectionExcluded(guest:{category?:string;relationshipLabel?:string|null;giftExemptWithCake?:boolean}) {
 return guest.category === "COUPLE" || !!guest.giftExemptWithCake || immediateFamilyRanks.has(familyRelationshipRank(guest.relationshipLabel));
}
/** 不收禮金只是預設不列入；家人或已標記不收的親友真的包了，仍要能登記。只有新人本人不收禮金。 */
export function canRecordWeddingGift(guest:{category?:string}) {
 return guest.category !== "COUPLE";
}
