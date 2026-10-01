import {render,screen} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
const {get,labels}=vi.hoisted(()=>({get:vi.fn(),labels:vi.fn()}));
vi.mock("@/lib/seating-plan",()=>({getSeatingPlan:get,getSeatingPrintDetails:labels}));
vi.mock("next/navigation",()=>({notFound:()=>{throw new Error("NOT_FOUND");}}));
import SeatingPrintPage from "./page";
const plan={workspace:{name:"婚宴"},tables:[{id:"t",number:1,name:"主桌",capacity:10,guests:[{id:"a",name:"王大明",partySize:2,vegetarianCount:1,childSeatCount:null}]}],unassignedGuests:[{id:"g",name:"待安排親友",partySize:2}]};
beforeEach(()=>{vi.clearAllMocks();labels.mockResolvedValue({relationships:new Map([["a","大舅"]]),households:new Map()});});
it("prints guests grouped by table with relationship titles for editors",async()=>{
 get.mockResolvedValue({...plan,role:"OWNER"});
 render(await SeatingPrintPage({params:Promise.resolve({workspaceId:"w"})}));
 expect(get).toHaveBeenCalledWith("w");expect(labels).toHaveBeenCalledWith("w");
 expect(screen.getByRole("button",{name:"列印帶位名單／另存 PDF"})).toBeInTheDocument();
 expect(document.querySelector("[data-print-document]")).not.toBeNull();
 const printCss=[...document.querySelectorAll("style")].map(style=>style.textContent).join("");
 expect(printCss).toMatch(/\.seating-group \{[^}]*display:block/u);
 expect(printCss).not.toContain("inline-block");
 // 整張桌卡不可切割時，第一桌比第一頁剩餘空間高就會把整個兩欄區塊推到下一頁；改成只在戶與戶之間換欄換頁。
 expect(printCss).not.toMatch(/\.seating-group \{[^}]*break-inside:avoid/u);
 expect(printCss).toMatch(/\.seating-party \{[^}]*break-inside:avoid/u);
 const card=screen.getByRole("heading",{name:"1 號桌 主桌"}).closest("article")!;
 expect(card.querySelector("thead")?.textContent).toContain("1 號桌 主桌");
 expect(card.querySelectorAll("tbody.seating-party")).toHaveLength(1);
 expect(screen.getByRole("heading",{name:"1 號桌 主桌"})).toBeInTheDocument();
 expect(screen.getByRole("heading",{name:"尚未排桌"})).toBeInTheDocument();
 expect(screen.getAllByRole("columnheader",{name:"稱謂"}).length).toBe(2);
 expect(screen.getByRole("cell",{name:"大舅"})).toBeInTheDocument();
 expect(screen.getByRole("cell",{name:"素 1"})).toBeInTheDocument();
 expect(screen.queryByRole("columnheader",{name:"所屬親友"})).toBeNull();
 expect(screen.queryByRole("columnheader",{name:"備註"})).toBeNull();
 // 帶位名單只看座位，不需要勾選框。
 expect(screen.queryByRole("img",{name:/勾選框/u})).toBeNull();
 expect(screen.queryByRole("columnheader",{name:"帶位勾選"})).toBeNull();
 expect(screen.queryByText(/打勾/u)).toBeNull();
});
it("does not read or print relationship titles for viewers",async()=>{
 get.mockResolvedValue({...plan,role:"VIEWER"});
 render(await SeatingPrintPage({params:Promise.resolve({workspaceId:"w"})}));
 expect(labels).not.toHaveBeenCalled();
 expect(screen.queryByRole("columnheader",{name:"稱謂"})).toBeNull();
});
it("hides the print route without workspace membership",async()=>{
 get.mockRejectedValue(new WorkspaceAccessDeniedError());
 await expect(SeatingPrintPage({params:Promise.resolve({workspaceId:"other"})})).rejects.toThrow("NOT_FOUND");
});
