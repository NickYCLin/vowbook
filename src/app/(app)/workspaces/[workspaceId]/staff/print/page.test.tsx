import {render,screen} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
const {get}=vi.hoisted(()=>({get:vi.fn()}));
vi.mock("@/lib/wedding-staff-list",()=>({getWeddingStaffList:get}));
vi.mock("next/navigation",()=>({notFound:()=>{throw new Error("NOT_FOUND");}}));
import PrintPage from "./page";
it("renders the authorized printable meal list",async()=>{
 get.mockResolvedValue({workspace:{name:"婚宴"},staff:[]});
 render(await PrintPage({params:Promise.resolve({workspaceId:"w"})}));
 expect(get).toHaveBeenCalledWith("w");
 expect(screen.getByRole("button",{name:"列印工作人員便當發放清單／另存 PDF"})).toBeInTheDocument();
});
it("hides the route without workspace membership",async()=>{
 get.mockRejectedValue(new WorkspaceAccessDeniedError());
 await expect(PrintPage({params:Promise.resolve({workspaceId:"other"})})).rejects.toThrow("NOT_FOUND");
});
it("only checks meal handouts and leaves red envelopes to the balance sheet",async()=>{
 get.mockResolvedValue({workspace:{name:"婚宴"},staff:[{id:"s",roleName:"主持人",personName:"Wish",notes:null,mealCount:2,vegetarianMealCount:0,redEnvelopeAmount:3000,redEnvelopeSentAt:null}]});
 render(await PrintPage({params:Promise.resolve({workspaceId:"w"})}));
 expect(screen.getByRole("img",{name:"便當發放勾選框"})).toBeInTheDocument();
 expect(screen.queryByRole("img",{name:"紅包發放勾選框"})).toBeNull();
 expect(screen.queryByText("NT$3,000")).toBeNull();
});
