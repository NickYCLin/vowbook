export type InformationSection = { title: string; text: string; link?: { href: string; label: string } };

export const informationStatus = "本隱私政策說明誓約簿（VowBook）網站與 iOS App 如何收集、使用、保存與刪除資料。營運主體：個人「林洋琛」。生效日期：2026 年 10 月 30 日。";

export const privacyContactLink = { href: "https://github.com/NickYCLin/vowbook/issues", label: "前往 GitHub Issues 聯絡" };

export const privacySections: InformationSection[] = [
  {
    title: "營運主體與服務環境",
    text: "誓約簿由個人「林洋琛」營運，不是公司或團體。服務部署於位於台灣的自架主機，以 Docker 與 Caddy 運行，帳號與婚宴資料保存在該主機上。",
  },
  {
    title: "收集的資料",
    text: "我們處理以下資料：姓名、Email、使用者 ID（含 Google 或 Apple 提供的帳號識別碼）；你輸入的賓客與工作人員聯絡資料，例如電話與地址；花費、付款與禮金記錄；收據照片與 PDF；備註、任務與流程文件，以及婚宴設定、出席、桌次與報到等規劃資料。",
  },
  {
    title: "登入與帳號",
    text: "網站使用 Google 登入；原生 App 另提供 Apple 登入。登入服務提供的帳號識別碼、Email、姓名與頭像資訊用於辨識帳號與處理婚宴邀請。Google 與 Apple 帳號不依 Email 自動合併。原生登入憑證存於裝置的 Keychain；伺服器只保存憑證雜湊與到期時間，原生 session 有效期為 12 小時。",
  },
  {
    title: "使用目的與協作存取",
    text: "資料只用於提供婚宴規劃與協作功能。婚宴資料歸屬工作區，頁面與 API 依成員角色檢查存取權限；你邀請的協作者可依角色讀取或修改該工作區的資料，因此共享婚宴中的資料不是只有你自己可見。",
  },
  {
    title: "照片與檔案",
    text: "收據可從相簿或檔案選取；原生相機只在你點選後才請求相機授權。照片先轉為 JPEG 並顯示確認，確認後才上傳到對應花費；相機草稿不另存相簿。附件內容、檔名、格式、大小、雜湊及上傳者關聯保存在伺服器資料庫。",
  },
  {
    title: "外部服務、分析與追蹤",
    text: "本服務使用的外部服務只有 Google OAuth 與 Sign in with Apple，分別用於各自的登入驗證；以 Apple 登入的帳號刪除時，系統會向 Apple 撤銷授權 token。本服務不使用分析、廣告或追蹤工具。",
  },
  {
    title: "保存與備份",
    text: "資料會保存到你或協作者刪除，或帳號依下方規則刪除為止。部署前會手動建立資料庫備份，只保留最新 2 份，較舊的備份會被取代；因此已刪除的資料可能仍存在於刪除前建立的備份中，直到該備份被較新的備份取代。",
  },
  {
    title: "刪除帳號",
    text: "你可以在 iOS App 的設定中使用「刪除帳號」，先檢視刪帳預覽，再輸入登入用的 Email 確認。只有你一人的婚宴會整場刪除，包含名單、桌次、花費與附件；仍有其他擁有者的婚宴只會移除你的成員身分，你建立的婚宴與上傳的收據改由該擁有者承接；沒有其他擁有者但有伴侶的婚宴，由伴侶升為擁有者接手；只剩婚顧或檢視者的婚宴會阻擋刪帳，需先移除協作者或刪除該婚宴。你發出的邀請會被刪除，你的成員身分、App 登入憑證與頭像會隨帳號一併刪除。以 Apple 登入的帳號需先重新確認 Apple 帳號並完成授權撤銷；撤銷未完成時帳號資料會保留，可稍後續辦。",
  },
  {
    title: "聯絡方式",
    text: "對外聯絡管道只有 VowBook 的 GitHub Issues。Issue 內容會公開，請勿貼上密碼、驗證碼、登入 token，或賓客的姓名、電話、地址等個人資料。涉及個人資料的刪除請求，請優先使用 App 內的「刪除帳號」功能；若需透過 Issue 詢問，請只描述問題，不要附上任何個人資料。",
    link: privacyContactLink,
  },
  {
    title: "政策更新",
    text: "本政策內容調整時，會更新本頁內容與生效日期。",
  },
];

export const supportStatus = "本頁說明常見操作的處理方式與回報問題的管道；資料處理方式請見「隱私政策」。";

export const supportSections: InformationSection[] = [
  {
    title: "登入與工作區",
    text: "登入失敗時先確認網路，再重新開啟登入流程；取消登入不需繼續操作。原生登入過期請重新登入。Google 與 Apple 是獨立帳號，請使用原本的登入方式；工作區不見時先確認登入帳號與邀請狀態，不要重新建立同名婚宴取代原資料。",
  },
  {
    title: "收據與相機",
    text: "拍照後或選取檔案後，先核對收據再確認上傳。相機不可用、被拒絕或受裝置限制時，可改從相簿或檔案選取。單份附件上限 10 MiB，支援 JPEG、PNG、WebP 與 PDF。上傳失敗可重試同一份草稿或放棄；離開畫面後草稿不保留。不要反覆新增付款來解決收據上傳問題。",
  },
  {
    title: "協作與帳號刪除",
    text: "無法編輯時請確認角色與成員資格；資料衝突時先重新載入。刪帳請從 App 設定進入並閱讀預覽；共享婚宴需要先處理交接或協作者，不能跳過保護。Apple 撤銷尚未完成時請保留帳號並稍後續辦，不要把錯誤訊息當成已刪帳成功。",
  },
  {
    title: "回報問題與測試回饋",
    text: "遇到問題或有建議時，請到 VowBook 的 GitHub Issues 建立新的 Issue。回報時請提供：App 版本、iOS 版本、裝置型號、重現步驟，以及畫面上的錯誤訊息。Issue 內容會公開，請勿貼上密碼、驗證碼、登入 token，或婚宴賓客的姓名、電話、地址等個人資料；附截圖前請先遮蔽。若你使用 TestFlight 測試版，也可以在 TestFlight 使用「傳送 Beta 版回饋」作為補充管道。",
    link: { href: "https://github.com/NickYCLin/vowbook/issues", label: "前往 GitHub Issues 回報問題" },
  },
];

export const informationEvidence = [
  { path: "prisma/schema.prisma", markers: ["googleSubject", "appleSubject", "model Guest", "model BudgetAttachment", "uploadedByUserId", "sha256"] },
  { path: "src/auth.ts", markers: ["GoogleProvider"] },
  { path: "src/lib/mobile/session.ts", markers: ["12 * 60 * 60 * 1000", "tokenHash"] },
  { path: "src/lib/mobile/apple-sign-in.ts", markers: ["appleSubject: identity.subject", "verifyAppleIdentity"] },
  { path: "src/lib/account-deletion.ts", markers: ["plan.blocked", "plan.heirs", "plan.deleted"] },
  { path: "src/lib/mobile/apple-account-deletion.ts", markers: ["appleRequest(\"token\"", "appleRequest(\"revoke\"", "sealAppleDeletionToken"] },
];
