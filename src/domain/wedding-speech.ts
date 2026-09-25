export const WEDDING_SPEECHES = ["GROOM_PARENTS", "BRIDE_PARENTS"] as const;

export type WeddingSpeechKey = (typeof WEDDING_SPEECHES)[number];

export const WEDDING_SPEECH_LABELS: Record<WeddingSpeechKey, string> = {
  GROOM_PARENTS: "新郎謝親恩",
  BRIDE_PARENTS: "新娘謝親恩",
};

/** 念一分鐘大約兩三百字，留足空間給想多講一點的人。 */
export const WEDDING_SPEECH_MAX = 3000;

/**
 * 空白時可以一鍵帶入的草稿；【】裡要換成新人自己的回憶，
 * 感性和幽默各留一兩句，念起來大約一分鐘。
 */
export const WEDDING_SPEECH_TEMPLATES: Record<WeddingSpeechKey, string> = {
  GROOM_PARENTS: [
    "爸、媽，謝謝你們。",
    "小時候最怕媽說「等你爸回來你就知道」，後來才發現，爸回來只會偷偷塞零用錢給我。",
    "你們很少把愛說出口，但每次我回家，冰箱都塞滿我愛吃的東西；每次出門，媽都會站在門口，看到車子轉彎才進去。",
    "今天我也有了自己的家，以後換我學你們，好好照顧【新娘名字】。",
    "順便報告一下，從今天起家裡多了一個會幫你們唸我的人，你們終於有幫手了。",
    "爸、媽，我愛你們。",
  ].join("\n"),
  BRIDE_PARENTS: [
    "爸、媽，今天我要嫁人了。",
    "我從小就是家裡最愛哭、最愛頂嘴的那個。【換成自己的回憶，例：半夜發燒是媽抱我跑急診，考不好是爸偷偷幫我簽聯絡簿】",
    "以前覺得你們管太多，長大才懂，那些嘮叨都是捨不得。",
    "爸，【新郎名字】被你面試了【N】年，今天應該算正式錄取了吧。",
    "媽，你不用擔心我吃不飽，他煮的沒有你好吃，但他會洗碗。",
    "我不是離開家，是多了一個家，以後回家會變成兩個人一起回來。",
    "謝謝你們把我養得這麼好，我愛你們。",
  ].join("\n"),
};

export class WeddingSpeechValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeddingSpeechValidationError";
  }
}

export function parseWeddingSpeech(value: unknown): WeddingSpeechKey {
  if (
    typeof value !== "string" ||
    !(WEDDING_SPEECHES as readonly string[]).includes(value)
  ) {
    throw new WeddingSpeechValidationError("致詞類型無效，請重新整理後再試。");
  }
  return value as WeddingSpeechKey;
}

/** 保留換行，只去掉頭尾空白與行尾空白；清空代表還沒寫。 */
export function normalizeWeddingSpeechContent(value: unknown): string | null {
  const raw = typeof value === "string" ? value.replace(/\r\n?/gu, "\n") : "";
  const normalized = raw
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
  if (Array.from(normalized).length > WEDDING_SPEECH_MAX) {
    throw new WeddingSpeechValidationError(
      `致詞稿最多 ${WEDDING_SPEECH_MAX} 個字。`,
    );
  }
  return normalized === "" ? null : normalized;
}

/** 以一分鐘約 220 字估算，給念稿的人抓時間。 */
export function estimateSpeechSeconds(content: string): number {
  const characters = Array.from(content.replace(/\s/gu, "")).length;
  return Math.max(5, Math.round((characters / 220) * 60 / 5) * 5);
}
