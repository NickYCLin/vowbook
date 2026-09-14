import {render,screen,within} from "@testing-library/react";
import {expect,it} from "vitest";
import {HouseholdPrintSheet} from "./household-print-sheet";
it("prints gift households with a blank amount column and exemption notes",()=>{
 const {container}=render(<HouseholdPrintSheet workspaceName="婚宴" kind="gifts" rows={[
  {key:"a",group:"GROOM_FAMILY",names:"父親一家",relationships:"新郎的父親",exempt:false,notes:""},
  {key:"b",group:"BRIDE_FAMILY",names:"阿姨一家",relationships:"新娘的姨母",exempt:true,notes:"不收禮金、會送餅"},
 ]}/>);
 expect(screen.getAllByRole("columnheader",{name:"禮金金額（元）"})).toHaveLength(2);
 expect(container.querySelectorAll('[data-gift-amount-blank]')).toHaveLength(1);
 expect(container.querySelector('[data-gift-amount-blank]')).toHaveTextContent("");
 expect(within(screen.getByRole("region",{name:"新娘的親戚家人"})).getByText("不收禮金")).toBeInTheDocument();
 expect(screen.getByText("不收禮金、會送餅")).toBeInTheDocument();
 expect(screen.queryByRole("img",{name:"領取勾選框"})).not.toBeInTheDocument();
});

it("replaces the amount blank with a polite receipt label for received households",()=>{
 const {container}=render(<HouseholdPrintSheet workspaceName="婚宴" kind="gifts" rows={[
  {key:"a",group:"GROOM_FRIENDS",names:"已收一家",relationships:"朋友",giftReceived:true},
  {key:"b",group:"BRIDE_FRIENDS",names:"未登記一家",relationships:"朋友",giftReceived:false},
 ]}/>);
 expect(screen.getByText("禮金已收訖")).toBeInTheDocument();
 expect(container.querySelectorAll('[data-gift-amount-blank]')).toHaveLength(1);
 expect(within(screen.getByRole("region",{name:"新郎的朋友"})).getByRole("cell",{name:"禮金已收訖"})).toBeInTheDocument();
});
