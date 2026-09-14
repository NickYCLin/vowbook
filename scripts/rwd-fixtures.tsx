/**
 * RWD 稽核用的頁面樣本。
 *
 * 這裡直接渲染正式元件（不是複製一份 markup），只有外層 app shell
 * 依 src/app/(app)/layout.tsx 的 class 逐字複寫，因為那層是需要登入
 * 的 server component，離線渲染不到。
 *
 * 每個樣本都刻意塞入超長姓名、Email 與不換行的長字串，
 * 因為手機版真正會爆版的是內容而不是骨架。
 */
import { WeddingCakeBoard } from "@/components/guests/wedding-cake-board";
import { HandoffBoard } from "@/components/handoffs/handoff-board";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HomePage from "@/app/page";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { SystemUserList } from "@/components/admin/system-user-list";
import { BudgetList } from "@/components/budget/budget-list";
import SignInPage from "@/app/signin/page";
import { CreateWorkspaceForm } from "@/components/workspaces/create-workspace-form";
import { GuestCheckInBoard } from "@/components/check-in/guest-check-in-board";
import { GuestList } from "@/components/guests/guest-list";
import { WeddingGiftBook } from "@/components/guests/wedding-gift-book";
import { SeatingChart } from "@/components/tables/seating-chart";
import { SeatingPlan } from "@/components/tables/seating-plan";
import { UnassignGuestForm } from "@/components/tables/table-forms";
import { WeddingStaffList } from "@/components/staff/staff-list";
import { WeddingTaskList } from "@/components/tasks/task-list";
import { ThemeMenu } from "@/components/theme/theme-menu";
import { WeddingTimelineList } from "@/components/timeline/timeline-list";
import { WorkspaceMembersPanel } from "@/components/workspaces/workspace-members";
import { WorkspaceSummary } from "@/components/workspaces/workspace-summary";
import { WeddingOverview } from "@/components/workspaces/wedding-overview";
import {
  WorkspacePageHeader,
  type WorkspaceSection,
} from "@/components/workspaces/workspace-shell";
import { seatingTableNumber } from "@/domain/seating-table";

const LONG_NAME =
  "陳王李張林黃吳劉蔡楊許鄭謝洪郭邱曾廖賴周葉蘇莊呂江何蕭羅高潘簡朱鍾游詹胡施沈余盧梁趙顏柯翁魏孫戴范方宋鄧杜傅侯曹薛丁卓阮馬董温唐藍石";
const LONG_EMAIL =
  "a-very-long-wedding-planner-mailbox.address+vowbook@subdomain.example-company-name.com.tw";
const LONG_URL_ISH =
  "https://drive.example.com/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789/婚宴資料夾";

function AppShell({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-paper">
      <header className="sticky top-0 z-40 border-b border-line bg-surface/85 pt-[env(safe-area-inset-top)] backdrop-blur-md print:hidden">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-3 sm:px-8">
          <span className="font-serif text-lg font-semibold text-ink">
            誓約簿 VowBook
          </span>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <ThemeMenu displayName={LONG_EMAIL} initial="誓" />
            <span className="hidden sm:block">
              <SignOutButton variant="ghost" />
            </span>
          </div>
        </div>
      </header>
      {children}
    </div>
  );
}

function WorkspacePage({
  sectionTitle,
  description,
  activeSection,
  readOnlyNotice,
  actions,
  children,
}: {
  sectionTitle: string;
  description: string;
  activeSection: WorkspaceSection;
  readOnlyNotice?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <AppShell>
      <main className="mx-auto w-full max-w-6xl min-w-0 px-5 py-6 sm:px-8 sm:py-12">
        <WorkspacePageHeader
          workspaceId="workspace_rwd"
          workspaceName={`${LONG_NAME.slice(0, 18)}的婚宴`}
          sectionTitle={sectionTitle}
          description={description}
          activeSection={activeSection}
          readOnlyNotice={readOnlyNotice}
          actions={actions}
        />
        {children}
      </main>
    </AppShell>
  );
}

const checkInGuestFixture = (
  index: number,
  overrides: Partial<
    Parameters<typeof GuestCheckInBoard>[0]["guests"][number]
  > = {},
): Parameters<typeof GuestCheckInBoard>[0]["guests"][number] => ({
  id: `check_in_guest_${index}`,
  name: index === 0 ? LONG_NAME : `報到賓客 ${index}`,
  category: index === 1 ? "FAMILY" : "GUEST",
  side: (["PARTNER_A", "PARTNER_B", "SHARED"] as const)[index % 3],
  attendanceStatus: (["ATTENDING", "ATTENDING", "DECLINED", "UNDECIDED"] as const)[
    index % 4
  ],
  partySize: (index % 8) + 1,
  notes: null,
  seatingTable:
    index % 3 === 2
      ? null
      : {
          number: index + 1,
          name: index === 0 ? LONG_NAME : `宴客桌 ${index + 1}`,
        },
  checkIn:
    index % 2 === 0
      ? {
          id: `check_in_${index}`,
          headcount: (index % 8) + 1,
          notes: index === 0 ? `${LONG_NAME}\n${LONG_URL_ISH}` : null,
          version: 3,
        }
      : null,
  ...overrides,
});

const checkInTableFixture = (
  index: number,
): Parameters<typeof GuestCheckInBoard>[0]["tables"][number] => ({
  id: `check_in_table_${index}`,
  number: index + 1,
  name: index === 0 ? LONG_NAME : `宴客桌 ${index + 1}`,
  capacity: 10,
  expectedHeadcount: (index % 8) + 2,
  arrivedHeadcount: index % 3,
  pendingGroups: index % 2,
});

