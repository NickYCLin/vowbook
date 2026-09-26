import { Fragment } from "react";

const urlPattern = /(https?:\/\/[^\s<>「」（）()，。、]+)/gu;

/** 把文字裡的網址變成可點的連結，其他字照原樣輸出。 */
export function LinkifiedText({ text }: { text: string }) {
  const parts = text.split(urlPattern);
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <a
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            data-inline-link="true"
            className="font-semibold text-clay-strong underline underline-offset-2 [overflow-wrap:anywhere]"
          >
            {part}
          </a>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}
