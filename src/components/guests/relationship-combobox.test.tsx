import {fireEvent,render,screen} from "@testing-library/react";
import {useState} from "react";
import {expect,it,vi} from "vitest";
import {RelationshipCombobox} from "./relationship-combobox";
function Example(){const [value,setValue]=useState("二舅");return <form><label htmlFor="relation">關係稱謂</label><RelationshipCombobox id="relation" value={value} onChange={setValue}/><button type="submit">儲存</button></form>;}
it("searches aliases and submits the selected canonical title through one field",()=>{render(<Example/>);const input=screen.getByRole("combobox");expect(input).toHaveValue("二舅");fireEvent.focus(input);fireEvent.change(input,{target:{value:"舅媽"}});fireEvent.click(screen.getByRole("option",{name:/舅母（舅媽、妗母）/}));expect(input).toHaveValue("舅母");expect(screen.queryByRole("listbox")).not.toBeInTheDocument();expect(new FormData(input.closest("form")!).getAll("relationshipLabel")).toEqual(["舅母"]);});
it("supports partial fuzzy matching, keyboard selection and custom names",()=>{render(<Example/>);const input=screen.getByRole("combobox");fireEvent.change(input,{target:{value:"外父"}});expect(screen.getAllByRole("option").some(o=>o.textContent?.includes("外祖父"))).toBe(true);fireEvent.change(input,{target:{value:"爸爸"}});fireEvent.keyDown(input,{key:"Enter"});expect(input).toHaveValue("父親");fireEvent.change(input,{target:{value:"二舅媽"}});fireEvent.keyDown(input,{key:"Escape"});expect(input).toHaveValue("二舅媽");expect(screen.queryByRole("listbox")).not.toBeInTheDocument();});
it("does not select or submit when confirming Chinese IME composition",()=>{const submit=vi.fn(e=>e.preventDefault());render(<form onSubmit={submit}><RelationshipCombobox id="ime" value="爸爸" onChange={vi.fn()}/><button type="submit">儲存</button></form>);const input=screen.getByRole("combobox");fireEvent.focus(input);fireEvent.compositionStart(input);fireEvent.keyDown(input,{key:"Enter",isComposing:true});expect(submit).not.toHaveBeenCalled();expect(screen.getByRole("listbox")).toBeInTheDocument();});

it("shows a plain-language explanation next to the title without submitting it",()=>{
 render(<Example/>);
 const input=screen.getByRole("combobox");
 fireEvent.change(input,{target:{value:"爸爸的哥哥"}});
 fireEvent.click(screen.getByRole("option",{name:/伯父（伯伯）｜爸爸的哥哥/}));
 expect(input).toHaveValue("伯父");
});
