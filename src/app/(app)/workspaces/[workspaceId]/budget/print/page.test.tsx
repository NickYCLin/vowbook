import {render,screen} from "@testing-library/react";
import {expect,it,vi} from "vitest";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
const {get}=vi.hoisted(()=>({get:vi.fn()}));
vi.mock("@/lib/budget-list",()=>({getBudgetPageData:get}));
vi.mock("next/navigation",()=>({notFound:()=>{throw new Error("NOT_FOUND");}}));
import PrintPage from "./page";
it("renders the authorized printable list",async()=>{
 get.mockResolvedValue({workspace:{name:"婚宴"},workspaceName:"婚宴",staff:[],items:[],staffRedEnvelopes:[]});
 render(await PrintPage({params:Promise.resolve({workspaceId:"w"})}));
 expect(get).toHaveBeenCalledWith("w");
 expect(screen.getByRole("button",{name:"列印尾款待付清單／另存 PDF"})).toBeInTheDocument();
});
it("hides the route without workspace membership",async()=>{
 get.mockRejectedValue(new WorkspaceAccessDeniedError());
 await expect(PrintPage({params:Promise.resolve({workspaceId:"other"})})).rejects.toThrow("NOT_FOUND");
});
