const engagement = [
  ["date-place", "確認文定日期與儀式地點", "與雙方確認方便的日期、地點及參與方式。"],
  ["ceremony", "討論文定儀式項目", "先取得雙方共識，傳統流程可依需求簡化，不需要的項目可移除。"],
  ["participants", "確認文定參與人員與時程", "確認參與名單、集合時間與儀式協助人員。"],
  ["supplies", "整理文定戒指與儀式用品", "依實際採用的儀式列出物品、保管與攜帶分工。"],
  ["cakes", "確認喜餅數量與交付方式", "核對需要的家庭、盒數、到貨與發送安排。"],
  ["appearance", "確認文定服裝妝髮與攝影", "確認需要的服裝、服務內容及到場時間。"],
  ["cash", "核對文定紅包與現金需求", "自行確認對象與金額，另行準備，不會自動新增花費或付款。"],
  ["packing", "檢查文定當天攜帶物品", "逐項核對用品、文件及聯絡方式，確認負責攜帶的人。"],
] as const;
const reception = [
  ["venue", "確認宴客場地桌數與餐點", "核對桌數、菜單、服務內容與合約約定。"],
  ["guests", "整理宴客賓客名單與邀請", "確認邀請對象、聯絡方式與回覆追蹤安排。"],
  ["seating", "安排桌次與特殊餐點", "依出席回覆安排座位，核對素食與其他用餐需求。"],
  ["staff", "確認宴客工作人員與分工", "確認招待、收禮、發餅等需要的協助與聯絡方式。"],
  ["timeline", "核對宴客當天流程與主持內容", "與相關人員確認時程、音樂、影片及轉場安排。"],
  ["gifts", "準備收禮與發餅用品", "依實際需要確認禮金記錄、收禮桌與發餅物品。"],
  ["vendors", "確認廠商到場與服務內容", "核對廠商聯絡方式、到場時間與約定項目。"],
  ["payment", "核對宴客尾款與現金安排", "檢查付款方式與待付金額，不會自動標記任何款項已付款。"],
  ["transport", "確認宴客交通與住宿安排", "核對停車、接送及需要住宿的參與人員。"],
  ["review", "完成宴客前最後核對", "確認名單、桌次、流程、用品與備份文件皆為最新。"],
] as const;

export const WEDDING_TASK_TEMPLATES = [
  { key: "ENGAGEMENT", label: "文定任務", description: "可依雙方共識調整的文定準備清單。", tasks: engagement.map(([key, title, description]) => ({ key: `ENGAGEMENT_V1:${key}`, title, description })) },
  { key: "RECEPTION", label: "宴客任務", description: "從名單到現場分工的宴客準備清單。", tasks: reception.map(([key, title, description]) => ({ key: `RECEPTION_V1:${key}`, title, description })) },
] as const;

export function findWeddingTaskTemplate(key: unknown) {
  return WEDDING_TASK_TEMPLATES.find((template) => template.key === key);
}
