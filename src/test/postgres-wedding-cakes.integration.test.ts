import {afterAll,beforeEach,describe,expect,it,vi} from "vitest";
import {PrismaClient} from "@prisma/client";
const auth=vi.hoisted(()=>({id:""}));
vi.mock("@/lib/current-user",()=>({requireCurrentUser:async()=>({id:auth.id})}));
vi.mock("next/cache",()=>({revalidatePath:vi.fn()}));
import {saveCakeHouseholdAction,dissolveCakeHouseholdAction} from "@/actions/wedding-cakes";
import {getWeddingCakes} from "@/lib/wedding-cakes";
import {cakeMemberSnapshot,cakeRows} from "@/domain/wedding-cake";
const enabled=process.env.VOWBOOK_DB_INTEGRATION==="1";
const db=new PrismaClient();const idle={status:"idle" as const};
async function seed(){const user=await db.user.create({data:{googleSubject:"cakes-owner",email:"cakes@example.test"}});auth.id=user.id;const workspace=await db.weddingWorkspace.create({data:{name:"發餅測試",createdById:user.id,memberships:{create:{userId:user.id,role:"OWNER"}}}});const guests=await Promise.all(["甲","乙"].map(name=>db.guest.create({data:{workspaceId:workspace.id,name,side:"PARTNER_B",attendanceStatus:"ATTENDING"}})));return {workspace,guests};}
function form(guests:{id:string;version:number}[],h?:{version:number},members=guests){const f=new FormData();f.set("name","一家人");f.set("boxes","1");for(const g of guests)f.append("guestId",g.id);f.set("expectedVersion",String(h?.version??0));f.set("expectedMembers",cakeMemberSnapshot(h?members:[]));f.set("expectedGuests",JSON.stringify(Object.fromEntries(guests.map(g=>[g.id,g.version]))));return f;}
(enabled?describe:describe.skip).sequential("PostgreSQL cake households",()=>{
 beforeEach(async()=>{await db.weddingWorkspace.deleteMany();await db.user.deleteMany();});
 afterAll(async()=>{if(enabled){await db.weddingWorkspace.deleteMany();await db.user.deleteMany();}await db.$disconnect();});
 it("creates one household, edits boxes and dissolves without deleting guests",async()=>{
  const {workspace,guests}=await seed();
  expect(await saveCakeHouseholdAction(workspace.id,null,idle,form(guests))).toMatchObject({status:"success"});
  let data=await getWeddingCakes(workspace.id);expect(cakeRows(data.guests,data.households)).toHaveLength(1);
  let f=form(data.guests,data.households[0]);f.set("boxes","2");expect(await saveCakeHouseholdAction(workspace.id,data.households[0].id,idle,f)).toMatchObject({status:"success"});
  data=await getWeddingCakes(workspace.id);expect(cakeRows(data.guests,data.households)[0].boxes).toBe(2);
  f=form(data.guests,data.households[0]);expect(await dissolveCakeHouseholdAction(workspace.id,data.households[0].id,idle,f)).toMatchObject({status:"success"});
  data=await getWeddingCakes(workspace.id);expect(data.guests).toHaveLength(2);expect(data.households).toHaveLength(0);expect(cakeRows(data.guests,data.households)).toHaveLength(2);
 });
 it("rejects cross-workspace members and compound foreign keys",async()=>{
  const {workspace,guests}=await seed();const other=await db.weddingWorkspace.create({data:{name:"其他婚宴",createdById:auth.id,memberships:{create:{userId:auth.id,role:"OWNER"}}}});
  expect(await saveCakeHouseholdAction(other.id,null,idle,form(guests))).toMatchObject({code:"STALE"});
  const h=await db.weddingCakeHousehold.create({data:{workspaceId:other.id,name:"他戶"}});
  await expect(db.guest.update({where:{id:guests[0].id},data:{cakeHouseholdId:h.id}})).rejects.toMatchObject({code:"P2003"});
  expect(await db.guest.count({where:{workspaceId:workspace.id}})).toBe(2);
 });
 it("allows only one concurrent grouping of the same guests",async()=>{
  const {workspace,guests}=await seed();const result=await Promise.all([1,2].map(()=>saveCakeHouseholdAction(workspace.id,null,idle,form(guests))));expect(result.filter(r=>r.status==="success")).toHaveLength(1);expect(result.filter(r=>r.code==="STALE")).toHaveLength(1);expect(await db.weddingCakeHousehold.count()).toBe(1);
 });
 it("denies viewers and nonmembers reads and writes",async()=>{
  const {workspace,guests}=await seed();await db.membership.updateMany({where:{workspaceId:workspace.id},data:{role:"VIEWER"}});await expect(getWeddingCakes(workspace.id)).rejects.toThrow();expect(await saveCakeHouseholdAction(workspace.id,null,idle,form(guests))).toMatchObject({code:"FORBIDDEN"});await db.membership.deleteMany({where:{workspaceId:workspace.id}});await expect(getWeddingCakes(workspace.id)).rejects.toThrow();
 });
 it("rejects stale edits after a member has been removed",async()=>{
  const {workspace,guests}=await seed();await saveCakeHouseholdAction(workspace.id,null,idle,form(guests));const data=await getWeddingCakes(workspace.id);await db.guest.delete({where:{id:guests[0].id}});expect(await saveCakeHouseholdAction(workspace.id,data.households[0].id,idle,form(data.guests,data.households[0]))).toMatchObject({code:"STALE"});
 });
});
