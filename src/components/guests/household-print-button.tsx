"use client";
import {Button} from "@/components/ui/button";
export function HouseholdPrintButton({label}:{label:string}) {
 return <Button variant="secondary" onClick={()=>window.print()}>{label}</Button>;
}
