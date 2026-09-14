import {render,screen} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
const {get}=vi.hoisted(()=>({get:vi.fn()}));
vi.mock("@/lib/seating-plan",()=>({getSeatingPlan:get}));
vi.mock("next/navigation",()=>({notFound:()=>{throw new Error("NOT_FOUND");}}));
import SeatingPrintPage from "./page";
it("prints the authorized seating plan, including unassigned guests",async()=>{
 get.mockResolvedValue({workspace:{name:"婚宴"},tables:[],unassignedGuests:[{id:"g",name:"待安排親友",side:"SHARED",partySize:2}]});
 render(await SeatingPrintPage({params:Promise.resolve({workspaceId:"w"})}));
 expect(get).toHaveBeenCalledWith("w");expect(screen.getByRole("button",{name:"列印帶位名單／另存 PDF"})).toBeInTheDocument();
 expect(screen.getByRole("cell",{name:"尚未排桌"})).toBeInTheDocument();
});
it("hides the print route without workspace membership",async()=>{
 get.mockRejectedValue(new WorkspaceAccessDeniedError());
 await expect(SeatingPrintPage({params:Promise.resolve({workspaceId:"other"})})).rejects.toThrow("NOT_FOUND");
});
