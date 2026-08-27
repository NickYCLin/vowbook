# 貢獻 VowBook

感謝你願意協助改善 VowBook。

## 開發流程

1. Fork repository 並從最新 main 建立分支。
2. 先補上或調整測試，再實作行為。
3. 不要提交 .env、資料庫匯出、真實婚宴資料、營運紀錄或憑證。
4. 送出 Pull Request 前執行：

       npm run lint
       npm run typecheck
       npm test
       npm run db:validate
       npm run build

所有婚宴領域資料都必須歸屬 WeddingWorkspace。新增或修改任何 workspace 資料的 server-side route、action 或 service 時，必須從可信 session 取得目前使用者並驗證 Membership，不得相信 client 傳入的使用者 ID、角色或 workspace 所有權。

使用者可見文字預設使用繁體中文。Commit message 建議使用繁體中文 Conventional Commits，例如：fix(guests): 修正賓客篩選條件。

## 貢獻授權

送出貢獻即表示你確認有權提供該內容，並同意依 [Mozilla Public License 2.0](LICENSE) 授權該貢獻。第三方程式碼或素材必須清楚標註來源與相容授權。

## 問題與功能建議

一般錯誤與功能建議可以建立 GitHub Issue。安全問題請依 SECURITY.md 私下回報。
