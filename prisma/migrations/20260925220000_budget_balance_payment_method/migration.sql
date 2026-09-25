-- 尾款怎麼付：匯款、現金、紅包或刷卡。當天要準備現金／紅包的項目才能在尾款清單裡先挑出來。
-- additive：新欄位可為 NULL，代表尚未設定，不影響既有資料。
CREATE TYPE "BudgetBalancePaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'RED_ENVELOPE', 'CARD');

ALTER TABLE "budget_items"
  ADD COLUMN "balance_payment_method" "BudgetBalancePaymentMethod";
