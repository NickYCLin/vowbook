import Link from "next/link";

type WordmarkProps = {
  compact?: boolean;
  href?: string;
};

export function Wordmark({ compact = false, href = "/" }: WordmarkProps) {
  const ariaLabel =
    href === "/dashboard" ? "誓約簿 VowBook 我的婚宴" : "誓約簿 VowBook 首頁";

  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center gap-2.5 text-ink no-underline"
      aria-label={ariaLabel}
    >
      {/* 書冊圖記：左側書脊圓角較小，右側像翻開的紙頁 */}
      <span
        aria-hidden="true"
        className="grid size-8 place-items-center rounded-t-[0.9rem] rounded-b-sm border border-line-strong bg-clay-soft font-serif text-caption font-semibold text-clay-strong shadow-[1.5px_1.5px_0_var(--color-line-strong)]"
      >
        誓
      </span>
      <span className="flex items-baseline gap-2">
        <span className="font-serif text-lg font-semibold tracking-[0.1em]">
          誓約簿
        </span>
        {!compact && (
          <span className="text-eyebrow font-semibold text-ink-faint">
            VOWBOOK
          </span>
        )}
      </span>
    </Link>
  );
}
