import {cakeRelationshipLabel,groupHouseholdMembers,type CakeGuest} from "./wedding-cake";
export function giftPrintRows(guests:readonly (CakeGuest & {giftExemptWithCake?:boolean})[]) {
  return groupHouseholdMembers(guests).map(({key,members,group})=>{
    const exempt=members.every(member=>member.giftExemptWithCake);
    return {key,group,names:members.map(member=>member.name).join("、"),
      relationships:members.map(member=>`${member.name}：${cakeRelationshipLabel(member)}`).join("；"),
      exempt,notes:exempt?"不收禮金、會送餅":members.filter(member=>member.giftExemptWithCake).map(member=>`${member.name}：不收禮金、會送餅`).join("；"),
    };
  });
}
