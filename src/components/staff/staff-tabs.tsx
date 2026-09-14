import Link from "next/link";
export function StaffTabs({ workspaceId, active }: { workspaceId: string; active: "staff" | "handoffs" }) {
  return <nav aria-label="工作人員分頁" className="mb-6 flex flex-wrap gap-2 border-b border-line pb-3">
    <Link href={`/workspaces/${workspaceId}/staff`} aria-current={active === "staff" ? "page" : undefined} className="inline-flex min-h-11 items-center rounded-control px-4 aria-[current=page]:bg-clay-soft">人員名單</Link>
    <Link href={`/workspaces/${workspaceId}/staff/handoffs`} aria-current={active === "handoffs" ? "page" : undefined} className="inline-flex min-h-11 items-center rounded-control px-4 aria-[current=page]:bg-clay-soft">總召交辦</Link>
  </nav>;
}
