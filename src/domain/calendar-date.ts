/** Date-only deadlines use the wedding's calendar day, not the server's UTC day. */
export function dateKeyInTimezone(value: Date, timezone = "Asia/Taipei"): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(value);
  const part = (type: "year" | "month" | "day") => parts.find(entry => entry.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
