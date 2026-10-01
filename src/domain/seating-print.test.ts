import {expect,it} from "vitest";
import {seatingGuestNeeds,seatingPrintData,seatingRelationship} from "./seating-print";
const guest={id:"g",name:"親友一家",partySize:3,vegetarianCount:1,childSeatCount:1};
const details=(relationships:[string,string][]=[],households:[string,string][]=[])=>({relationships:new Map(relationships),households:new Map(households)});
it("groups guests under one table header instead of repeating the table on every row",()=>{
 const data=seatingPrintData([{id:"t",number:5,name:"親友桌",capacity:10,guests:[guest,{...guest,id:"h",name:"同事"}]}],[],details([["g","大舅"]]));
 expect(data.summary).toContain("已排 6 位");
 expect(data.groups[0]).toMatchObject({title:"5 號桌 親友桌",meta:"6／10 位",assigned:true,full:false});
 expect(data.groups[0].parties.map(p=>p.guests.length)).toEqual([1,1]);
 expect(data.groups[0].parties[0].guests[0]).toEqual({key:"table:t:guest:g",name:"親友一家",relationship:"大舅",partySize:3,needs:"素 1・兒童椅 1"});
});
it("puts same-table household members under one check, even when listed apart",()=>{
 const data=seatingPrintData([{id:"t",number:1,name:"主桌",capacity:10,guests:[{...guest,id:"a",name:"王爸"},{...guest,id:"x",name:"同事"},{...guest,id:"b",name:"王媽"}]}],[],details([],[["a","h1"],["b","h1"]]));
 expect(data.groups[0].parties.map(p=>p.guests.map(g=>g.name))).toEqual([["王爸","王媽"],["同事"]]);
 expect(data.groups[0].parties[0].elsewhere).toBe("");
});
it("keeps a check per table when a household is split and notes where the others sit",()=>{
 const data=seatingPrintData([
  {id:"t2",number:2,name:"長輩桌",capacity:10,guests:[{...guest,id:"a",name:"王爸"}]},
  {id:"t1",number:1,name:"主桌",capacity:10,guests:[{...guest,id:"b",name:"王小弟"}]},
 ],[{...guest,id:"c",name:"王阿嬤"}],details([],[["a","h1"],["b","h1"],["c","h1"]]));
 const sameTable=seatingPrintData([{id:"t1",number:1,name:"主桌",capacity:10,guests:[{...guest,id:"a",name:"王爸"},{...guest,id:"b",name:"王媽"}]},{id:"t2",number:2,name:"朋友桌",capacity:10,guests:[{...guest,id:"c",name:"王小弟"}]}],[],details([],[["a","h1"],["b","h1"],["c","h1"]]));
 expect(sameTable.groups[1].parties[0].elsewhere).toBe("同戶另有：1 號桌 王爸、王媽");
 expect(data.groups.map(g=>g.parties[0].elsewhere)).toEqual([
  "同戶另有：2 號桌 王爸；尚未排桌 王阿嬤",
  "同戶另有：1 號桌 王小弟；尚未排桌 王阿嬤",
  "同戶另有：1 號桌 王小弟；2 號桌 王爸",
 ]);
});
it("keeps empty tables, sorts by number and lists unassigned guests last",()=>{
 const data=seatingPrintData([{id:"b",number:3,name:"預備桌",capacity:10,guests:[]},{id:"a",number:1,name:"主桌",capacity:3,guests:[guest]}],[{...guest,id:"u",name:"未排親友",partySize:2}]);
 expect(data.groups.map(g=>g.key)).toEqual(["table:a","table:b","unassigned"]);
 expect(data.groups[0].full).toBe(true);
 expect(data.groups[1].parties).toEqual([]);
 expect(data.groups[2]).toMatchObject({title:"尚未排桌",meta:"2 位待安排",assigned:false});
 expect(data.summary).toContain("未排 2 位");
});
it("omits relationship titles and household merging without guest-detail access",()=>{
 expect(seatingPrintData([],[]).showRelationship).toBe(false);
 expect(seatingPrintData([],[],details()).showRelationship).toBe(true);
});
it("leaves needs blank when nothing is required and drops side-only titles",()=>{
 expect(seatingGuestNeeds({vegetarianCount:null,childSeatCount:0})).toBe("");
 expect(seatingGuestNeeds({vegetarianCount:2,childSeatCount:null})).toBe("素 2");
 expect(seatingRelationship("男方親友")).toBe("");
 expect(seatingRelationship(" 阿姨 ")).toBe("阿姨");
});
it("lists the couple without an ushering check, keeping their seats in the head count",()=>{
 const data=seatingPrintData([{id:"t",number:1,name:"主桌",capacity:10,guests:[{...guest,id:"groom",name:"新郎",partySize:1,category:"COUPLE"},{...guest,id:"bride",name:"新娘",partySize:1,category:"COUPLE"},{...guest,id:"p",name:"王爸",partySize:2,category:"FAMILY"}]}],[],details([],[["groom","h1"],["bride","h1"]]));
 expect(data.groups[0].parties.map(p=>[p.guests.map(g=>g.name),p.needsCheck])).toEqual([[["新郎","新娘"],false],[["王爸"],true]]);
 expect(data.groups[0].meta).toBe("4／10 位");
});
