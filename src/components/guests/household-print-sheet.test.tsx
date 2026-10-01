import {render,screen,within} from "@testing-library/react";
import {expect,it} from "vitest";
import {HouseholdPrintSheet} from "./household-print-sheet";
it("keeps zero-box households for reference without a collection checkbox",()=>{
 render(<HouseholdPrintSheet workspaceName="婚宴" kind="cakes" rows={[
  {key:"none",group:"GROOM_FAMILY",names:"事先送餅的一家",relationships:"新郎親友",boxes:0},
  {key:"one",group:"GROOM_FAMILY",names:"當天領餅的一家",relationships:"新郎親友",boxes:1},
 ]}/>);
 const noCollection=screen.getByRole("row",{name:/事先送餅的一家/});
 expect(within(noCollection).getByText("當日不領取")).toBeInTheDocument();
 expect(within(noCollection).queryByRole("img",{name:"領取勾選框"})).not.toBeInTheDocument();
 expect(screen.getAllByRole("img",{name:"領取勾選框"})).toHaveLength(1);
 expect(screen.getByRole("heading",{level:2})).toHaveTextContent("共 1 盒");
});
it("prints gift households with a blank amount column and exemption notes",()=>{
 const {container}=render(<HouseholdPrintSheet workspaceName="婚宴" kind="gifts" rows={[
  {key:"a",group:"GROOM_FAMILY",names:"父親一家",relationships:"新郎的父親",exempt:false,notes:""},
  {key:"b",group:"BRIDE_FAMILY",names:"阿姨一家",relationships:"新娘的姨母",exempt:true,notes:"不收禮金、會送餅"},
 ]}/>);
 expect(screen.getAllByRole("columnheader",{name:"禮金金額（元）"})).toHaveLength(2);
 expect(container.querySelectorAll('[data-gift-amount-blank]')).toHaveLength(1);
 expect(container.querySelector('[data-gift-amount-blank]')).toHaveTextContent("");
 expect(within(screen.getByRole("region",{name:"新娘的親戚家人"})).getByText("不收禮金")).toBeInTheDocument();
 expect(screen.getByText("不收禮金、會送餅")).toBeInTheDocument();
 expect(screen.queryByRole("img",{name:"領取勾選框"})).not.toBeInTheDocument();
});

it("replaces the amount blank with a polite receipt label for received households",()=>{
 const {container}=render(<HouseholdPrintSheet workspaceName="婚宴" kind="gifts" rows={[
  {key:"a",group:"GROOM_FRIENDS",names:"已收一家",relationships:"朋友",giftReceived:true},
  {key:"b",group:"BRIDE_FRIENDS",names:"未登記一家",relationships:"朋友",giftReceived:false},
 ]}/>);
 expect(screen.getByText("禮金已收訖")).toBeInTheDocument();
 expect(container.querySelectorAll('[data-gift-amount-blank]')).toHaveLength(1);
 expect(within(screen.getByRole("region",{name:"新郎的朋友"})).getByRole("cell",{name:"禮金已收訖"})).toBeInTheDocument();
});

it("prints each household on one line with titles shortened to what the section header does not already say",()=>{
 render(<HouseholdPrintSheet workspaceName="婚宴" kind="cakes" rows={[
  {key:"parents",group:"GROOM_FAMILY",names:"林友得、蘇楨媛",relationships:"",boxes:1,members:[{name:"林友得",relationship:"新郎的父親"},{name:"蘇楨媛",relationship:"新郎的母親"}]},
  {key:"friend",group:"GROOM_FRIENDS",names:"蘇文紹",relationships:"",boxes:1,members:[{name:"蘇文紹",relationship:"新郎親友"}]},
  {key:"shared",group:"SHARED",names:"甲、乙",relationships:"",boxes:2,members:[{name:"甲",relationship:"共同朋友：同事"},{name:"乙",relationship:"新娘的表姊"}]},
 ]}/>);
 expect(screen.queryByRole("columnheader",{name:"稱謂"})).not.toBeInTheDocument();
 expect(screen.getAllByRole("columnheader",{name:"姓名（稱謂）"}).length).toBeGreaterThan(0);
 expect(screen.getByRole("row",{name:/林友得/})).toHaveTextContent("林友得（父親）、蘇楨媛（母親）");
 expect(screen.getByRole("row",{name:/林友得/})).not.toHaveTextContent("新郎");
 expect(within(screen.getByRole("row",{name:/蘇文紹/})).getAllByRole("cell")[0]).toHaveTextContent(/^蘇文紹$/);
 expect(screen.getByRole("row",{name:/甲/})).toHaveTextContent("甲（同事）、乙（新娘的表姊）");
});

it("fits the cake list on one A4 page with two compact columns while the gift book keeps its writing space",()=>{
 const css=(kind:"cakes"|"gifts")=>{const {container,unmount}=render(<HouseholdPrintSheet workspaceName="婚宴" kind={kind} rows={[{key:"a",group:"GROOM_FAMILY",names:"甲",relationships:"",boxes:1}]}/>);const text=[...container.querySelectorAll("style")].map(style=>style.textContent).join("");unmount();return text;};
 const cake=css("cakes");
 expect(cake).toMatch(/@page \{ size: A4 portrait; margin: 8mm; \}/u);
 expect(cake).toMatch(/\[data-cake-print\] \{[^}]*columns: 2/u);
 expect(cake).toMatch(/font-size: 9pt/u);
 const gifts=css("gifts");
 expect(gifts).toMatch(/margin: 12mm/u);
 expect(gifts).not.toMatch(/columns: 2/u);
});
