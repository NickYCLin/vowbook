export const informationStatus = "待維運確認：以下依目前程式功能整理，不是已核定的正式隱私政策，也不代表已完成商店合規審查。";

export const privacySections = [
  {
    title: "登入與帳號",
    text: "網站使用 Google 登入；原生 App 另提供 Apple 登入。程式會處理登入服務的帳號識別碼、Email，以及服務提供的姓名與頭像資訊，用於辨識帳號與婚宴邀請。Google 與 Apple 帳號不依 Email 自動合併。原生登入憑證存於此裝置的 Keychain；伺服器保存憑證雜湊與到期時間，原生 session 目前有效期為 12 小時。",
  },
  {
    title: "婚宴與協作資料",
    text: "你輸入的婚宴設定、賓客及聯絡資料、出席與桌次、報到、禮金、喜餅、花費與付款、收據和文件、任務及流程等資料，用於婚宴規劃與協作。程式將婚宴資料歸屬工作區，婚宴頁面與 API 依成員角色檢查存取權限。協作者依角色可讀取或修改工作區資料；系統另有帳號管理功能，不應將協作資料視為只有自己可見。",
  },
  {
    title: "照片、檔案與外部登入服務",
    text: "收據可從相簿或檔案選取；原生相機入口在你點選後才請求相機授權。照片先轉為 JPEG 並顯示確認，確認上傳後才傳到目前花費；相機草稿不另存相簿。附件內容、檔名、格式、大小、雜湊及上傳者關聯保存在伺服器資料庫。Google 與 Apple 會參與各自的登入驗證；Apple 刪帳流程另需向 Apple 交換及撤銷授權。其他實際外部服務、記錄與資料流仍需維運者核對。",
  },
  {
    title: "保存、退出與刪除",
    text: "你可在 App 設定檢視刪帳預覽。只有自己使用的婚宴會隨刪帳移除；仍有其他成員使用的婚宴可能保留並交接，部分協作情況會先阻擋刪帳，避免刪除他人資料。Apple 帳號需先完成重新確認與授權撤銷；失敗時保留本地帳號供續辦。程式沒有替維運者制定一般資料保存期限、備份保存期限或備份刪除時程，這些尚待確認，不能把資料庫刪除視為所有備份已清除。",
  },
  {
    title: "尚待確認的政策",
    text: "維運者身分、正式對外聯絡管道、部署地點、備份與日誌處理、實際外部資料流、分析或追蹤設定，以及 App Store 資料揭露仍待核實。本頁不作未經確認的不分享、不追蹤或固定保存期限承諾；正式使用及上架前需由維運者完成核對與定稿。",
  },
];

export const supportStatus = "本頁說明常見操作的處理方式與回報問題的管道；資料處理方式請見「資料使用說明」。";

export type InformationSection = { title: string; text: string; link?: { href: string; label: string } };

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
