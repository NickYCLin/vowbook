-- 桌名可以重複：桌次的身分改由「桌號」承擔，桌號從順位推導（跳過含 4 的
-- 數字），桌名退回成純粹的標籤。同一場婚宴本來就會有好幾桌都叫「男方同事」。
DROP INDEX "seating_tables_workspace_id_name_key";
