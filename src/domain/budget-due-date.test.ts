import {describe,expect,it} from "vitest";
import {defaultBalanceDueDate,effectiveDueDate} from "./budget-due-date";

describe("default balance due date",()=>{
 it("defaults to the wedding day",()=>{
  expect(defaultBalanceDueDate({name:"宴客場地",breadcrumb:["宴客場地"],relatedTaxonomyItemKey:null},"2026-11-08")).toEqual({date:"2026-11-08",reason:"婚禮當天"});
 });
 it("settles gowns the day before when the dresses are picked up",()=>{
  expect(defaultBalanceDueDate({name:"白紗",breadcrumb:["籌備婚禮第4個月","禮服租借","白紗"],relatedTaxonomyItemKey:null},"2026-11-01")).toEqual({date:"2026-10-31",reason:"領禮服當天"});
  expect(defaultBalanceDueDate({name:"婚紗工作室",breadcrumb:["婚紗工作室"],relatedTaxonomyItemKey:null},"2026-03-01")).toEqual({date:"2026-02-28",reason:"領禮服當天"});
  expect(defaultBalanceDueDate({name:"尾款",breadcrumb:["尾款"],relatedTaxonomyItemKey:"ITEM_ATTIRE_RENTAL"},"2026-11-08")?.reason).toBe("領禮服當天");
 });
 it("does not treat pre-wedding photos as gown pickup",()=>{
  expect(defaultBalanceDueDate({name:"婚紗照拍攝",breadcrumb:["婚紗照拍攝"],relatedTaxonomyItemKey:null},"2026-11-08")?.reason).toBe("婚禮當天");
 });
 it("returns nothing without a wedding date and prefers a filled due date",()=>{
  expect(defaultBalanceDueDate({name:"x",breadcrumb:[],relatedTaxonomyItemKey:null},null)).toBeNull();
  expect(effectiveDueDate({dueDate:"2026-10-01",defaultDueDate:{date:"2026-11-08",reason:"婚禮當天"}})).toEqual({date:"2026-10-01",reason:null});
  expect(effectiveDueDate({dueDate:null,defaultDueDate:{date:"2026-11-08",reason:"婚禮當天"}})).toEqual({date:"2026-11-08",reason:"婚禮當天"});
  expect(effectiveDueDate({dueDate:null})).toBeNull();
 });
});
