export default function WorkspaceSectionLoading() {
  return (
    <main
      role="status"
      aria-label="正在切換工作區頁面"
      aria-busy="true"
      className="mx-auto w-full max-w-6xl min-w-0 px-5 py-6 sm:px-8 sm:py-12"
    >
      <span className="sr-only">正在載入最新資料…</span>

      <div
        aria-hidden="true"
        className="animate-pulse"
      >
        <div className="h-11 w-28 rounded-control bg-surface-sunken" />

        <div className="mt-3 flex min-w-0 gap-1 overflow-hidden border-b border-line pb-px">
          {Array.from({ length: 7 }, (_, index) => (
            <div
              key={index}
              className="h-11 w-20 shrink-0 rounded-t-control bg-surface-sunken"
            />
          ))}
        </div>

        <div className="py-5">
          <div
            data-loading-line
            className="h-8 w-64 max-w-full rounded-control bg-surface-sunken"
          />
          <div
            data-loading-line
            className="mt-3 h-4 w-[34rem] max-w-full rounded-control bg-surface-sunken"
          />
        </div>

        <section className="overflow-hidden rounded-2xl border border-line bg-surface">
          <div className="border-b border-line px-4 py-4 sm:px-5">
            <div
              data-loading-line
              className="h-5 w-36 rounded-control bg-surface-sunken"
            />
          </div>
          <div className="space-y-3 px-4 py-5 sm:px-5">
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={index}
                data-loading-line
                className="h-16 rounded-xl bg-surface-sunken"
              />
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
