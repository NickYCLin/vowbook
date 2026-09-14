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
