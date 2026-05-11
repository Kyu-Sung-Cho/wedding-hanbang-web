export default function CategoryFeedLoading() {
  return (
    <div className="min-h-screen bg-[#fcf9f8] flex flex-col">
      <div className="flex-1 flex w-full max-w-[1500px] mx-auto">
        {/* 왼쪽 사이드바 — 카테고리 페이지 실제 폭 그대로 */}
        <aside className="hidden xl:flex bg-[#fcf9f8] h-[calc(100vh-4rem)] w-64 2xl:w-72 sticky top-16 flex-col pt-8 pb-6 px-4 border-r border-[#e4e2e1] z-40">
          <div className="space-y-2 px-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-10 bg-[#ede8e6] rounded-xl animate-pulse"
                style={{ animationDelay: `${i * 60}ms` }}
              />
            ))}
          </div>
          <div className="mt-auto pt-4 px-2">
            <div className="h-12 bg-[#e4d9d9] rounded-lg animate-pulse" />
          </div>
        </aside>

        {/* 메인 피드 skeleton */}
        <main className="flex-1 min-w-0 px-4 sm:px-5 lg:px-6 xl:px-8 2xl:px-10 py-5 sm:py-6 lg:py-8">
          <div className="max-w-[760px] 2xl:max-w-[800px] mx-auto space-y-5 sm:space-y-6 lg:space-y-8">
            <div className="space-y-2">
              <div className="h-9 w-40 bg-[#ede8e6] rounded animate-pulse" />
              <div className="h-5 w-64 bg-[#f3efed] rounded animate-pulse" />
            </div>

            <div className="flex items-center gap-3 px-1 border-b border-[#e4e2e1] pb-4">
              <div className="h-8 w-16 bg-[#ede8e6] rounded-lg animate-pulse" />
              <div className="h-8 w-16 bg-[#ede8e6] rounded-lg animate-pulse" />
              <div className="h-8 w-20 bg-[#ede8e6] rounded-lg animate-pulse" />
            </div>

            <div className="space-y-5 sm:space-y-6">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-white rounded-xl border border-[#F0EFED] p-5 space-y-3"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-16 bg-[#ede8e6] rounded animate-pulse" />
                    <div className="h-4 w-20 bg-[#ede8e6] rounded animate-pulse" />
                    <div className="h-4 w-12 bg-[#ede8e6] rounded animate-pulse" />
                  </div>
                  <div className="h-6 w-3/4 bg-[#ede8e6] rounded animate-pulse" />
                  <div className="h-4 w-full bg-[#f3efed] rounded animate-pulse" />
                  <div className="h-4 w-2/3 bg-[#f3efed] rounded animate-pulse" />
                  <div className="flex items-center gap-6 pt-2">
                    <div className="h-5 w-16 bg-[#ede8e6] rounded animate-pulse" />
                    <div className="h-5 w-12 bg-[#ede8e6] rounded animate-pulse" />
                    <div className="h-5 w-12 bg-[#ede8e6] rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>

        {/* 오른쪽 사이드바 skeleton */}
        <aside className="hidden 2xl:block w-80 shrink-0 p-6 border-l border-[#e4e2e1] sticky top-16 h-[calc(100vh-4rem)] bg-[#fcf9f8] space-y-5">
          <div className="bg-white rounded-xl border border-[#F0EFED] p-5 h-36 animate-pulse" />
          <div className="bg-white rounded-xl border border-[#F0EFED] p-5 h-64 animate-pulse" />
          <div className="bg-white rounded-xl border border-[#F0EFED] p-5 h-28 animate-pulse" />
        </aside>
      </div>
    </div>
  );
}
