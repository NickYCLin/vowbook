import { WorkspaceSectionTabs } from "@/components/workspaces/workspace-section-tabs";
export function StaffTabs({ workspaceId, active }: { workspaceId: string; active: "staff" | "handoffs" }) {
  return <WorkspaceSectionTabs label="工作人員分頁" items={[
    {label:"人員名單",href:`/workspaces/${workspaceId}/staff`,active:active==="staff"},
    {label:"總召交辦",href:`/workspaces/${workspaceId}/staff/handoffs`,active:active==="handoffs"},
  ]}/>;
}