const guestFixture = (
  index: number,
  overrides: Partial<Parameters<typeof GuestList>[0]["guests"][number]> = {},
): Parameters<typeof GuestList>[0]["guests"][number] => ({
  id: `guest_${index}`,
  version: 1,
  name: index === 0 ? LONG_NAME : "賓客 " + index,
  category: "GUEST",
  seniority: "UNSPECIFIED",
  side: (["PARTNER_A", "PARTNER_B", "SHARED"] as const)[index % 3],
  attendanceStatus: (["UNDECIDED", "ATTENDING", "DECLINED"] as const)[index % 3],
  partySize: (index % 8) + 1,
  notes: index === 0 ? LONG_URL_ISH : null,
  seatingTable:
    index % 2 === 0
      ? { number: index + 1, name: `宴客桌 ${index + 1}` }
      : null,
  weddingGift:
    index % 3 === 0
      ? {
          id: `gift_${index}`,
          amount: index === 0 ? 2_147_483_647 : 36_000 + index,
          notes: index === 0 ? `${LONG_NAME}\n${LONG_URL_ISH}` : null,
          createdAt: new Date(2026, 7, 30, 10, index),
          returnGiftSentAt: index % 6 === 0 ? new Date(2026, 8, 5) : null,
          returnGiftNote: index % 6 === 0 ? "寄了 2 盒喜餅" : null,
          version: 2,
        }
      : null,
  // 每四筆有一筆已報到，讓報到欄位與刪除警告在 RWD 量測時也吃得到真值。
  checkIn:
    index % 4 === 0
      ? { id: `check_in_${index}`, headcount: (index % 8) + 1, version: 1 }
      : null,
  // 聯絡與回覆資料可來自匯入或人工補充；畫面統一用一般賓客欄位呈現。
  details:
    index === 1
      ? {
          relationshipLabel: "大學同學",
          contactPhone: "0900-000-000",
          contactEmail: "guest@example.com",
          ceremonyAttendance: true,
          childSeatCount: 0,
          vegetarianCount: 1,
          invitationDelivery: "DIGITAL" as const,
          mailingAddress: LONG_URL_ISH,
          guestMessage: LONG_NAME,
          attendanceReply: "會出席",
          invitationReply: "已收到",
        }
      : null,
  importRecords:
    index === 1
      ? [
          {
            provenanceKey: `guest_${index}_linein`,
            source: "LINEIN",
            sourceLabel: "拍拍印",
            sourceManaged: true,
            managedFields: ["NAME" as const],
            details: {
              sourcePartySize: 2,
              relationshipLabel: "大學同學",
              contactPhone: "0900-000-000",
              contactEmail: "guest@example.com",
              ceremonyAttendance: true,
              childSeatCount: 0,
              vegetarianCount: 1,
              invitationDelivery: "DIGITAL" as const,
              mailingAddress: LONG_URL_ISH,
              guestMessage: LONG_NAME,
              attendanceReply: "會出席",
              invitationReply: "已收到",
              sourceSubmittedAt: new Date("2026-05-01T02:00:00.000Z"),
            },
          },
        ]
      : [],
  ...overrides,
});


/** 花費頁的階層帳本：階段 → 品項分類 → 來源群組 → 實際花費。 */
const budgetItem = (
  overrides: Partial<Parameters<typeof BudgetList>[0]["items"][number]> &
    Pick<
      Parameters<typeof BudgetList>[0]["items"][number],
      "id" | "depth" | "name" | "kind"
    >,
): Parameters<typeof BudgetList>[0]["items"][number] => ({
  parentId: null,
  hasChildren: false,
  breadcrumb: [],
  directChildren: [],
  directChildCount: 0,
  directChildSetHash: `hash_${overrides.id}`,
  descendantCount: 0,
  source: "MANUAL",
  category: "VENUE_CATERING",
  relatedTaxonomyItemKey: null,
  directParentName: null,
  plannedAmount: 128_000,
  rolledUpPlannedAmount: "128000",
  actualAmount: 143_500,
  rolledUpActualAmount: "143500",
  rolledUpDepositAmount: "30000",
  rolledUpBalanceAmount: "113500",
  dueDate: "2026-09-30",
  notes: null,
  paid: false,
  paidAt: null,
  bookingStatus: "BOOKED_BALANCE_DUE",
  preparationStatus: "NEEDS_ACTION",
  depositAmount: 30_000,
  balanceAmount: 113_500,
  additionalAmount: null,
  estimatedRange: null,
  candidateVendors: null,
  confirmedVendor: null,
  vendorContact: null,
  primaryContact: "PARTNER_A",
  version: 1,
  ...overrides,
});

const budgetItems = [
  budgetItem({
    id: "stage_1",
    depth: 0,
    name: "籌備第 1-2 月",
    kind: "GROUP",
    hasChildren: true,
    directChildCount: 1,
    descendantCount: 3,
    directChildren: [{ id: "item_1", name: "婚紗照拍攝", hasChildren: true }],
  }),
  budgetItem({
    id: "item_1",
    parentId: "stage_1",
    depth: 1,
    name: `${LONG_NAME.slice(0, 24)}婚紗照拍攝`,
    kind: "GROUP",
    hasChildren: true,
    breadcrumb: ["籌備第 1-2 月"],
    directParentName: "籌備第 1-2 月",
    directChildCount: 3,
    descendantCount: 3,
    directChildren: [
      { id: "leaf_1", name: "婚紗攝影方案", hasChildren: false },
      { id: "leaf_2", name: "小白鞋", hasChildren: false },
      { id: "leaf_3", name: "不另外準備西裝", hasChildren: false },
    ],
  }),
  budgetItem({
    id: "leaf_1",
    parentId: "item_1",
    depth: 2,
    name: `${LONG_NAME.slice(0, 40)}婚紗攝影方案`,
    kind: "EXPENSE",
    breadcrumb: ["籌備第 1-2 月", "婚紗照拍攝"],
    directParentName: "婚紗照拍攝",
    notes: LONG_URL_ISH,
    confirmedVendor: LONG_NAME.slice(0, 30),
    vendorContact: LONG_EMAIL,
    plannedAmount: 1_288_000,
    rolledUpPlannedAmount: "1288000",
    actualAmount: 1_343_500,
    rolledUpActualAmount: "1343500",
    rolledUpDepositAmount: "30000",
    rolledUpBalanceAmount: "113500",
  }),
  budgetItem({
    id: "leaf_2",
    parentId: "item_1",
    depth: 2,
    name: "小白鞋",
    kind: "EXPENSE",
    breadcrumb: ["籌備第 1-2 月", "婚紗照拍攝"],
    directParentName: "婚紗照拍攝",
    source: "NOTION",
    paid: true,
    paidAt: "2026-07-01",
    bookingStatus: "PAID",
    preparationStatus: "ALREADY_OWNED",
    plannedAmount: 2_680,
    rolledUpPlannedAmount: "2680",
    actualAmount: 2_680,
    rolledUpActualAmount: "2680",
    rolledUpDepositAmount: "0",
    rolledUpBalanceAmount: "0",
  }),
  budgetItem({
    id: "leaf_3",
    parentId: "item_1",
    depth: 2,
    name: "不另外準備西裝",
    kind: "EXPENSE",
    breadcrumb: ["籌備第 1-2 月", "婚紗照拍攝"],
    directParentName: "婚紗照拍攝",
    preparationStatus: "NOT_PLANNED",
    plannedAmount: 38_000,
    actualAmount: null,
    rolledUpPlannedAmount: "0",
    rolledUpActualAmount: "0",
    rolledUpDepositAmount: "0",
    rolledUpBalanceAmount: "0",
  }),
];

