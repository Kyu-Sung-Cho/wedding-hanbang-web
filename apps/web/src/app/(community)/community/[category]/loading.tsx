export default function CategoryFeedLoading() {
  return (
    <div className="min-h-screen bg-[var(--hb-surface-page)] flex flex-col">
      <div className="flex-1 flex w-full max-w-[1320px] mx-auto">
        {/* 왼쪽 사이드바 — 카테고리 페이지 실제 폭 그대로 */}
        <aside className="hidden xl:flex bg-[var(--hb-surface-page)] h-[calc(100vh-4rem)] w-56 2xl:w-60 sticky top-16 flex-col pt-6 pb-5 px-3 border-r border-[var(--hb-hairline)] z-40">
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-10 bg-[#f1e8da] rounded-[6px] animate-pulse"
                style={{ animationDelay: `${i * 60}ms` }}
              />
            ))}
          </div>
          <div className="mt-4 px-1">
            <div className="h-10 bg-[#e4d9d9] rounded-[6px] animate-pulse" />
          </div>
        </aside>

        {/* 메인 피드 skeleton */}
        <main className="flex-1 min-w-0 px-4 sm:px-5 xl:px-5 2xl:px-6 py-5 sm:py-6">
          <div className="max-w-[980px] mx-auto space-y-4 sm:space-y-5">
            <div className="space-y-2">
              <div className="h-9 w-40 bg-[#f1e8da] rounded-[6px] animate-pulse" />
              <div className="h-5 w-64 bg-[#f3efed] rounded-[6px] animate-pulse" />
            </div>

            <div className="flex items-center gap-3 px-1 border-b border-[var(--hb-hairline)] pb-4">
              <div className="h-8 w-16 bg-[#f1e8da] rounded-[6px] animate-pulse" />
              <div className="h-8 w-16 bg-[#f1e8da] rounded-[6px] animate-pulse" />
              <div className="h-8 w-20 bg-[#f1e8da] rounded-[6px] animate-pulse" />
            </div>

            <div className="space-y-5 sm:space-y-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-white rounded-[6px] border border-[#F0EFED] p-5 space-y-3"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-16 bg-[#f1e8da] rounded-[6px] animate-pulse" />
                    <div className="h-4 w-20 bg-[#f1e8da] rounded-[6px] animate-pulse" />
                    <div className="h-4 w-12 bg-[#f1e8da] rounded-[6px] animate-pulse" />
                  </div>
                  <div className="h-6 w-3/4 bg-[#f1e8da] rounded-[6px] animate-pulse" />
                  <div className="h-4 w-full bg-[#f3efed] rounded-[6px] animate-pulse" />
                  <div className="h-4 w-2/3 bg-[#f3efed] rounded-[6px] animate-pulse" />
                  <div className="flex items-center gap-6 pt-2">
                    <div className="h-5 w-16 bg-[#f1e8da] rounded-[6px] animate-pulse" />
                    <div className="h-5 w-12 bg-[#f1e8da] rounded-[6px] animate-pulse" />
                    <div className="h-5 w-12 bg-[#f1e8da] rounded-[6px] animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>

        {/* 오른쪽 사이드바 skeleton */}
        <aside className="hidden xl:block w-72 2xl:w-80 shrink-0 px-4 2xl:px-5 py-6 border-l border-[var(--hb-hairline)] sticky top-16 h-[calc(100vh-4rem)] bg-[var(--hb-surface-page)] space-y-4">
          <div className="bg-white rounded-[6px] border border-[#F0EFED] p-5 h-36 animate-pulse" />
          <div className="bg-white rounded-[6px] border border-[#F0EFED] p-5 h-64 animate-pulse" />
          <div className="bg-white rounded-[6px] border border-[#F0EFED] p-5 h-28 animate-pulse" />
        </aside>
      </div>
    </div>
  );
}
