import type { OperationsPrintData } from "./operations-print";
import type { WeddingTimelineListItem } from "@/lib/wedding-timeline-list";

type Item = Pick<
  WeddingTimelineListItem,
  "id" | "startTime" | "endTime" | "phase" | "title" | "details" | "mediaCue" | "notes" | "location"
>;

/** 主持人拿在手上的版本：時間、段落、音樂影片與要注意的細節。 */
export function hostTimelinePrintData(items: readonly Item[]): OperationsPrintData {
  return {
    summary: `${items.length} 個流程段落`,
    columns: [
      { label: "時間", width: 12 },
      { label: "段落", width: 20 },
      { label: "音樂／影片", width: 20 },
      { label: "細節", width: 30 },
      { label: "備註", width: 18 },
    ],
    rows: items.map((item) => ({
      key: item.id,
      cells: [
        item.endTime ? `${item.startTime}–${item.endTime}` : item.startTime,
        [item.phase, item.title, item.location ? `＠${item.location}` : ""]
          .filter(Boolean)
          .join("\n"),
        item.mediaCue ?? "",
        item.details ?? "",
        item.notes ?? "",
      ],
    })),
  };
}
