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
 expect(document.querySelector("[data-print-document]")).not.toBeNull();
 expect(get).toHaveBeenCalledWith("w");
 expect(screen.getByRole("button",{name:"列印尾款待付清單／另存 PDF"})).toBeInTheDocument();
});
it("hides the route without workspace membership",async()=>{
 get.mockRejectedValue(new WorkspaceAccessDeniedError());
 await expect(PrintPage({params:Promise.resolve({workspaceId:"other"})})).rejects.toThrow("NOT_FOUND");
});
it("lists each staff envelope with a handed-over check",async()=>{
 get.mockResolvedValue({workspaceName:"婚宴",items:[],staffRedEnvelopes:[
  {id:"s1",roleName:"主持",personName:"乙",contactPhone:null,notes:null,redEnvelopeAmount:2000,redEnvelopeSentAt:null},
  {id:"s2",roleName:"招待",personName:"丙",contactPhone:null,notes:null,redEnvelopeAmount:1200,redEnvelopeSentAt:null},
 ]});
 render(await PrintPage({params:Promise.resolve({workspaceId:"w"})}));
 expect(screen.getByText("工作人員紅包 2 份")).toBeInTheDocument();
 expect(screen.getByText("乙")).toBeInTheDocument();
 expect(screen.getByRole("img",{name:"乙（主持）紅包已交勾選框"})).toBeInTheDocument();
 expect(document.querySelector('[aria-label$="已包好勾選框"]')).toBeNull();
 expect(screen.getByRole("img",{name:"丙（招待）紅包已交勾選框"})).toBeInTheDocument();
 expect(screen.queryByText(/工作人員發放清單/u)).toBeNull();
});
