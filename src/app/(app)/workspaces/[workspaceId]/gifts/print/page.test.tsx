import {render,screen,within} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
const {get,notFound}=vi.hoisted(()=>({get:vi.fn(),notFound:vi.fn(()=>{throw new Error("NOT_FOUND");})}));
vi.mock("@/lib/wedding-cakes",()=>({getWeddingCakes:get}));
vi.mock("next/navigation",()=>({notFound}));
import GiftPrintPage from "./page";
it("loads the authorized household roster and offers printing with blank amounts",async()=>{
 const guest={category:"GUEST",side:"PARTNER_A",seniority:"PEER",attendanceStatus:"DECLINED",checkedIn:false,relationshipLabel:null,cakeHouseholdId:"h"};
 get.mockResolvedValue({workspace:{name:"婚宴"},guests:[{...guest,id:"a",name:"甲"},{...guest,id:"b",name:"乙"}],households:[]});
 const {container}=render(await GiftPrintPage({params:Promise.resolve({workspaceId:"w"})}));
 expect(get).toHaveBeenCalledWith("w");
 expect(screen.getByRole("button",{name:"列印禮金簿／另存 PDF"})).toBeInTheDocument();
 expect(within(screen.getByRole("region",{name:"紙本禮金簿預覽"})).getByText("乙、甲")).toBeInTheDocument();
 expect(container.querySelectorAll('[data-gift-amount-blank]')).toHaveLength(1);
});
it("hides the print route when household access is denied",async()=>{
 get.mockRejectedValue(new WorkspaceAccessDeniedError());
 await expect(GiftPrintPage({params:Promise.resolve({workspaceId:"other"})})).rejects.toThrow("NOT_FOUND");
});
