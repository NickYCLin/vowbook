import {expect,it} from "vitest";
import {seatingGuestNeeds,seatingPrintData,seatingRelationship} from "./seating-print";
const guest={id:"g",name:"親友一家",partySize:3,vegetarianCount:1,childSeatCount:1};
const details=(relationships:[string,string][]=[],households:[string,string][]=[])=>({relationships:new Map(relationships),households:new Map(households)});
it("groups guests under one table header instead of repeating the table on every row",()=>{
 const data=seatingPrintData([{id:"t",number:5,name:"親友桌",capacity:10,guests:[guest,{...guest,id:"h",name:"同事"}]}],[],details([["g","大舅"]]));
 expect(data.summary).toBe("1 桌 · 6 位");
 expect(data.groups[0]).toMatchObject({title:"5 號桌 親友桌",meta:"6／10 位",assigned:true,full:false});
 expect(data.groups[0].parties.map(p=>p.guests.length)).toEqual([1,1]);
 expect(data.groups[0].parties[1].guests[0]).toEqual({key:"table:t:guest:g",name:"親友一家",partySize:3,needs:"素 1・兒童椅 1"});
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
 ]);
});
it("prints only tables with guests, skipping empty tables and unassigned guests to fit one page",()=>{
 const data=seatingPrintData([{id:"b",number:3,name:"預備桌",capacity:10,guests:[]},{id:"a",number:1,name:"主桌",capacity:3,guests:[guest]}],[{...guest,id:"u",name:"未排親友",partySize:2}]);
 expect(data.groups.map(g=>g.key)).toEqual(["table:a"]);
 expect(data.groups[0].full).toBe(true);
 expect(data.summary).toBe("1 桌 · 3 位");
 expect(data.unassigned).toBe(2);
});
it("leaves needs blank when nothing is required and drops side-only titles",()=>{
 expect(seatingGuestNeeds({vegetarianCount:null,childSeatCount:0})).toBe("");
 expect(seatingGuestNeeds({vegetarianCount:2,childSeatCount:null})).toBe("素 2");
 expect(seatingRelationship("男方親友")).toBe("");
 expect(seatingRelationship(" 阿姨 ")).toBe("阿姨");
});
it("lists the couple as their own rows, keeping their seats in the head count",()=>{
 const data=seatingPrintData([{id:"t",number:1,name:"主桌",capacity:10,guests:[{...guest,id:"groom",name:"新郎",partySize:1,category:"COUPLE"},{...guest,id:"bride",name:"新娘",partySize:1,category:"COUPLE"},{...guest,id:"p",name:"王爸",partySize:2,category:"FAMILY"}]}],[],details([],[["groom","h1"],["bride","h1"]]));
 expect(data.groups[0].parties.map(p=>[p.guests.map(g=>g.name)])).toEqual([[["新郎"]],[["新娘"]],[["王爸"]]]);
 expect(data.groups[0].meta).toBe("4／10 位");
});
it("never groups a couple member into a family household",()=>{
 const data=seatingPrintData([{id:"t",number:1,name:"主桌",capacity:10,guests:[{...guest,id:"dad",name:"王爸",partySize:1,category:"FAMILY"},{...guest,id:"groom",name:"新郎",partySize:1,category:"COUPLE"}]}],[],details([],[["dad","h1"],["groom","h1"]]));
 expect(data.groups[0].parties.map(p=>[p.guests.map(g=>g.name)])).toEqual([[["新郎"]],[["王爸"]]]);
});
it("orders each table like the guest list: couple, family by relationship, then guests by seniority and stroke",()=>{
 const data=seatingPrintData([{id:"t",number:1,name:"主桌",capacity:10,guests:[
  {...guest,id:"g2",name:"王小明",category:"GUEST",seniority:"PEER"},
  {...guest,id:"m",name:"林媽",category:"FAMILY"},
  {...guest,id:"g1",name:"丁叔叔",category:"GUEST",seniority:"ELDER"},
  {...guest,id:"d",name:"林爸",category:"FAMILY"},
  {...guest,id:"c",name:"新娘",category:"COUPLE"},
  {...guest,id:"g3",name:"丁同學",category:"GUEST",seniority:"PEER"},
 ]}],[],details([["m","母親"],["d","父親"]]));
 expect(data.groups[0].parties.map(p=>p.guests[0].name)).toEqual(["新娘","林爸","林媽","丁叔叔","丁同學","王小明"]);
});
