import {expect,it} from "vitest";
import {sortWeddingStaff} from "./wedding-staff-order";
it("orders the couple's helpers before vendor roles and preserves people within each role",()=>{
 const input=[{id:"print",roleName:"拍拍印"},{id:"host",roleName:"主持人"},{id:"gift2",roleName:"收禮"},{id:"other",roleName:"交通協助"},{id:"reception",roleName:"招待"},{id:"lead",roleName:"總招"},{id:"gift1",roleName:"收禮"},{id:"cake",roleName:"發餅"}];
 const before=[...input];
 expect(sortWeddingStaff(input).map(p=>p.id)).toEqual(["lead","reception","gift2","gift1","cake","other","host","print"]);
 expect(input).toEqual(before);
});
it("recognizes role aliases and keeps vendor assignments after helpers",()=>{
 const roles=["攝影","廠商支援","新娘秘書","收禮金","總招待","接待人員","婚禮總召","其他協助"];
 const sorted=sortWeddingStaff(roles.map(roleName=>({roleName}))).map(p=>p.roleName);
 expect(sorted.slice(0,5)).toEqual(["總招待","婚禮總召","接待人員","收禮金","其他協助"]);
 expect(sorted.slice(5)).toEqual(["攝影","新娘秘書","廠商支援"]);
});

it("places the live flat-photography role after family helpers",()=>{
 expect(sortWeddingStaff(["平面","花童","主持人","收禮金","拍拍印"].map(roleName=>({roleName}))).map(p=>p.roleName)).toEqual(["收禮金","花童","主持人","平面","拍拍印"]);
});

it("moves unrecognized vendor roles that need meals without red envelopes below family helpers",()=>{
 const staff=[
  {id:"lead",roleName:"總招待",mealCount:null,redEnvelopeAmount:2600},
  {id:"florist",roleName:"揀花植所",mealCount:2,redEnvelopeAmount:null},
  {id:"flower-kid",roleName:"花童",mealCount:null,redEnvelopeAmount:1200},
  {id:"host",roleName:"主持人",mealCount:1,redEnvelopeAmount:null},
  {id:"print",roleName:"拍拍印",mealCount:2,redEnvelopeAmount:null},
  {id:"driver",roleName:"交通協助",mealCount:1,redEnvelopeAmount:600},
 ];
 expect(sortWeddingStaff(staff).map(p=>p.id)).toEqual(["lead","flower-kid","driver","host","print","florist"]);
});
