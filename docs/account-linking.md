# 連結登入方式

登入 App 後，在「設定 → 登入方式」可連結尚未使用的 Google 或 Apple 登入。驗證後會顯示待連結方式與供應商提供的 Email，必須再按「確認連結到目前帳號」才會生效。Apple 未提供 Email 時仍可依已驗證的識別碼連結。

連結只將新的登入識別碼加到原本的使用者，不搬移婚宴、成員或附件，不依 Email 相同自動合併。若另一登入已屬於既有帳號，會回覆衝突，不會覆蓋或合併資料。此版本不提供解除連結，也不會移除原有登入方式。

## 服務端流程

- `GET /api/mobile/v1/account/links`：使用 Bearer 憑證讀取目前帳號的連結狀態，不回傳供應商識別碼。
- `POST` 同一路徑，輸入 `provider: GOOGLE | APPLE`：建立五分鐘內有效的一次性 nonce；僅儲存雜湊，綁定目前使用者與發起裝置的登入憑證，新要求會取消該使用者舊的待確認要求。
- Google：App 使用獨立瀏覽器登入視窗開啟 `/mobile/link/google`，使用者按下按鈕後才設定短期 HttpOnly cookie 並開始既有 Google OAuth（沿用既有 callback URI、state 與 PKCE）。連結模式的 OAuth callback 只暫存已驗證的識別，不執行一般登入的帳號建立或婚宴邀請處理，也不替換目前 App 憑證。
- Apple：系統授權請求使用伺服器 nonce 的 SHA-256；`PATCH` 傳入 nonce 與 identityToken，驗證簽章、issuer、audience、有效時間與 nonce 後才暫存識別。
- `PATCH` 同一路徑可讀取驗證後的確認資訊；`PUT` 傳入 nonce 才正式連結。兩者都要求原裝置的有效 Bearer 憑證，不能由 client 指定 userId、subject、Email 或角色。
- 確認在 Serializable transaction 中重新檢查帳號、憑證、期限與刪帳狀態，並以使用者版本及唯一索引防止並行覆蓋。成功後消耗所有待連結要求，重播會失敗；裝置登出或刪帳會級聯移除要求。
- 連結 Apple 後仍沿用 Apple 重新確認及撤銷授權的刪帳流程，不能透過 Google 刪帳入口跳過。

## 啟用及驗證界線

服務端必須先套用 `20261030140000_account_link_challenges` migration，再提供連結功能；它只新增暫存驗證表，不回填或合併既有帳號。不要將 migration 或測試直接套用到正式資料庫。此文件不代表已部署。

自動測試涵蓋認證邊界、nonce 綁定、取消前不寫入登入方式、衝突與並行確認，以及隔離 PostgreSQL 中的原使用者／婚宴歸屬。合成驗證不能代替 Google／Apple 真實授權、系統登入視窗與回跳的裝置驗收；未完成真實驗收前，不宣稱已可對外發布。
