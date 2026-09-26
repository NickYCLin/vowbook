import {
  ClipboardText,
  Gift,
  House,
  IdentificationBadge,
  ListChecks,
  Path,
  Users,
  UsersThree,
  Wallet,
  Chair,
} from "@phosphor-icons/react/dist/ssr";
import type { ComponentType } from "react";

export type WorkspaceSection =
  | "overview"
  | "guests"
  | "tables"
  | "check-in"
  | "gifts"
  | "tasks"
  | "budget"
  | "staff"
  | "timeline"
  | "members";

export type WorkspaceSectionIcon = ComponentType<{
  className?: string;
  weight?: "regular" | "fill";
  "aria-hidden"?: boolean | "true";
}>;

export type WorkspaceSectionDefinition = {
  key: WorkspaceSection;
  label: string;
  segment: string;
  icon: WorkspaceSectionIcon;
  /**
   * 手機底部功能列只放得下四個主要入口（加上「更多」剛好是 iOS 的五格上限）。
   * 其餘功能收進「更多」面板；順序以婚宴當天會用到的排前面。
   */
  primaryOnMobile: boolean;
};

/**
 * 工作區的十一個功能頁，桌機頁籤、手機底部功能列與「所有婚宴」卡片的
 * 快速入口都從這一份定義讀，避免三處各自維護順序與圖示。
 */
export const workspaceSections: readonly WorkspaceSectionDefinition[] = [
  { key: "overview", label: "總覽", segment: "overview", icon: House, primaryOnMobile: true },
  { key: "guests", label: "賓客", segment: "guests", icon: UsersThree, primaryOnMobile: true },
  { key: "tables", label: "桌次", segment: "tables", icon: Chair, primaryOnMobile: false },
  { key: "check-in", label: "報到", segment: "check-in", icon: ClipboardText, primaryOnMobile: false },
  { key: "gifts", label: "禮金", segment: "gifts", icon: Gift, primaryOnMobile: false },
  { key: "tasks", label: "任務", segment: "tasks", icon: ListChecks, primaryOnMobile: true },
  { key: "budget", label: "花費", segment: "budget", icon: Wallet, primaryOnMobile: true },
  { key: "staff", label: "工作人員", segment: "staff", icon: IdentificationBadge, primaryOnMobile: false },
  { key: "timeline", label: "總流程", segment: "timeline", icon: Path, primaryOnMobile: false },
  { key: "members", label: "協作者", segment: "members", icon: Users, primaryOnMobile: false },
];

export function workspaceSectionHref(
  workspaceId: string,
  section: Pick<WorkspaceSectionDefinition, "segment">,
): string {
  return `/workspaces/${workspaceId}/${section.segment}`;
}
