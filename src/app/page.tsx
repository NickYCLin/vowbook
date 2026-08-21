import { SignInButton } from "@/components/auth/sign-in-button";
import { Wordmark } from "@/components/brand/wordmark";

// The landing HTML references deployment-hashed Next assets. It must not be
// shared-cached across deployments, otherwise an edge can retain old HTML that
// points at CSS/JS assets removed by a later release.
export const dynamic = "force-dynamic";

const steps = [
  ["01", "建立共同空間", "以 Google 帳號登入，為你們的婚宴建立專屬工作區。"],
  ["02", "邀請重要夥伴", "透過明確成員權限，與伴侶或婚顧安心協作。"],
  ["03", "保留每個決定", "重要資訊都留在同一處，不必再翻找散落的訊息。"],
] as const;

export default function HomePage() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 py-6 sm:px-8 lg:px-10">
        <Wordmark />
        <a
          href="#how-it-works"
          className="hidden text-sm font-medium text-ink-soft underline-offset-8 hover:text-ink hover:underline sm:block"
        >
          如何開始
        </a>
      </header>

      <main>
        <section className="mx-auto grid min-h-[calc(100vh-7rem)] w-full max-w-6xl items-center gap-14 px-5 py-12 sm:px-8 lg:grid-cols-[1.08fr_0.92fr] lg:px-10 lg:py-16">
          <div className="max-w-2xl">
            <p className="mb-5 flex items-center gap-3 text-sm font-semibold tracking-[0.18em] text-clay">
              <span className="h-px w-10 bg-[#a87d60]" aria-hidden="true" />
              為兩個人的重要一天
            </p>
            <h1 className="font-serif text-[clamp(3.4rem,10vw,7.2rem)] leading-[0.92] font-semibold tracking-[-0.055em] text-ink">
              誓約簿
              <span className="mt-4 block font-sans text-[0.22em] tracking-[0.3em] text-clay">
                VOWBOOK
              </span>
            </h1>
            <p className="mt-8 max-w-xl font-serif text-2xl leading-relaxed text-ink sm:text-3xl">
              一起把婚宴裡的每個承諾，
              <span className="whitespace-nowrap">安穩地放在同一頁。</span>
            </p>
            <p className="mt-5 max-w-lg text-base leading-8 text-ink-soft">
              從第一個決定開始，讓伴侶與婚顧共享清楚的進度與權限。少一點反覆確認，多一點從容期待。
            </p>
            <div className="mt-9 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
              <SignInButton className="inline-flex min-h-14 items-center justify-center gap-3 rounded-full bg-clay px-6 py-3 font-semibold text-white shadow-[0_8px_24px_rgba(91,58,39,0.18)] transition hover:-translate-y-0.5 hover:bg-clay-strong disabled:cursor-wait disabled:opacity-70" />
              <span className="text-sm leading-6 text-ink-soft">
                開放註冊・資料依工作區隔離
              </span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-md py-10 lg:justify-self-end" aria-hidden="true">
            <div className="absolute inset-x-8 bottom-5 h-12 rounded-[50%] bg-ink/10 blur-xl" />
            <div className="relative rotate-[2deg] rounded-r-2xl rounded-l-md border border-line-strong bg-[#dfcdbb] p-3 shadow-[18px_22px_45px_rgba(77,57,43,0.2)]">
              <div className="min-h-[26rem] rounded-r-xl border border-line bg-surface px-8 py-12 shadow-[inset_12px_0_24px_rgba(103,76,55,0.08)] sm:px-12">
                <div className="mx-auto h-px w-16 bg-[#ac8165]" />
                <p className="mt-10 text-center font-serif text-4xl tracking-[0.18em] text-ink">
                  我們的婚宴
                </p>
                <p className="mt-5 text-center text-xs tracking-[0.32em] text-ink-faint">
                  OUR WEDDING DAY
                </p>
                <div className="mt-20 space-y-4">
                  <div className="h-px bg-surface-sunken" />
                  <div className="h-px bg-surface-sunken" />
                  <div className="h-px bg-surface-sunken" />
                </div>
                <p className="mt-12 text-center font-serif text-lg italic text-clay">
                  從今天起，一起完成。
                </p>
              </div>
            </div>
          </div>
        </section>

        <section
          id="how-it-works"
          className="border-y border-line/80 bg-paper-deep/70"
        >
          <div className="mx-auto grid w-full max-w-6xl px-5 py-14 sm:px-8 md:grid-cols-3 lg:px-10">
            {steps.map(([number, title, description], index) => (
              <article
                key={number}
                className={`py-7 md:px-8 md:py-2 ${
                  index > 0
                    ? "border-t border-line/80 md:border-t-0 md:border-l"
                    : ""
                }`}
              >
                <p className="font-serif text-sm italic text-clay">{number}</p>
                <h2 className="mt-3 font-serif text-2xl font-semibold">{title}</h2>
                <p className="mt-3 leading-7 text-ink-soft">{description}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <footer className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-8 text-sm text-ink-soft sm:flex-row sm:items-center sm:justify-between sm:px-8 lg:px-10">
        <span>誓約簿 VowBook</span>
        <span>把重要的事，留在彼此都找得到的地方。</span>
      </footer>
    </div>
  );
}