const budgetSummary = {
  itemCount: 1,
  paidCount: 0,
  plannedTotal: "1288000",
  actualTotal: "1343500",
  balanceDueTotal: "113500",
  balanceDueCount: 1,
  overdueBalanceDueCount: 0,
  balanceDueMissingAmountCount: 0,
  nearestUpcomingBalanceDueDate: "2026-09-30",
  selfProvidedCount: 1,
  notPlannedCount: 1,
};

const surfaces: { name: string; element: ReactNode }[] = [
  ...[false, true].map(open => ({ name: open ? "cakes-editor" : "cakes", element: <AppShell><WeddingCakeBoard workspaceId="rwd" defaultCreateOpen={open} data={{ workspace: {id:"rwd", name:LONG_NAME}, households:[{id:"home",name:LONG_NAME,boxes:1,version:0}], guests:[{id:"guest",name:LONG_NAME,version:0,seniority:"ELDER",attendanceStatus:"ATTENDING",partySize:3,checkedIn:false,side:"PARTNER_A",relationshipLabel:LONG_NAME,cakeHouseholdId:"home"},{id:"guest2",name:LONG_URL_ISH,version:0,seniority:"PEER",attendanceStatus:"ATTENDING",partySize:1,checkedIn:false,side:"PARTNER_A",relationshipLabel:"舅母",cakeHouseholdId:null}] }}/></AppShell> })),

  {
    name: "system-admin-users",
    element: (
      <AppShell>
        <main className="mx-auto w-full max-w-6xl min-w-0 px-5 py-6 sm:px-8 sm:py-12">
          <header className="min-w-0">
            <p className="text-eyebrow font-semibold text-clay uppercase">
              系統管理
            </p>
            <h1 className="mt-2 font-serif text-2xl font-semibold text-ink sm:text-3xl">
              使用者管理
            </h1>
            <p className="mt-2 max-w-3xl text-caption leading-6 text-ink-soft sm:text-base">
              查看目前使用這個 VowBook 環境的帳號、最近登入與婚宴成員關係。
            </p>
          </header>
          <SystemUserList
            users={Array.from({ length: 4 }, (_, index) => ({
              id: `rwd_user_${index}`,
              email: index === 0 ? LONG_EMAIL : `user-${index}@example.test`,
              name: index === 0 ? LONG_NAME : `合成使用者 ${index}`,
              image: null,
              accessStatus: (["ACTIVE", "SUSPENDED", "REMOVED", "ACTIVE"] as const)[index],
              accessStatusChangedAt:
                index === 0 ? null : "2026-08-23T01:00:00.000Z",
              lastLoginAt:
                index === 2 ? null : "2026-08-24T01:00:00.000Z",
              version: index,
              createdAt: "2026-08-01T01:00:00.000Z",
              systemAdmin: index === 0,
              memberships:
                index === 2
                  ? []
                  : [
                      {
                        role: index === 0 ? ("OWNER" as const) : ("PLANNER" as const),
                        workspace: {
                          id: `rwd_admin_workspace_${index}`,
                          name: `${LONG_NAME.slice(0, 42)}的婚宴工作區`,
                        },
                      },
                    ],
            }))}
          />
        </main>
      </AppShell>
    ),
  },
  {
    name: "dashboard",
    element: (
      <AppShell>
        <main className="mx-auto w-full max-w-6xl min-w-0 px-5 py-6 sm:px-8 sm:py-12">
          <header className="min-w-0">
            <h1 className="font-serif text-2xl font-semibold text-ink sm:text-3xl">
              我的婚宴
            </h1>
            <p className="mt-2 max-w-2xl text-caption leading-6 text-ink-soft sm:text-base">
              選擇一場婚宴繼續籌備，或建立新的工作區。
            </p>
          </header>
          <div className="mt-6 min-w-0 space-y-5">
            <WorkspaceSummary
              role="OWNER"
              workspace={
                {
                  id: "workspace_rwd",
                  name: `${LONG_NAME}的世紀婚宴`,
                  weddingDate: new Date("2026-11-08T02:00:00.000Z"),
                  timezone: "Asia/Taipei",
                  createdAt: new Date("2026-01-01T00:00:00.000Z"),
                  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
                } as Parameters<typeof WorkspaceSummary>[0]["workspace"]
              }
              stats={{
                guestTotal: 288,
                guestResponded: 176,
                guestAttending: 154,
                attendingHeadcount: 412,
                tableTotal: 42,
                taskTotal: 128,
                taskDone: 97,
                budgetPlanned: 1_880_000,
                budgetActual: 2_143_500,
              }}
              now={new Date("2026-08-13T02:00:00.000Z")}
            />
            <WorkspaceSummary
              role="VIEWER"
              workspace={
                {
                  id: "workspace_rwd_2",
                  name: "小型家宴",
                  weddingDate: null,
                  timezone: "Asia/Taipei",
                  createdAt: new Date("2026-01-01T00:00:00.000Z"),
                  updatedAt: new Date("2026-08-01T00:00:00.000Z"),
                } as Parameters<typeof WorkspaceSummary>[0]["workspace"]
              }
              now={new Date("2026-08-13T02:00:00.000Z")}
            />
          </div>
        </main>
      </AppShell>
    ),
  },
  {
    name: "overview",
    element: (
      <WorkspacePage
        sectionTitle="婚宴總覽"
        description="集中查看賓客回覆、入席安排、任務、花費與婚宴執行進度。"
        activeSection="overview"
      >
        <WeddingOverview
          workspaceId="workspace_rwd"
          data={{
            guests: {
              generalGroupTotal: 288,
              respondedGroupTotal: 176,
              attendingGroupTotal: 154,
              declinedGroupTotal: 22,
              undecidedGroupTotal: 112,
              attendingHeadcount: 412,
              assignedAttendingHeadcount: 368,
              unassignedAttendingHeadcount: 44,
              childSeatCount: 18,
              vegetarianCount: 36,
              bySide: {
                PARTNER_A: {
                  groupTotal: 132,
                  attendingGroupTotal: 72,
                  attendingHeadcount: 188,
                },
                PARTNER_B: {
                  groupTotal: 128,
                  attendingGroupTotal: 68,
                  attendingHeadcount: 184,
                },
                SHARED: {
                  groupTotal: 28,
                  attendingGroupTotal: 14,
                  attendingHeadcount: 40,
                },
              },
              invitations: {
                PAPER: 96,
                DIGITAL: 148,
                NONE: 12,
                UNKNOWN: 32,
                UNSET: 18,
              },
              gifts: {
                recordedCount: 238,
                unrecordedGeneralGroupCount: 50,
                totalAmount: "2688800",
              },
            },
            seating: {
              tableTotal: 42,
              capacityTotal: 440,
              assignedHeadcount: 368,
              remainingCapacity: 72,
            },
            tasks: {
              total: 128,
              todo: 20,
              inProgress: 11,
              done: 97,
              overdue: 3,
            },
            budget: {
              itemCount: 58,
              planningCount: 17,
              balanceDueCount: 12,
              overdueBalanceDueCount: 3,
              paidCount: 29,
              plannedTotal: "1880000",
              actualTotal: "2143500",
              balanceDueTotal: "680000",
              selfProvidedCount: 6,
              notPlannedCount: 4,
            },
            operations: {
              staffTotal: 24,
              timelineItemTotal: 36,
              memberTotal: 4,
            },
          }}
        />
      </WorkspacePage>
    ),
  },
  {
    name: "guests",
    element: (
      <WorkspacePage
        sectionTitle="賓客名單"
        description="整理邀請名單、宴席需求與座位安排。"
        activeSection="guests"
      >
        <GuestList
          workspaceId="workspace_rwd"
          canEdit
          guests={Array.from({ length: 8 }, (_, index) => guestFixture(index,
            index === 2 ? {category:"FAMILY",side:"PARTNER_B",name:LONG_NAME} :
            index === 3 ? {category:"FAMILY",side:"SHARED"} : {}
          ))}
        />
      </WorkspacePage>
    ),
  },
  {
    // 大量邀請群組、超長姓名、接近 Int 上限的金額一起出現；展開狀態要在
    // 320px 手機到桌機都沒有水平溢出或過小觸控目標。
    name: "gifts",
    element: (
      <WorkspacePage
        sectionTitle="禮金簿"
        description="依邀請群組登記收到的禮金；禮金不屬於婚宴支出，也不受出席狀態影響。"
        activeSection="gifts"
      >
        <WeddingGiftBook
          workspaceId="workspace_rwd"
          canEdit
          collapsible={false}
          guests={Array.from({ length: 48 }, (_, index) =>
            guestFixture(index, {
              name:
                index % 11 === 0
                  ? `${LONG_NAME}第${index + 1}邀請群組`
                  : `禮金簿大量名單第 ${index + 1} 組`,
              category: index === 1 ? "FAMILY" : "GUEST",
              giftExemptWithCake: index % 5 === 2,
              weddingGift:
                index % 3 === 0 || index === 1
                  ? {
                      id: `gift_ledger_${index}`,
                      amount:
                        index === 0 ? 2_147_483_647 : 1_280_000 + index,
                      notes: index % 11 === 0 ? LONG_URL_ISH : null,
                      createdAt: new Date(2026, 7, 30, 12, index % 60),
                      returnGiftSentAt: index % 7 === 0 ? new Date(2026, 8, 5) : null,
                      returnGiftNote:
                        index % 7 === 0 ? `${LONG_NAME.slice(0, 40)}喜餅` : null,
                      version: 4,
                    }
                  : null,
            }),
          )}
        />
      </WorkspacePage>
    ),
  },
  {
    // 報到桌在婚宴當天會同時開著大量名單與統計；長姓名、長桌名與已／未
    // 報到混排時，320px 手機到桌機都不得水平溢出或縮掉觸控目標。
    name: "check-in",
    element: (
      <WorkspacePage
        sectionTitle="賓客報到"
        description="婚宴當天逐組記錄實際到場人數；報到不會改寫賓客的出席回覆，兩邊各自保留。"
        activeSection="check-in"
      >
        <GuestCheckInBoard
          workspaceId="workspace_rwd"
          canEdit
          guests={Array.from({ length: 24 }, (_, index) =>
            checkInGuestFixture(index),
          )}
          tables={Array.from({ length: 9 }, (_, index) =>
            checkInTableFixture(index),
          )}
        />
      </WorkspacePage>
    ),
  },
  {
    name: "check-in-viewer",
    element: (
      <WorkspacePage
        sectionTitle="賓客報到"
        description="婚宴當天逐組記錄實際到場人數；報到不會改寫賓客的出席回覆，兩邊各自保留。"
        activeSection="check-in"
        readOnlyNotice="你目前是唯讀成員，可以查看報到狀況，但不能報到或調整人數。"
      >
        <GuestCheckInBoard
          workspaceId="workspace_rwd"
          canEdit={false}
          guests={Array.from({ length: 6 }, (_, index) =>
            checkInGuestFixture(index),
          )}
          tables={Array.from({ length: 3 }, (_, index) =>
            checkInTableFixture(index),
          )}
        />
      </WorkspacePage>
    ),
  },
  {
    name: "check-in-empty",
    element: (
      <WorkspacePage
        sectionTitle="賓客報到"
        description="婚宴當天逐組記錄實際到場人數；報到不會改寫賓客的出席回覆，兩邊各自保留。"
        activeSection="check-in"
      >
        <GuestCheckInBoard
          workspaceId="workspace_rwd"
          canEdit
          guests={[]}
          tables={[]}
        />
      </WorkspacePage>
    ),
  },
  {
    name: "tables",
    element: (
      <WorkspacePage
        sectionTitle="桌次安排"
        description="依邀請人數安排入席，先處理未安排賓客，再檢視各桌容量。"
        activeSection="tables"
      >
        <SeatingPlan
          workspaceId="workspace_rwd"
          canEdit
          tables={Array.from({ length: 3 }, (_, index) => ({
            id: `table_${index}`,
            number: seatingTableNumber(index + 1),
            position: index + 1,
            version: 1,
            layoutX: index === 0 ? null : index === 1 ? 180 : 820,
            layoutY: index === 0 ? null : 720,
            name: index === 0 ? `${LONG_NAME.slice(0, 30)}長輩桌` : `宴客桌 ${index + 1}`,
            capacity: index === 0 ? 12 : 10,
            notes: index === 0 ? LONG_URL_ISH : null,
            guests: [
              {
                id: `seated_${index}_a`,
                version: 1,
                name: LONG_NAME.slice(0, 24),
                partySize: 6,
                side: "PARTNER_A" as const,
                notes: index === 0 ? "素食，需兒童椅\n靠近走道" : null,
                childSeatCount: index === 0 ? 2 : null,
                vegetarianCount: index === 0 ? 3 : null,
              },
              {
                id: `seated_${index}_b`,
                version: 1,
                name: "王小明",
                partySize: 3,
                // 混坐的桌子在圖上要標成「共同」，稽核要有這個樣本。
                side: index === 0 ? ("PARTNER_B" as const) : ("PARTNER_A" as const),
                notes: null,
                childSeatCount: null,
              },
              ...(index === 0
                ? [
                    {
                      id: `seated_${index}_c`,
                      version: 1,
                      name: "親友賓客甲",
                      partySize: 2,
                      side: "PARTNER_A" as const,
                      notes: "需要靠近走道",
                      childSeatCount: 1,
                    },
                    {
                      id: `seated_${index}_d`,
                      version: 1,
                      name: "親友賓客乙",
                      partySize: 1,
                      side: "PARTNER_B" as const,
                      notes: null,
                      childSeatCount: null,
                    },
                  ]
                : []),
            ],
          }))}
          unassignedGuests={Array.from({ length: 4 }, (_, index) => ({
            id: `unassigned_${index}`,
            name: index === 0 ? LONG_NAME : `待安排賓客 ${index}`,
            partySize: index + 1,
            version: 1,
            side: (["PARTNER_A", "PARTNER_B", "SHARED"] as const)[index % 3],
            attendanceStatus: "UNDECIDED" as const,
            notes: null,
            category: "GUEST" as const,
            seniority: "UNSPECIFIED" as const,
          }))}
        />
      </WorkspacePage>
    ),
  },
  {
    // SeatingPlan 的編輯明細需先在 client 選桌；另外保留這個正式表單樣本，
    // 讓 RWD 稽核可直接量到每張賓客小卡右下角的移出操作。
    name: "tables-guest-actions",
    element: (
      <WorkspacePage
        sectionTitle="桌次安排"
        description="檢查已安排賓客小卡的操作位置與窄版觸控範圍。"
        activeSection="tables"
      >
        <section
          aria-labelledby="assigned-guest-actions-heading"
          className="mt-6 min-w-0"
          style={{ width: "23rem", maxWidth: "100%" }}
        >
          <h2
            id="assigned-guest-actions-heading"
            className="font-serif text-title font-semibold text-ink"
          >
            已安排賓客
          </h2>
          <ul
            data-assigned-guest-grid
            className="mt-3 grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,10rem),1fr))] items-start gap-3"
          >
            {["莊明倫", "劉媛潔", "郭倩賢", "許文瑜"].map((name, index) => (
              <li
                key={name}
                data-assigned-guest-card
                className="flex min-w-0 flex-col rounded-control border border-line bg-surface-sunken/55 px-3.5 py-3"
              >
                <p className="text-caption font-semibold break-words text-ink">
                  {name}・{index === 3 ? 2 : 1} 位
                </p>
                <div className="mt-auto pt-1.5">
                  <UnassignGuestForm
                    workspaceId="workspace_rwd"
                    guestId={`assigned_guest_${index}`}
                    guestName={name}
                    guestVersion={0}
                    seatingTableId="table_1"
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      </WorkspacePage>
    ),
  },
  {
    name: "tasks",
    element: (
      <WorkspacePage
        sectionTitle="婚宴任務"
        description="把待辦拆成可執行的任務，並追蹤到期日。"
        activeSection="tasks"
      >
        <WeddingTaskList
          workspaceId="workspace_rwd"
          canEdit
          today="2026-08-13"
          tasks={Array.from({ length: 6 }, (_, index) => ({
            id: `task_${index}`,
            title: index === 0 ? `${LONG_NAME}的婚紗照拍攝與試穿行程確認` : `任務 ${index}`,
            description: index === 0 ? LONG_URL_ISH : null,
            dueDate: index % 2 === 0 ? "2026-09-01" : null,
            status: (["TODO", "IN_PROGRESS", "DONE"] as const)[index % 3],
            side: (["SHARED", "PARTNER_A", "PARTNER_B"] as const)[index % 3],
            completedAt: index % 3 === 2 ? "2026-08-01" : null,
            version: 1,
          }))}
        />
      </WorkspacePage>
    ),
  },
  {
    name: "handoffs",
    element: <WorkspacePage sectionTitle="總召交辦" description="集中記錄總召協助事項。" activeSection="staff">
      <HandoffBoard workspaceId="workspace_rwd" canEdit data={{
        role: "OWNER", workspace: { id: "workspace_rwd", name: "測試婚宴" },
        staff: [{ id: "staff", roleName: "總召", personName: LONG_NAME }],
        timeline: [{ id: "flow", title: LONG_NAME, startMinute: 720 }],
        items: [{ id: "handoff", title: LONG_NAME, details: LONG_URL_ISH, phase: "EVENT_DAY", status: "PENDING", dueAt: new Date("2026-09-20T04:00:00Z"), staffId: "staff", timelineItemId: "flow", version: 0 }],
      }} />
    </WorkspacePage>,
  },
  {
    name: "handoffs-editor",
    element: <WorkspacePage sectionTitle="總召交辦" description="集中記錄總召協助事項。" activeSection="staff">
      <HandoffBoard workspaceId="workspace_rwd" canEdit defaultCreateOpen data={{
        role: "OWNER", workspace: { id: "workspace_rwd", name: "測試婚宴" },
        staff: [{ id: "staff", roleName: "總召", personName: LONG_NAME }],
        timeline: [{ id: "flow", title: LONG_NAME, startMinute: 720 }],
        items: [{ id: "handoff", title: LONG_NAME, details: LONG_URL_ISH, phase: "EVENT_DAY", status: "PENDING", dueAt: new Date("2026-09-20T04:00:00Z"), staffId: "staff", timelineItemId: "flow", version: 0 }],
      }} />
    </WorkspacePage>,
  },
  {
    name: "staff",
    element: (
      <WorkspacePage
        sectionTitle="婚禮工作人員"
        description="記錄當天的職務分工與聯絡方式。"
        activeSection="staff"
      >
        <WeddingStaffList
          workspaceId="workspace_rwd"
          canEdit
          staff={Array.from({ length: 5 }, (_, index) => ({
            id: `staff_${index}`,
            roleName: index === 0 ? `${LONG_NAME.slice(0, 20)}總招待` : `職務 ${index}`,
            personName: index === 0 ? LONG_NAME.slice(0, 30) : `人員 ${index}`,
            contactPhone: index % 2 === 0 ? "0912-345-678" : null,
            notes: index === 0 ? LONG_URL_ISH : null,
            // 個人 1 份、廠商團隊多份含素食、部分不需要便當，三種都要量到。
            mealCount: index === 0 ? 12 : index % 3 === 1 ? 1 : null,
            vegetarianMealCount: index === 0 ? 4 : index % 3 === 1 ? 0 : null,
            redEnvelopeAmount: index % 2 === 0 ? 2_147_483_647 : 3600,
            redEnvelopeSentAt: index % 4 === 0 ? new Date(2026, 8, 1) : null,
            version: 1,
            timelineAssignmentFingerprint:
              `vowbook-staff-timeline-v1:${"0".repeat(64)}`,
          }))}
        />
      </WorkspacePage>
    ),
  },
  {
    name: "timeline",
    element: (
      <WorkspacePage
        sectionTitle="婚禮總流程"
        description="安排當天每個環節的時間、地點與負責人。"
        activeSection="timeline"
      >
        <WeddingTimelineList
          workspaceId="workspace_rwd"
          canEdit
          staff={[
            { id: "staff_0", roleName: "總招待", personName: LONG_NAME.slice(0, 20) },
          ]}
          items={Array.from({ length: 5 }, (_, index) => ({
            id: `timeline_${index}`,
            startTime: `1${index}:30`,
            endTime: `1${index}:55`,
            phase: index === 0 ? `${LONG_NAME.slice(0, 16)}迎賓` : `階段 ${index}`,
            title: index === 0 ? `${LONG_NAME.slice(0, 36)}進場` : `流程 ${index}`,
            location: index === 0 ? LONG_URL_ISH : null,
            details: index === 0 ? LONG_NAME : null,
            mediaCue: index === 0 ? LONG_URL_ISH : null,
            notes: index === 0 ? LONG_NAME.slice(0, 40) : null,
            version: 1,
            assignedStaff: [
              { id: "staff_0", roleName: "總招待", personName: LONG_NAME.slice(0, 20) },
            ],
          }))}
        />
      </WorkspacePage>
    ),
  },
  {
    name: "budget",
    element: (
      <WorkspacePage
        sectionTitle="婚禮花費"
        description="用階層帳本追蹤預算、實付與尾款。"
        activeSection="budget"
      >
        <BudgetList
          workspaceId="workspace_rwd"
          workspaceName="RWD 婚宴"
          canEdit
          items={budgetItems}
          summary={budgetSummary}
        />
      </WorkspacePage>
    ),
  },
  {
    name: "members",
    element: (
      <WorkspacePage
        sectionTitle="分享與協作"
        description="邀請伴侶、婚顧或檢視者，以各自的 Google 帳號安全共同籌備。"
        activeSection="members"
      >
        <WorkspaceMembersPanel
          workspaceId="workspace_rwd"
          operationKey="rwd-operation-key"
          role="OWNER"
          members={[
            {
              role: "OWNER",
              displayName: LONG_NAME.slice(0, 24),
              email: LONG_EMAIL,
              management: {
                membershipId: "membership_1",
                updatedAt: "2026-08-01T00:00:00.000Z",
              },
            },
            {
              role: "PLANNER",
              displayName: "婚顧小美",
              email: LONG_EMAIL,
              management: {
                membershipId: "membership_2",
                updatedAt: "2026-08-02T00:00:00.000Z",
              },
            },
          ]}
          pendingInvitations={[
            {
              id: "invitation_1",
              email: LONG_EMAIL,
              role: "PARTNER",
              version: 1,
              createdAt: "2026-08-01T00:00:00.000Z",
              expiresAt: "2026-08-20T00:00:00.000Z",
            },
          ]}
          renewableInvitations={[
            {
              id: "invitation_2",
              email: LONG_EMAIL,
              role: "VIEWER",
              version: 1,
              createdAt: "2026-07-01T00:00:00.000Z",
              expiresAt: "2026-07-20T00:00:00.000Z",
              reason: "EXPIRED",
            },
          ]}
        />
      </WorkspacePage>
    ),
  },
];

/** 唯讀成員與空清單走的是另一套 markup，兩者都要量。 */
const variantSurfaces: { name: string; element: ReactNode }[] = [
  {
    name: "guests-viewer",
    element: (
      <WorkspacePage
        sectionTitle="賓客名單"
        description="整理邀請名單、宴席需求與禮金簿。"
        activeSection="guests"
        readOnlyNotice="你目前是唯讀成員，可以查看名單與禮金簿，但不能新增或編輯。"
      >
        <WeddingGiftBook
          workspaceId="workspace_rwd"
          canEdit={false}
          guests={Array.from({ length: 4 }, (_, index) => guestFixture(index))}
        />
        <GuestList
          workspaceId="workspace_rwd"
          canEdit={false}
          guests={Array.from({ length: 4 }, (_, index) => guestFixture(index))}
        />
      </WorkspacePage>
    ),
  },
  {
    name: "guests-empty",
    element: (
      <WorkspacePage
        sectionTitle="賓客名單"
        description="整理邀請名單、宴席需求與禮金簿。"
        activeSection="guests"
      >
        <WeddingGiftBook
          workspaceId="workspace_rwd"
          canEdit
          defaultExpanded
          guests={[]}
        />
        <GuestList workspaceId="workspace_rwd" canEdit guests={[]} />
      </WorkspacePage>
    ),
  },
  {
    name: "tables-viewer",
    element: (
      <WorkspacePage
        sectionTitle="桌次安排"
        description="依邀請人數安排入席，先處理未安排賓客，再檢視各桌容量。"
        activeSection="tables"
        readOnlyNotice="你目前是唯讀成員，可以查看桌次與賓客安排，但不能調整座位。"
      >
        <SeatingPlan
          workspaceId="workspace_rwd"
          canEdit={false}
          tables={[
            {
              id: "table_0",
              number: 1,
              position: 1,
              version: 1,
              layoutX: null,
              layoutY: null,
              name: `${LONG_NAME.slice(0, 30)}長輩桌`,
              capacity: 10,
              notes: LONG_URL_ISH,
              guests: [
                {
                  id: "seated_a",
                  version: 1,
                  name: LONG_NAME.slice(0, 24),
                  partySize: 6,
                  side: "SHARED" as const,
                  notes: LONG_URL_ISH,
                  childSeatCount: 2,
                },
              ],
            },
            {
              id: "table_1",
              number: 2,
              position: 2,
              version: 2,
              layoutX: 820,
              layoutY: 760,
              name: "雙方同事與多年摯友桌",
              capacity: 12,
              notes: null,
              guests: [],
            },
          ]}
          unassignedGuests={[
            {
              id: "unassigned_0",
              name: LONG_NAME,
              partySize: 2,
              version: 1,
              side: "SHARED" as const,
              attendanceStatus: "UNDECIDED" as const,
              notes: null,
              category: "GUEST" as const,
              seniority: "UNSPECIFIED" as const,
            },
          ]}
        />
      </WorkspacePage>
    ),
  },
  {
    name: "tables-empty",
    element: (
      <WorkspacePage
        sectionTitle="桌次安排"
        description="依邀請人數安排入席，先處理未安排賓客，再檢視各桌容量。"
        activeSection="tables"
      >
        <SeatingPlan
          workspaceId="workspace_rwd"
          canEdit
          tables={[]}
          unassignedGuests={[]}
        />
      </WorkspacePage>
    ),
  },
  {
    // 真實宴會廳的規模：主桌 + 14 張圓桌，正好踩在 112px 標記層級的上限。
    name: "tables-floor-plan",
    element: (
      <WorkspacePage
        sectionTitle="桌次安排"
        description="依邀請人數安排入席，先處理未安排賓客，再檢視各桌容量。"
        activeSection="tables"
      >
        <SeatingPlan
          workspaceId="workspace_rwd"
          canEdit
          tables={Array.from({ length: 15 }, (_, index) => ({
            id: `plan_table_${index}`,
            number: seatingTableNumber(index + 1),
            position: index + 1,
            version: 1,
            layoutX: null,
            layoutY: null,
            // 刻意讓好幾桌同名：桌名開放重複之後，這是最常見的真實情況，
            // 稽核要看得到「靠桌號才分得出是哪一桌」的樣子。
            name:
              index === 0
                ? "主桌"
                : index % 2 === 0
                  ? "男方同事"
                  : "女方同學",
            capacity: 10,
            notes: null,
            // 桌名對不上入座賓客是常態：第 6 桌叫「男方同事」卻坐了女方同學，
            // 側別標記要照實際入座的人算，稽核也要看得到「共同」那一種。
            guests:
              index % 3 === 0
                ? [
                    {
                      id: `plan_seated_${index}`,
                      version: 1,
                      name: "王小明",
                      partySize: 5,
                      side: (["PARTNER_A", "PARTNER_B", "SHARED"] as const)[
                        (index / 3) % 3
                      ],
                      notes: null,
                      childSeatCount: index === 0 ? 2 : null,
                vegetarianCount: index === 0 ? 3 : null,
                    },
                    {
                      id: `plan_seated_${index}_b`,
                      version: 1,
                      name: "林小美",
                      partySize: 3,
                      side: (["PARTNER_A", "PARTNER_B", "PARTNER_A"] as const)[
                        (index / 3) % 3
                      ],
                      notes: null,
                      childSeatCount: null,
                    },
                  ]
                : [],
          }))}
          unassignedGuests={[]}
        />
      </WorkspacePage>
    ),
  },
  {
    // 給會館的 9:16 直式桌圖：字級全用 cqw，窄螢幕也要縮得進去不溢出。
    name: "tables-chart",
    element: (
      <WorkspacePage
        sectionTitle="婚宴桌圖"
        description="9:16 直式桌圖，和場地圖用同一份配置；列印或另存 PDF 後即可交給婚宴會館輸出。"
        activeSection="tables"
      >
        <SeatingChart
          workspaceId="workspace_rwd"
          workspaceName={`${LONG_NAME.slice(0, 12)}的世紀婚宴`}
          weddingDateLabel="2026年11月8日"
          tables={Array.from({ length: 15 }, (_, index) => ({
            id: `chart_table_${index}`,
            number: seatingTableNumber(index + 1),
            position: index + 1,
            name:
              index === 0
                ? "主桌"
                : index % 2 === 0
                  ? "男方同事"
                  : "女方同學",
            layoutX: null,
            layoutY: null,
            guests:
              index % 3 === 0
                ? [
                    {
                      side: (["PARTNER_A", "PARTNER_B", "SHARED"] as const)[
                        (index / 3) % 3
                      ],
                      notes: null,
                      childSeatCount: index === 0 ? 2 : null,
                vegetarianCount: index === 0 ? 3 : null,
                    },
                  ]
                : [],
          }))}
        />
      </WorkspacePage>
    ),
  },
  {
    name: "tasks-empty",
    element: (
      <WorkspacePage
        sectionTitle="婚宴任務"
        description="把待辦拆成可執行的任務，並追蹤到期日。"
        activeSection="tasks"
      >
        <WeddingTaskList
          workspaceId="workspace_rwd"
          canEdit
          today="2026-08-13"
          tasks={[]}
        />
      </WorkspacePage>
    ),
  },
  {
    name: "staff-viewer",
    element: (
      <WorkspacePage
        sectionTitle="婚禮工作人員"
        description="記錄當天的職務分工與聯絡方式。"
        activeSection="staff"
        readOnlyNotice="你目前是唯讀成員，可以查看工作人員，但不能新增或編輯。"
      >
        <WeddingStaffList
          workspaceId="workspace_rwd"
          canEdit={false}
          staff={[
            {
              id: "staff_0",
              roleName: `${LONG_NAME.slice(0, 20)}總招待`,
              personName: LONG_NAME.slice(0, 30),
              contactPhone: "0912-345-678",
              notes: LONG_URL_ISH,
              mealCount: 12,
              vegetarianMealCount: 4,
              redEnvelopeAmount: 6000,
              redEnvelopeSentAt: null,
              version: 1,
              timelineAssignmentFingerprint:
                `vowbook-staff-timeline-v1:${"0".repeat(64)}`,
            },
          ]}
        />
      </WorkspacePage>
    ),
  },
  {
    name: "staff-empty",
    element: (
      <WorkspacePage
        sectionTitle="婚禮工作人員"
        description="記錄當天的職務分工與聯絡方式。"
        activeSection="staff"
      >
        <WeddingStaffList workspaceId="workspace_rwd" canEdit staff={[]} />
      </WorkspacePage>
    ),
  },
  {
    name: "timeline-empty",
    element: (
      <WorkspacePage
        sectionTitle="婚禮總流程"
        description="安排當天每個環節的時間、地點與負責人。"
        activeSection="timeline"
      >
        <WeddingTimelineList
          workspaceId="workspace_rwd"
          canEdit
          staff={[]}
          items={[]}
        />
      </WorkspacePage>
    ),
  },
  {
    name: "budget-viewer",
    element: (
      <WorkspacePage
        sectionTitle="婚禮花費"
        description="用階層帳本追蹤預算、實付與尾款。"
        activeSection="budget"
        readOnlyNotice="你目前是唯讀成員，可以查看花費，但不能新增或編輯。"
      >
        <BudgetList
          workspaceId="workspace_rwd"
          workspaceName="RWD 婚宴"
          canEdit={false}
          items={budgetItems}
          summary={budgetSummary}
        />
      </WorkspacePage>
    ),
  },
  {
    name: "budget-empty",
    element: (
      <WorkspacePage
        sectionTitle="婚禮花費"
        description="用階層帳本追蹤預算、實付與尾款。"
        activeSection="budget"
      >
        <BudgetList
          workspaceId="workspace_rwd"
          workspaceName="RWD 婚宴"
          canEdit
          items={[]}
          summary={{
            itemCount: 0,
            paidCount: 0,
            plannedTotal: "0",
            actualTotal: "0",
            balanceDueTotal: "0",
            balanceDueCount: 0,
            overdueBalanceDueCount: 0,
            balanceDueMissingAmountCount: 0,
            nearestUpcomingBalanceDueDate: null,
            selfProvidedCount: 0,
            notPlannedCount: 0,
          }}
        />
      </WorkspacePage>
    ),
  },
  {
    name: "members-viewer",
    element: (
      <WorkspacePage
        sectionTitle="協作者"
        description="查看目前一起籌備這場婚宴的協作者。"
        activeSection="members"
        readOnlyNotice="你目前只能查看成員的顯示名稱與角色。"
      >
        <WorkspaceMembersPanel
          workspaceId="workspace_rwd"
          operationKey="rwd-operation-key"
          role="VIEWER"
          members={[
            { role: "OWNER", displayName: LONG_NAME.slice(0, 24) },
            { role: "PLANNER", displayName: "婚顧小美" },
          ]}
        />
      </WorkspacePage>
    ),
  },
  {
    name: "onboarding",
    element: (
      <AppShell>
        {/* 外框依 src/app/(app)/onboarding/page.tsx 複寫，表單本體是正式元件。 */}
        <main className="mx-auto w-full max-w-3xl px-5 py-14 sm:px-8 sm:py-20">
          <div className="grid gap-10 md:grid-cols-[0.8fr_1.2fr] md:gap-16">
            <div>
              <p className="text-sm font-semibold tracking-[0.16em] text-clay">
                第一步
              </p>
              <h1 className="mt-3 font-serif text-3xl font-semibold text-ink">
                建立你們的婚宴工作區
              </h1>
            </div>
            <CreateWorkspaceForm />
          </div>
        </main>
      </AppShell>
    ),
  },
];

export async function renderSurfaces(): Promise<
  { name: string; body: string }[]
> {
  const publicPages: { name: string; element: ReactNode }[] = [
    { name: "home", element: <HomePage /> },
    {
      name: "signin",
      element: await SignInPage({
        searchParams: Promise.resolve({ error: "OAuthCallback" }),
      }),
    },
  ];

  return [...publicPages, ...surfaces, ...variantSurfaces].map((surface) => ({
    name: surface.name,
    body: renderToStaticMarkup(surface.element),
  }));
}
