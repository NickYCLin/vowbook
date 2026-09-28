import type { ReactNode } from "react";
import { WorkspaceLayoutClient } from "@/components/workspaces/workspace-frame";

// This layout owns navigation only. Every page/action retains its own Membership check.
export default async function WorkspaceLayout({ params, children }: {
  params: Promise<{ workspaceId: string }>;
  children: ReactNode;
}) {
  const { workspaceId } = await params;
  return <WorkspaceLayoutClient key={workspaceId} workspaceId={workspaceId}>{children}</WorkspaceLayoutClient>;
}
