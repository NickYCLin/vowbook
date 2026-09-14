import {expect,it,vi} from "vitest";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
const get=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/wedding-cakes",()=>({getWeddingCakes:get}));
import {GET} from "./route";
it("exports only the authorized workspace with no-store headers",async()=>{get.mockResolvedValue({guests:[],households:[]});const r=await GET(new Request("https://example.test"),{params:Promise.resolve({workspaceId:"w"})});expect(get).toHaveBeenLastCalledWith("w");expect(r.headers.get("cache-control")).toBe("private, no-store");expect(r.headers.get("content-disposition")).toContain("attachment");expect(await r.text()).toContain("喜餅盒數");});
it("never exports when membership is denied",async()=>{get.mockRejectedValue(new WorkspaceAccessDeniedError());const r=await GET(new Request("https://example.test"),{params:Promise.resolve({workspaceId:"other"})});expect(r.status).toBe(404);});

it("omits newlyweds from the exported names and box count",async()=>{
 const base={seniority:"PEER",side:"PARTNER_A",attendanceStatus:"ATTENDING",checkedIn:true,relationshipLabel:null,cakeHouseholdId:null};
 get.mockResolvedValue({households:[],guests:[{...base,id:"g",name:"新郎測試",category:"COUPLE"},{...base,id:"b",name:"新娘測試",side:"PARTNER_B",category:"COUPLE"},{...base,id:"p",name:"家人測試",category:"FAMILY"}]});
 const response=await GET(new Request("https://example.test"),{params:Promise.resolve({workspaceId:"w"})});
 const csv=await response.text();expect(csv).not.toMatch(/新郎測試|新娘測試/);expect(csv).toContain("家人測試");expect(csv.trim().split("\r\n")).toHaveLength(2);
});
