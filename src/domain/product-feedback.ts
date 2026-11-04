export const feedbackCategories = {
  problem: "操作問題", suggestion: "功能建議", habit: "使用習慣", other: "其他",
} as const;

export const feedbackSections = {
  overview: "婚宴首頁", guests: "賓客與邀請", tables: "桌次", tasks: "任務",
  budget: "花費", documents: "文件", "check-in": "報到", gifts: "禮金",
  timeline: "總流程", staff: "工作人員", members: "協作者", settings: "婚宴設定",
} as const;

export function normalizeProductFeedback(formData: FormData) {
  const read = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value.trim() : "";
  };
  const requestId = read("requestId");
  const section = read("section");
  const category = read("category");
  const message = read("message");
  const contact = read("contact");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestId)) {
    throw new Error("請重新開啟回饋表單後再試。");
  }
  if (!Object.hasOwn(feedbackSections, section) || !Object.hasOwn(feedbackCategories, category)) {
    throw new Error("請選擇有效的相關功能與回饋類型。");
  }
  if (message.length < 10 || message.length > 3000) throw new Error("請填寫 10 至 3000 字的回饋內容。");
  if (contact && (contact.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(contact))) {
    throw new Error("請填寫有效的回覆電子郵件，或留空。");
  }
  return { requestId, section, category, message, contact: contact || null };
}
