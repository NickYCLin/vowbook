import {familyRelationshipRank} from "./family-relationship";
import {cakeRelationshipLabel,groupHouseholdMembers,type CakeGuest} from "./wedding-cake";
const immediateFamilyRanks = new Set(["父親", "母親", "哥哥", "弟弟", "姊姊", "妹妹"].map(familyRelationshipRank));

export function giftPrintRows(guests:readonly (CakeGuest & {giftExemptWithCake?:boolean})[]) {
  return groupHouseholdMembers(guests).flatMap(({key,members:householdMembers,group})=>{
    // 保留整戶分類，只從紙本禮金簿移除雙方父母與手足；不改發餅家庭設定。
    const members=householdMembers.filter(member=>!immediateFamilyRanks.has(familyRelationshipRank(member.relationshipLabel)));
    if(!members.length)return [];
    const exempt=members.every(member=>member.giftExemptWithCake);
    return [{key,group,names:members.map(member=>member.name).join("、"),
      relationships:members.map(member=>`${member.name}：${cakeRelationshipLabel(member)}`).join("；"),
      exempt,notes:exempt?"不收禮金、會送餅":members.filter(member=>member.giftExemptWithCake).map(member=>`${member.name}：不收禮金、會送餅`).join("；"),
    }];
  });
}
