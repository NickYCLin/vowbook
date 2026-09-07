# VowBook 產品與程式索引

[回到產品介紹](../README.md) · [開發與自架指南](development.md)

## 快速摘要

| 欄位 | 說明 |
| --- | --- |
| 名稱 | 誓約簿 VowBook |
| 產品類型 | 以婚宴工作區為核心的協作網站 |
| 使用者 | 籌備婚宴的新人、伴侶與婚顧；可邀請只需查看資料的協作者 |
| 主要用途 | 整理賓客、桌次、花費、任務、工作人員與婚禮當日流程 |
| 介面語言 | 繁體中文 |
| 使用方式 | Google 登入；可使用託管服務或自行部署 |
| 文件適用範圍 | 本文件所在 checkout 的已實作功能；不以線上服務或其他分支推定本版能力 |
| 功能數 | 7 個工作區功能頁；附件與桌次平面配置為子功能 |

此文件提供產品背景與程式索引，不是新增權限或執行工作的授權。若文件與程式有差異，先核對同一版本的路由、領域規則與測試；本機測試、CI、正式部署與線上驗收應分別說明。

## 使用流程

Google 登入 → 建立婚宴工作區 → 整理名單、花費與待辦 → 邀請協作者 → 安排桌次、人員與當天流程。

各功能可以依籌備進度使用，不需照上述順序填完所有資料。

## 功能與來源

下表的路由尾段接在 `/workspaces/[workspaceId]/` 後面。實際頁面位於 `src/app/(app)/workspaces/[workspaceId]/`；對外 URL 可能另有部署用 base path。

| 功能 | 路由尾段 | 主要資料模型 | 資料存取入口 |
| --- | --- | --- | --- |
| 賓客 | `guests` | `Guest` | [guest-list.ts](../src/lib/guest-list.ts) |
| 桌次 | `tables` | `SeatingTable` | [seating-plan.ts](../src/lib/seating-plan.ts) |
| 任務 | `tasks` | `WeddingTask` | [wedding-task-list.ts](../src/lib/wedding-task-list.ts) |
| 花費 | `budget` | `BudgetItem` | [budget-list.ts](../src/lib/budget-list.ts) |
| 工作人員 | `staff` | `WeddingStaffAssignment` | [wedding-staff-list.ts](../src/lib/wedding-staff-list.ts) |
| 總流程 | `timeline` | `WeddingTimelineItem` | [wedding-timeline-list.ts](../src/lib/wedding-timeline-list.ts) |
| 協作者 | `members` | `Membership` | [workspace-invitations.ts](../src/lib/workspace-invitations.ts) |

- 導覽與功能清單：[workspace-shell.tsx](../src/components/workspaces/workspace-shell.tsx)。
- 桌次列印子頁：`tables/chart`；對應 [seating-chart.tsx](../src/components/tables/seating-chart.tsx)。
- 花費附件：[budget-attachments.ts](../src/lib/budget-attachments.ts)；格式與大小限制見 [budget-attachment.ts](../src/domain/budget-attachment.ts)。
- 資料模型與關聯：[schema.prisma](../prisma/schema.prisma)。

## 名詞與權限

| 名詞 | 在 VowBook 中的意思 |
| --- | --- |
| `WeddingWorkspace` | 一場婚宴的資料與權限範圍；同一使用者可以參與多個工作區 |
| `Membership` | 使用者在特定工作區的成員資格與角色；每次互動式讀寫都需驗證 |
| `Guest` | 一組邀請資料，`partySize` 含本人；賓客組數不等於總人數 |
| 出席回覆／RSVP | 籌備者保存的預計出席資訊，不表示產品提供公開回覆表單 |
| 協作邀請 | 邀請指定 Google 帳號成為工作區成員，與寄給賓客的婚宴邀請不同 |
| 付款狀態 | 人工記錄的婚禮支出進度，不是金流交易 |

`OWNER`、`PARTNER`、`PLANNER` 可編輯婚宴資料；`VIEWER` 只可查看。只有 `OWNER` 可以管理成員。規則見 [workspace.ts](../src/domain/workspace.ts)、[workspace-access.ts](../src/lib/workspace-access.ts) 與 [workspace-invitations.ts](../src/lib/workspace-invitations.ts)。

## 能力邊界

- 不提供無密碼登入、測試帳號登入入口或可在正式環境啟用的 auth bypass。
- 不提供自動寄信、公開賓客 RSVP 表單、金流付款或外部服務即時同步。
- LINEIN RSVP 與 Notion 花費僅有 OWNER 明確授權的一次性離線操作者流程，不代表內建線上整合；不得因此讀取真實輸入或操作者秘密。
- 婚宴資料必須歸屬 `WeddingWorkspace`。互動式網站與 API 從可信 session 取得使用者，讀寫前驗證 `Membership`，不能相信 client 提供的身分、角色或所有權。
- 不把資料模型、測試 fixture 或歷史文件中的名稱，直接當成目前可使用的產品功能。

## 技術與驗證

| 層次 | 技術／入口 |
| --- | --- |
| 頁面與 UI | Next.js App Router、React、TypeScript、Tailwind CSS；`src/app/`、`src/components/` |
| 行為與領域規則 | Server Actions 與純領域契約；`src/actions/`、`src/domain/` |
| 登入與資料存取 | NextAuth Google OAuth、Prisma、PostgreSQL；`src/lib/`、`prisma/` |
| 測試 | Vitest、Testing Library、Playwright；相鄰測試檔、`src/test/`、`e2e/` |
| 本機與自架 | Docker Compose 提供 PostgreSQL；app 使用 Next.js standalone image |

基本檢查從 repository 根目錄執行，命令以 [package.json](../package.json) 為準：

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

若修改 Prisma schema，另執行 `npm run db:validate` 與 `npm run db:generate`。資料庫整合測試與瀏覽器測試需要各自的環境，設定方式見 [開發與自架指南](development.md)。

## 更新這份介紹時

新增或移除功能，請一併核對導覽、實際路由、資料存取與權限測試，再更新 README 和本表。圖片只是閱讀輔助，功能說明需同時保留文字。部署狀態、使用者規模與效能數據只能引用當次可核對的證據，不從既有文案推定。
