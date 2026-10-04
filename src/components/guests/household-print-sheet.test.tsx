import {fireEvent,render,screen,waitFor,within} from "@testing-library/react";
import {expect,it,vi} from "vitest";
const action=vi.hoisted(()=>vi.fn());
vi.mock("@/actions/wedding-cakes",()=>({setCakeCollectedAction:action}));
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

it("fits both the cake list and the gift book on one A4 page with two compact columns that keep each group together",()=>{
 const css=(kind:"cakes"|"gifts")=>{const {container,unmount}=render(<HouseholdPrintSheet workspaceName="婚宴" kind={kind} rows={[{key:"a",group:"GROOM_FAMILY",names:"甲",relationships:"",boxes:1}]}/>);const text=[...container.querySelectorAll("style")].map(style=>style.textContent).join("");const compact=container.querySelector("[data-compact-print]");unmount();return {text,compact};};
 for(const kind of ["cakes","gifts"] as const){
  const {text,compact}=css(kind);
  expect(compact).not.toBeNull();
  expect(text).toMatch(/@page \{ size: A4 portrait; margin: 8mm; \}/u);
  expect(text).toMatch(/\[data-compact-print\] \{[^}]*columns: 2/u);
  expect(text).toMatch(/\.household-table-wrap \{[^}]*break-inside: avoid/u);
 }
 expect(css("gifts").text).toMatch(/\[data-gift-print\] td \{ height: 6mm; \}/u);
});

it("lets editors tick a household as collected on screen and saves the whole household",async()=>{
 action.mockResolvedValue({status:"success"});
 render(<HouseholdPrintSheet workspaceName="婚宴" workspaceId="w" kind="cakes" rows={[
  {key:"household:h",group:"GROOM_FAMILY",names:"阿姨、姨丈",relationships:"",boxes:1,guestIds:["a","b"],collected:false},
  {key:"guest:c",group:"GROOM_FAMILY",names:"表哥",relationships:"",boxes:1,guestIds:["c"],collected:true},
 ]}/>);
 expect(screen.getAllByText("已領 1／2 戶").length).toBeGreaterThan(0);
 const box=screen.getByRole("checkbox",{name:"標記 阿姨、姨丈 已領取喜餅"});
 expect(box).not.toBeChecked();
 fireEvent.click(box);
 expect(box).toBeChecked();
 await waitFor(()=>expect(action).toHaveBeenCalledWith("w",["a","b"],true));
 expect(screen.getByRole("checkbox",{name:"標記 表哥 已領取喜餅"})).toBeChecked();
});
it("reverts the tick when saving fails",async()=>{
 action.mockResolvedValue({status:"error",message:"目前無法儲存領取狀態，請稍後再試。"});
 render(<HouseholdPrintSheet workspaceName="婚宴" workspaceId="w" kind="cakes" rows={[{key:"guest:c",group:"GROOM_FAMILY",names:"表哥",relationships:"",boxes:1,guestIds:["c"],collected:false}]}/>);
 fireEvent.click(screen.getByRole("checkbox",{name:"標記 表哥 已領取喜餅"}));
 expect(await screen.findByRole("alert")).toHaveTextContent("目前無法儲存");
 expect(screen.getByRole("checkbox",{name:"標記 表哥 已領取喜餅"})).not.toBeChecked();
});
