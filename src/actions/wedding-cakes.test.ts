import {beforeEach,expect,it,vi} from "vitest";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
const m=vi.hoisted(()=>({user:vi.fn(),access:vi.fn(),locked:vi.fn(),transaction:vi.fn(),find:vi.fn(),create:vi.fn(),update:vi.fn(),remove:vi.fn(),guestUpdate:vi.fn()}));
vi.mock("@/lib/current-user",()=>({requireCurrentUser:m.user}));
vi.mock("@/lib/workspace-access",()=>({requireWorkspaceAccess:m.access}));
vi.mock("@/lib/workspace-mutation-access",()=>({requireLockedWorkspaceAccess:m.locked}));
vi.mock("@/lib/prisma",()=>({prisma:{$transaction:m.transaction}}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
import {saveCakeHouseholdAction} from "./wedding-cakes";
const tx={guest:{findMany:m.find,updateMany:m.guestUpdate},weddingCakeHousehold:{create:m.create,updateMany:m.update,deleteMany:m.remove}};
function form(){const f=new FormData();f.set("name","一家人");f.set("boxes","1");f.append("guestId","g");f.set("expectedGuests",JSON.stringify({g:0}));f.set("expectedMembers","[]");f.set("expectedVersion","0");return f;}
beforeEach(()=>{vi.clearAllMocks();m.user.mockResolvedValue({id:"session"});m.access.mockResolvedValue({role:"OWNER"});m.locked.mockResolvedValue("OWNER");m.transaction.mockImplementation(fn=>fn(tx));m.find.mockResolvedValue([{id:"g",version:0,cakeHouseholdId:null}]);m.create.mockResolvedValue({id:"h"});m.update.mockResolvedValue({count:1});m.guestUpdate.mockResolvedValue({count:1});});
it("checks Membership inside writes and ignores client workspace identity",async()=>{const f=form();f.set("workspaceId","evil");expect(await saveCakeHouseholdAction("w",null,{status:"idle"},f)).toMatchObject({status:"success"});expect(m.locked).toHaveBeenCalledWith("w","session","edit",tx);expect(m.create.mock.calls[0][0].data.workspaceId).toBe("w");expect(m.guestUpdate.mock.calls[0][0].where).toMatchObject({workspaceId:"w",id:"g",version:0,cakeHouseholdId:null});});
it("denies viewers before domain access",async()=>{m.access.mockRejectedValue(new WorkspaceAccessDeniedError());expect(await saveCakeHouseholdAction("w",null,{status:"idle"},form())).toMatchObject({code:"FORBIDDEN"});expect(m.find).not.toHaveBeenCalled();});
it("denies revoked membership inside transaction",async()=>{m.locked.mockRejectedValue(new WorkspaceAccessDeniedError());expect(await saveCakeHouseholdAction("w",null,{status:"idle"},form())).toMatchObject({code:"FORBIDDEN"});expect(m.find).not.toHaveBeenCalled();});
it("rejects missing or cross-workspace guests",async()=>{m.find.mockResolvedValue([]);expect(await saveCakeHouseholdAction("w",null,{status:"idle"},form())).toMatchObject({code:"STALE"});expect(m.create).not.toHaveBeenCalled();});
it("rejects assigning a guest already in another household",async()=>{m.find.mockResolvedValue([{id:"g",version:0,cakeHouseholdId:"other"}]);expect(await saveCakeHouseholdAction("w",null,{status:"idle"},form())).toMatchObject({code:"STALE"});expect(m.create).not.toHaveBeenCalled();});
it("rejects stale guest versions",async()=>{m.find.mockResolvedValue([{id:"g",version:1,cakeHouseholdId:null}]);expect(await saveCakeHouseholdAction("w",null,{status:"idle"},form())).toMatchObject({code:"STALE"});});
it("rejects changed household membership snapshots",async()=>{m.find.mockResolvedValue([{id:"g",version:0,cakeHouseholdId:"h"}]);expect(await saveCakeHouseholdAction("w","h",{status:"idle"},form())).toMatchObject({code:"STALE"});expect(m.update).not.toHaveBeenCalled();});
