import {expect,it,vi} from "vitest";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
const get=vi.hoisted(()=>vi.fn());
vi.mock("@/lib/wedding-cakes",()=>({getWeddingCakes:get}));
import {GET} from "./route";
it("exports only the authorized workspace with no-store headers",async()=>{get.mockResolvedValue({guests:[],households:[]});const r=await GET(new Request("https://example.test"),{params:Promise.resolve({workspaceId:"w"})});expect(get).toHaveBeenLastCalledWith("w");expect(r.headers.get("cache-control")).toBe("private, no-store");expect(r.headers.get("content-disposition")).toContain("attachment");expect(await r.text()).toContain("喜餅盒數");});
it("never exports when membership is denied",async()=>{get.mockRejectedValue(new WorkspaceAccessDeniedError());const r=await GET(new Request("https://example.test"),{params:Promise.resolve({workspaceId:"other"})});expect(r.status).toBe(404);});
