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
  GearSix,
  Files,
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
  | "documents"
  | "staff"
  | "timeline"
  | "members"
  | "settings";

export type WorkspaceSectionGroup = "home" | "preparation" | "day-of" | "admin";

/** 籌備、婚禮當天、管理三組，和 iOS 的 WorkspaceSectionGroup 相同。 */
export const workspaceSectionGroups: readonly { key: Exclude<WorkspaceSectionGroup, "home">; label: string }[] = [
  { key: "preparation", label: "籌備" },
  { key: "day-of", label: "婚禮當天" },
  { key: "admin", label: "管理" },
];

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
  group: WorkspaceSectionGroup;
};

/**
 * 工作區的十二個功能頁，桌機側欄、手機底部功能列與婚宴首頁的入口
 * 都從這一份定義讀；順序依組別排好，避免各處各自維護順序與圖示。
 */
export const workspaceSections: readonly WorkspaceSectionDefinition[] = [
  { key: "overview", label: "婚宴首頁", segment: "overview", icon: House, primaryOnMobile: true, group: "home" },
  { key: "guests", label: "賓客", segment: "guests", icon: UsersThree, primaryOnMobile: true, group: "preparation" },
  { key: "tables", label: "桌次", segment: "tables", icon: Chair, primaryOnMobile: false, group: "preparation" },
  { key: "tasks", label: "任務", segment: "tasks", icon: ListChecks, primaryOnMobile: true, group: "preparation" },
  { key: "budget", label: "花費", segment: "budget", icon: Wallet, primaryOnMobile: true, group: "preparation" },
  { key: "documents", label: "文件", segment: "documents", icon: Files, primaryOnMobile: false, group: "preparation" },
  { key: "check-in", label: "報到", segment: "check-in", icon: ClipboardText, primaryOnMobile: false, group: "day-of" },
  { key: "gifts", label: "禮金", segment: "gifts", icon: Gift, primaryOnMobile: false, group: "day-of" },
  { key: "timeline", label: "總流程", segment: "timeline", icon: Path, primaryOnMobile: false, group: "day-of" },
  { key: "staff", label: "工作人員", segment: "staff", icon: IdentificationBadge, primaryOnMobile: false, group: "day-of" },
  { key: "members", label: "協作者", segment: "members", icon: Users, primaryOnMobile: false, group: "admin" },
  { key: "settings", label: "婚宴設定", segment: "settings", icon: GearSix, primaryOnMobile: false, group: "admin" },
];

/** 側欄排序用：每組標題排在該組第一項之前。 */
export function workspaceNavOrder(key: WorkspaceSection): number {
  return workspaceSections.findIndex(section => section.key === key) * 2 + 1;
}

export function workspaceGroupNavOrder(group: WorkspaceSectionGroup): number {
  return workspaceSections.findIndex(section => section.group === group) * 2;
}

export function workspaceSectionHref(
  workspaceId: string,
  section: Pick<WorkspaceSectionDefinition, "segment">,
): string {
  return `/workspaces/${workspaceId}/${section.segment}`;
}
