import {beforeEach,expect,it,vi} from "vitest";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
const m=vi.hoisted(()=>({auth:vi.fn(),user:vi.fn(),guests:vi.fn(),households:vi.fn(),gifts:vi.fn(),transaction:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/prisma",()=>({prisma:{$transaction:m.transaction}}));
vi.mock("@/lib/current-user",()=>({requireCurrentUser:m.user}));
vi.mock("@/lib/workspace-access",()=>({requireWorkspaceAccess:m.auth}));
import {getWeddingCakes,getWeddingGiftPrint} from "./wedding-cakes";
const tx={guest:{findMany:m.guests},weddingCakeHousehold:{findMany:m.households},weddingGift:{findMany:m.gifts}};
beforeEach(()=>{
 vi.resetAllMocks();
 m.user.mockResolvedValue({id:"user"});m.auth.mockResolvedValue({workspace:{id:"w",name:"婚宴"}});
 m.transaction.mockImplementation(fn=>fn(tx));
 m.guests.mockResolvedValue([{id:"a",name:"甲",seniority:"PEER",checkIn:null,importRecords:[]}]);
 m.households.mockResolvedValue([]);m.gifts.mockResolvedValue([{guestId:"a"}]);
});
it("reads only receipt presence after editor authorization, in the roster transaction",async()=>{
 const data=await getWeddingGiftPrint("w");
 expect(m.auth).toHaveBeenCalledWith("w","user","edit",tx);
 expect(m.gifts).toHaveBeenCalledWith({where:{workspaceId:"w"},select:{guestId:true}});
 expect(data.guests[0]).toMatchObject({id:"a",giftReceived:true});
 expect(data.guests[0]).not.toHaveProperty("amount");
 expect(m.guests).toHaveBeenCalledWith(expect.objectContaining({where:{workspaceId:"w"}}));
});
it("does not read receipt data for the cake board",async()=>{
 const data=await getWeddingCakes("w");expect(m.gifts).not.toHaveBeenCalled();
 expect(data.guests[0]).not.toHaveProperty("giftReceived");
});
it("denies receipt and guest reads when editor membership is absent",async()=>{
 m.auth.mockRejectedValue(new WorkspaceAccessDeniedError());
 await expect(getWeddingGiftPrint("foreign")).rejects.toThrow(WorkspaceAccessDeniedError);
 expect(m.guests).not.toHaveBeenCalled();expect(m.gifts).not.toHaveBeenCalled();
});
