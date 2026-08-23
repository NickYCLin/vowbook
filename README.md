# 誓約簿 VowBook

VowBook 是一套以工作區為核心的婚宴規劃網站。使用者透過 Google 登入後，可以建立婚宴工作區，邀請伴侶或婚顧協作，並共同管理賓客、桌次、任務、花費、工作人員與婚禮流程。

> **線上正式版：** [立即使用 VowBook](https://ycspace.myvnc.com/VowBook)

## 線上使用

VowBook 目前已有持續運作中的公開託管版本，歡迎正在籌備婚禮的新人、伴侶與婚顧直接使用，不需要自行安裝或架設伺服器。

1. 開啟 [VowBook 線上正式版](https://ycspace.myvnc.com/VowBook)。
2. 使用 Google 帳號登入。
3. 建立自己的婚宴工作區，開始整理賓客、桌次、任務、花費與婚禮流程。
4. 視需要邀請伴侶或婚顧加入同一個工作區協作。

每個婚宴工作區的資料彼此隔離，只有該工作區的成員可以存取。線上服務仍會持續更新；若遇到不涉及個資或安全漏洞的一般問題，歡迎透過 GitHub Issues 回報。

## 功能

- Google OAuth 登入與 JWT session
- 多婚宴工作區及 OWNER、PARTNER、PLANNER、VIEWER 成員權限
- 賓客名單、出席狀態、邀請人數與來源資訊
- 桌次容量、賓客安排與場地平面配置
- 婚宴任務、工作人員與婚禮流程
- 階層式婚禮花費、狀態追蹤與附件
- 工作區邀請及成員管理
- LINEIN RSVP 與 Notion 花費的一次性離線匯入工具

所有婚宴資料都直接歸屬 WeddingWorkspace。伺服器端每次讀寫都會從登入 session 取得目前使用者，再檢查該使用者的 Membership；不信任 client 傳入的使用者 ID、角色或 workspace 所有權。

## 技術架構

- Next.js 16 App Router、React 19、TypeScript、Tailwind CSS
- NextAuth 4 與 Google OAuth
- PostgreSQL 17、Prisma 6
- Vitest、Testing Library、Playwright
- Docker Compose 與 non-root standalone container image

## 本機開發

需求：Node.js 20.9 以上、npm，以及 Docker Compose。

1. 安裝套件並建立本機環境設定：

       npm install
       cp .env.example .env

2. 將 .env 中所有 replace-with-* 假值換成本機值。AUTH_SECRET 應為各環境獨立的高熵隨機值，例如：

       openssl rand -base64 32

3. 在 Google Cloud Console 建立 OAuth 2.0 Web application，加入本機 redirect URI：

       http://localhost:3000/api/auth/callback/google

4. 啟動 PostgreSQL、套用 migration 並產生 Prisma Client：

       docker compose up -d postgres
       npx prisma migrate dev
       npm run db:generate

5. 啟動開發伺服器：

       npm run dev

開啟 http://localhost:3000。首次登入後會進入工作區建立流程。

## Docker Compose 自架

完成 .env 設定後執行：

    docker compose up -d --build app

預設只在 127.0.0.1:3000 提供服務，適合放在自行管理的 HTTPS reverse proxy 後方。若部署在子路徑，請讓下列設定使用一致的 path：

    VOWBOOK_BASE_PATH="/VowBook"
    VOWBOOK_NEXTAUTH_URL="https://example.com/VowBook/api/auth"

對應的 Google OAuth redirect URI 為：

    https://example.com/VowBook/api/auth/callback/google

Compose 會等待 PostgreSQL healthy、完成一次性 prisma migrate deploy，再啟動 non-root app container。正式環境請自行配置 TLS、備份、監控及 secrets 管理，不要提交 .env 或任何資料庫匯出檔。

## 環境變數

| 變數 | 用途 |
| --- | --- |
| DATABASE_URL | host 本機 Prisma PostgreSQL 連線字串 |
| POSTGRES_DB | Docker PostgreSQL 資料庫名稱 |
| POSTGRES_USER | Docker PostgreSQL 使用者 |
| POSTGRES_PASSWORD | Docker PostgreSQL 密碼 |
| POSTGRES_PORT | PostgreSQL 綁定於 127.0.0.1 的連接埠 |
| VOWBOOK_PORT | App 綁定於 127.0.0.1 的連接埠 |
| GOOGLE_CLIENT_ID | Google OAuth Client ID |
| GOOGLE_CLIENT_SECRET | Google OAuth Client Secret |
| AUTH_SECRET | NextAuth JWT／cookie 簽章秘密 |
| NEXT_PUBLIC_BASE_PATH | host 本機 build/runtime base path |
| NEXTAUTH_URL | host 本機 NextAuth canonical API URL |
| VOWBOOK_BASE_PATH | Compose build/runtime base path |
| VOWBOOK_NEXTAUTH_URL | Compose 對外 NextAuth canonical API URL |
| VOWBOOK_DATABASE_URL | Compose 容器內 PostgreSQL URL |
| TEST_DATABASE_URL | 僅供隔離 PostgreSQL integration tests 使用的 localhost 測試資料庫 |

## 驗證

    npm run lint
    npm run typecheck
    npm test
    npm run db:validate
    npm run db:generate
    npm run build

需要 disposable localhost PostgreSQL 的完整整合測試：

    TEST_DATABASE_URL="postgresql://vowbook_test:vowbook_test@127.0.0.1:5432/vowbook_test" npm run test:db

瀏覽器與 RWD 驗證：

    npm run e2e:install
    npm run test:e2e
    npm run rwd:audit

## 專案結構

    prisma/          Prisma schema 與 migrations
    src/actions/     Server Actions
    src/app/         App Router 頁面與 API routes
    src/components/  UI 與領域元件
    src/domain/      不依賴資料庫的輸入與領域契約
    src/lib/         授權、資料存取與安全輔助工具
    src/test/        共用測試與 schema 契約測試
    e2e/             Playwright 驗收測試
    scripts/         Prisma、PostgreSQL、RWD 與離線匯入工具

## 安全性

請不要在公開 Issue 張貼未修補漏洞、憑證、個資或正式資料。回報方式請參閱 SECURITY.md。

## 授權

目前尚未指定開源授權。公開程式碼僅供檢視；除非另有書面授權，否則保留所有權利。
