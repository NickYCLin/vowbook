import {fireEvent,render,screen,within} from "@testing-library/react";
import {expect,it,vi} from "vitest";
vi.mock("next/navigation",()=>({useRouter:()=>({refresh:vi.fn()})}));
vi.mock("@/actions/wedding-cakes",()=>({saveCakeHouseholdAction:vi.fn(),dissolveCakeHouseholdAction:vi.fn()}));
import {WeddingCakeBoard} from "./wedding-cake-board";
import type {WeddingCakeData} from "@/lib/wedding-cakes";
const data:WeddingCakeData={workspace:{id:"w",name:"婚宴"},households:[{id:"h",name:"甲家",boxes:1,version:0}],guests:[{id:"a",name:"甲",version:0,category:"GUEST",giftExemptWithCake:false,seniority:"PEER",attendanceStatus:"ATTENDING",partySize:4,checkedIn:false,side:"PARTNER_A",relationshipLabel:"表姊",cakeHouseholdId:"h"},{id:"b",name:"乙",version:0,category:"GUEST",giftExemptWithCake:false,seniority:"PEER",attendanceStatus:"ATTENDING",partySize:1,checkedIn:false,side:"PARTNER_A",relationshipLabel:"表姊夫",cakeHouseholdId:"h"},{id:"c",name:"丙",version:0,category:"GUEST",giftExemptWithCake:false,seniority:"PEER",attendanceStatus:"DECLINED",partySize:1,checkedIn:false,side:"PARTNER_A",relationshipLabel:null,cakeHouseholdId:null}]};
it("previews one box per household and provides printing",()=>{render(<WeddingCakeBoard workspaceId="w" data={data}/>);const region=screen.getByRole("region",{name:"發餅匯出預覽"});expect(within(region).getByText("乙、甲")).toBeInTheDocument();expect(within(region).getByText("乙：新郎的表姊夫；甲：新郎的表姊")).toBeInTheDocument();expect(within(region).queryByText("丙")).not.toBeInTheDocument();expect(screen.queryByRole("link",{name:/CSV/})).not.toBeInTheDocument();});
it("edits existing household membership and preserves selected guests while searching",()=>{render(<WeddingCakeBoard workspaceId="w" data={data}/>);fireEvent.click(screen.getByRole("button",{name:"編輯家庭 甲家"}));expect(screen.getByLabelText("家庭名稱")).toHaveValue("甲家");expect(screen.getByLabelText("喜餅盒數")).toHaveValue(1);fireEvent.change(screen.getByLabelText("搜尋成員"),{target:{value:"丙"}});expect(screen.getByText("同一家人的成員（已選 2 筆）")).toBeInTheDocument();expect(screen.getAllByRole("checkbox")).toHaveLength(1);});

it("excludes newlyweds from the preview and household member picker",()=>{
 const withCouple:WeddingCakeData={...data,guests:[...data.guests,{...data.guests[0],id:"groom",name:"新人測試",category:"COUPLE"}]};
 render(<WeddingCakeBoard workspaceId="w" data={withCouple}/>);
 expect(within(screen.getByRole("region",{name:"發餅匯出預覽"})).queryByText(/新人測試/)).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"編輯家庭 甲家"}));
 expect(screen.queryByRole("checkbox",{name:/新人測試/})).not.toBeInTheDocument();
 expect(screen.getByText("同一家人的成員（已選 2 筆）")).toBeInTheDocument();
});

it("provides a print action and one blank marking box per household",()=>{
 const print=vi.spyOn(window,"print").mockImplementation(()=>{});
 render(<WeddingCakeBoard workspaceId="w" data={data}/>);
 expect(screen.getAllByRole("img",{name:"領取勾選框"})).toHaveLength(1);
 expect(screen.getByRole("columnheader",{name:"領取勾選"})).toBeInTheDocument();
 fireEvent.click(screen.getByRole("button",{name:"列印發餅名單／另存 PDF"}));
 expect(print).toHaveBeenCalledOnce();print.mockRestore();
});

it("shows the four categories and keeps cross-partner households in shared pending",()=>{
 const more:WeddingCakeData={...data,guests:[...data.guests,{...data.guests[0],id:"bride",name:"女方成員",side:"PARTNER_B"}]};
 render(<WeddingCakeBoard workspaceId="w" data={more}/>);
 const preview=within(screen.getByRole("region",{name:"發餅匯出預覽"}));
 expect(preview.getAllByRole("region").map(region=>region.getAttribute("aria-label"))).toEqual(["新郎的親戚家人","新郎的朋友","新娘的親戚家人","新娘的朋友","共同親友／待確認"]);
 expect(within(preview.getByRole("region",{name:"共同親友／待確認"})).getAllByRole("img",{name:"領取勾選框"})).toHaveLength(1);
 expect(preview.getAllByRole("img",{name:"領取勾選框"})).toHaveLength(1);
});
