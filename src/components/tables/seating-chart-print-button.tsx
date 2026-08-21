"use client";

import { Button } from "@/components/ui/button";

/**
 * 交給瀏覽器的列印流程：使用者可以直接印，也可以選「另存為 PDF」
 * 拿去給婚宴會館輸出。@page 已由桌圖本身固定成 9:16。
 */
export function SeatingChartPrintButton() {
  return (
    <Button variant="primary" onClick={() => window.print()}>
      列印／另存 PDF
    </Button>
  );
}
