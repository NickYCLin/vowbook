import {isGiftCollectionExcluded} from "./wedding-gift-policy";
import {cakeRelationshipLabel,groupHouseholdMembers,type CakeGuest} from "./wedding-cake";

export function giftPrintRows(guests:readonly (CakeGuest & {giftExemptWithCake?:boolean})[]) {
  return groupHouseholdMembers(guests).flatMap(({key,members:householdMembers,group})=>{
    // 保留整戶分類，只從紙本禮金簿移除雙方父母與手足；不改發餅家庭設定。
    const members=householdMembers.filter(member=>!isGiftCollectionExcluded(member));
    if(!members.length)return [];
    return [{key,group,names:members.map(member=>member.name).join("、"),
      relationships:members.map(member=>`${member.name}：${cakeRelationshipLabel(member)}`).join("；"),
      exempt:false,notes:"",
    }];
  });
}
