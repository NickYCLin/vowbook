/**
 * 合併 className：略過 false / null / undefined，並壓掉多餘空白。
 * 刻意保持最小實作，不引入 clsx 之類的相依套件。
 */
export function cn(
  ...values: (string | false | null | undefined)[]
): string {
  return values.filter(Boolean).join(" ").replace(/\s+/gu, " ").trim();
}
