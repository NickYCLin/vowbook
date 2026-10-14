# 相容依賴修補

2026-10-14 針對現有 lock 做 patch 升級，沒有使用 `npm audit fix --force` 或覆蓋其他版本。兩個來源庫維持自己的其他依賴，不以整份 lock 互換。

| 套件 | 修補版本 | 原因與範圍 |
| --- | --- | --- |
| sharp | 0.35.5 | GHSA-wq5f-xc86-pv6w；影像處理依賴 librsvg，隨 @img/sharp-libvips 1.3.4 更新至 rsvg 2.63.2。直接依賴與 Next 傳遞依賴使用同一 patch。 |
| source-map-js | 1.2.2 | GHSA-68fv-2mgg-jv7q；限制 indexed source-map section offsets，避免不合理映射占用 event loop。PostCSS/Tailwind 的 build chain 與 jsdom 共用。 |
| undici | 7.29.1 | jsdom 開發鏈的現有 7.x patch，修補 TLS、cache/retry/WebSocket 等公告；不是升級 Node 內建 fetch，也不代表每項受影響 API 都被產品呼叫。 |
| brace-expansion | 5.0.12 | GHSA-q2hr-2g5m-vwhr、GHSA-qhr7-859c-m2p7、GHSA-6j4f-fj2g-mc7p；保留既有 5.x API，修補 pattern 展開 CPU/遞迴風險。 |

`source-map-js`、`undici`、`brace-expansion` 的 overrides 用來收斂不同父套件的傳遞解析到已審查 patch。`sharp` override 與直接依賴一致，讓 Next 不保留另一份舊影像解析器。既有 minimatch 覆寫不變，不跨 major 更新本批套件。

## 可利用性與回歸契約

- 收據預覽會完整解析再編碼 JPEG/PNG/WebP，PDF 使用獨立 rasterization 流程；頭像也透過 sharp 解析。宣告 MIME 不等於實際格式，不能因只允許 raster MIME 就認定 librsvg 不會接觸偽裝輸入。
- 以合成 raster/PDF 測試正常重新編碼、metadata、頁面、壞檔、polyglot、超限與 timeout；新增 SVG 偽裝 raster 的收據/頭像拒絕契約。測試不是對外 exploit，也不聲稱已重現 CVE。
- source-map 回歸包含正常 indexed map 原始位置、來源內容、PostCSS map round-trip，以及在展開前拒絕過大 section offset。上游型別未描述 JSON 字串/indexed map constructor，因此測試以明確的 JSON constructor 型別對接實際 API。
- 開發鏈回歸確認 brace `expand` 的檔案 pattern 與 undici Headers/fetch API，並透過 lint、typecheck、jsdom 套件測試驗證相容性。版本契約核對 lock 中每份相關依賴，而非只看根目錄版本。
- source maps 沒有產品接收使用者任意映射的 API；警報仍須在 build 依賴修補，不把單一版本警報當成已證實產品可被利用。

## 尚無修補的警報

`braces` 3.0.3 的 GHSA-vfj7-8cjw-p6xm 尚無公告修補版本；鏈為 eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces，屬開發工具的 pattern 處理。沒有用不相容替代套件或任意 major 覆寫掩蓋警報。不要在未隔離的 lint/build 輸入接受不可信超深 pattern。

本次 npm audit 快照由 18 affected packages（17 high、1 moderate）降為 5 high affected packages，皆是上述同一 braces 公告的傳遞鏈；`--omit=dev` 為 0。affected package 數不等於獨立漏洞數，掃描沒有警報也不表示所有漏洞已排除。
