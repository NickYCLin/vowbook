-- 廠商提供：新增準備方式選項，不改動既有花費。
ALTER TYPE "BudgetPreparationStatus" ADD VALUE IF NOT EXISTS 'VENDOR_PROVIDED' AFTER 'ALREADY_OWNED';
