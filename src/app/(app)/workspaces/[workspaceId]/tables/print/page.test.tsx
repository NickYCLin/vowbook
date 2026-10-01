import {render,screen} from "@testing-library/react";
import {beforeEach,expect,it,vi} from "vitest";
import {WorkspaceAccessDeniedError} from "@/domain/workspace";
const {get,labels}=vi.hoisted(()=>({get:vi.fn(),labels:vi.fn()}));
vi.mock("@/lib/seating-plan",()=>({getSeatingPlan:get,getSeatingPrintDetails:labels}));
vi.mock("next/navigation",()=>({notFound:()=>{throw new Error("NOT_FOUND");}}));
import SeatingPrintPage from "./page";
const plan={workspace:{name:"婚宴",weddingDate:null,timezone:"Asia/Taipei"},tables:[{id:"t",number:1,position:0,layoutX:null,layoutY:null,name:"主桌",capacity:10,guests:[{id:"a",name:"王大明",side:"PARTNER_A",partySize:2,vegetarianCount:1,childSeatCount:null}]},{id:"e",number:2,position:1,layoutX:null,layoutY:null,name:"空桌",capacity:10,guests:[]}],unassignedGuests:[{id:"g",name:"待安排親友",partySize:2}]};
beforeEach(()=>{vi.clearAllMocks();labels.mockResolvedValue({relationships:new Map([["a","大舅"]]),households:new Map()});});
it("prints guests grouped by table with relationship titles for editors",async()=>{
 get.mockResolvedValue({...plan,role:"OWNER"});
 render(await SeatingPrintPage({params:Promise.resolve({workspaceId:"w"})}));
 expect(get).toHaveBeenCalledWith("w");expect(labels).toHaveBeenCalledWith("w");
 expect(screen.getByRole("button",{name:"列印帶位名單／另存 PDF"})).toBeInTheDocument();
 expect(document.querySelector("[data-print-document]")).not.toBeNull();
 const printCss=[...document.querySelectorAll("style")].map(style=>style.textContent).join("");
 // 一張 A4 印完：直式三欄、每桌不切開。
 expect(printCss).toMatch(/size:A4 portrait/u);
 expect(printCss).toMatch(/columns:3/u);
 expect(printCss).toMatch(/\.seating-group \{[^}]*break-inside:avoid/u);
 const card=screen.getByRole("heading",{name:"1 號桌 主桌"}).closest("article")!;
 expect(card.textContent).toContain("王大明");
 // 名單只列姓名；人數、素食與兒童椅看桌圖。
 expect(card.querySelector("ul")?.textContent).toBe("王大明");
 // 桌圖和帶位名單一起印，各一張 A4；空桌照樣出現在桌圖上，但不印進帶位名單。
 const chart=document.querySelector("[data-seating-print-chart]")!;
 expect(chart.className).toContain("print:break-after-page");
 expect(chart.querySelector("[data-testid=seating-chart-poster]")).not.toBeNull();
 expect(printCss).not.toContain("406.4mm");
 expect(chart.querySelector('[aria-label^="1 號桌"]')).not.toBeNull();
 expect(chart.querySelector('[aria-label^="2 號桌"]')).toBeNull();
 expect(chart.textContent).toContain("共 1 桌");
 const sheet=document.querySelector("[data-seating-print]")!;
 expect(sheet.textContent).not.toContain("空桌");
 expect(sheet.textContent).toContain("1 桌 · 2 位");
 // 稱謂、欄位標題、說明文字與尚未排桌都不印。
 expect(screen.queryByRole("columnheader")).toBeNull();
 expect(screen.queryByText("大舅")).toBeNull();
 expect(screen.queryByRole("heading",{name:"尚未排桌"})).toBeNull();
 expect(screen.queryByText("待安排親友")).toBeNull();
 expect(screen.getByText(/還有 2 位尚未排桌/u).closest(".print\\:hidden")).not.toBeNull();
 // 帶位名單只看座位，不需要勾選框。
 expect(screen.queryByRole("img",{name:/勾選框/u})).toBeNull();
 expect(screen.queryByRole("columnheader",{name:"帶位勾選"})).toBeNull();
 expect(screen.queryByText(/打勾/u)).toBeNull();
});
it("does not read or print relationship titles for viewers",async()=>{
 get.mockResolvedValue({...plan,role:"VIEWER"});
 render(await SeatingPrintPage({params:Promise.resolve({workspaceId:"w"})}));
 expect(labels).not.toHaveBeenCalled();
 expect(screen.getByRole("heading",{name:"1 號桌 主桌"})).toBeInTheDocument();
});
it("hides the print route without workspace membership",async()=>{
 get.mockRejectedValue(new WorkspaceAccessDeniedError());
 await expect(SeatingPrintPage({params:Promise.resolve({workspaceId:"other"})})).rejects.toThrow("NOT_FOUND");
});
