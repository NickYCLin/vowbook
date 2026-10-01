"use client";

import Link from "next/link";
import { Printer } from "@phosphor-icons/react/dist/ssr";
import { useId, useRef, useState } from "react";
import { withBasePath } from "@/lib/base-path";
import { Button, buttonClassName } from "@/components/ui/button";
import { Dialog, useModalDialog } from "@/components/ui/dialog";

/** The print route still loads through the authenticated server page. */
export function PrintPreviewLink({ href, children }: { href: string; children: string }) {
  const { dialogRef, triggerRef, open, close, restoreFocus } = useModalDialog<HTMLAnchorElement>();
  const titleId = useId();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [opened, setOpened] = useState(false);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");
  const closePreview = () => { close(); setOpened(false); };
  return <>
    <Link ref={triggerRef} href={href} className={buttonClassName({ variant: "secondary" })} onClick={event => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      event.preventDefault();
      setState("loading");
      setOpened(true);
      open();
    }}><Printer aria-hidden="true" className="size-4 shrink-0" />{children}</Link>
    <Dialog dialogRef={dialogRef} titleId={titleId} title={children} description="關閉預覽後，可繼續原本的操作。" closeLabel="關閉列印預覽" onClose={closePreview} onRestoreFocus={() => { setOpened(false); restoreFocus(); }} size="xl">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
        <Link href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center text-sm text-clay-strong">另開列印頁</Link>
        <Button disabled={state !== "ready"} onClick={() => frameRef.current?.contentWindow?.print()}>列印／另存 PDF</Button>
      </div>
      {opened && <>
        {state === "loading" && <p role="status" className="px-5 py-3 text-sm text-ink-soft">正在準備預覽…</p>}
        {state === "unavailable" && <p role="alert" className="px-5 py-3 text-sm text-danger">無法載入預覽，請使用「另開列印頁」確認登入與存取權限。</p>}
        <iframe ref={frameRef} title={`${children}預覽`} src={withBasePath(`${href}?preview=1`)} className="h-[65dvh] min-h-64 w-full border-0 bg-surface" onLoad={() => {
          const document = frameRef.current?.contentDocument;
          setState(document?.querySelector("[data-print-document]") ? "ready" : "unavailable");
        }} onError={() => setState("unavailable")} />
      </>}
    </Dialog>
  </>;
}
