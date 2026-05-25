export default function CommunityFeedLoading() {
  return (
    <div className="min-h-screen bg-[#fffdf7] flex flex-col">
      <div className="flex-1 flex w-full max-w-[1680px] mx-auto">
        {/* 왼쪽 사이드바 skeleton — 실제 폭/배경 그대로 */}
        <aside className="hidden xl:flex bg-[#fffdf7] h-[calc(100vh-4rem)] w-56 2xl:w-60 sticky top-16 flex-col pt-6 pb-5 px-3 border-r border-[#eadfc9] z-40">
          {/* 헤더 */}
          <div className="mb-5 px-2 space-y-2">
            <div className="h-7 w-28 bg-[#ede8e6] rounded animate-pulse" />
            <div className="h-4 w-48 bg-[#f3efed] rounded animate-pulse" />
          </div>
          {/* 동기방 카드 */}
          <div className="mb-4">
            <div className="rounded-xl bg-gradient-to-br from-[#9d6f36]/60 to-[#102a4d]/60 h-28 animate-pulse" />
          </div>
          {/* 카테고리 탭 */}
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-10 bg-[#ede8e6] rounded-xl animate-pulse"
                style={{ animationDelay: `${i * 60}ms` }}
              />
            ))}
          </div>
          {/* 글쓰기 버튼 */}
          <div className="mt-4 px-1">
            <div className="h-10 bg-[#e4d9d9] rounded-lg animate-pulse" />
          </div>
        </aside>

        {/* 메인 피드 skeleton */}
        <main className="flex-1 min-w-0 px-4 sm:px-5 xl:px-5 2xl:px-6 py-5 sm:py-6">
          <div className="max-w-[980px] mx-auto space-y-4 sm:space-y-5">
            {/* 헤더 */}
            <div className="space-y-2">
              <div className="h-9 w-48 bg-[#ede8e6] rounded animate-pulse" />
              <div className="h-5 w-72 bg-[#f3efed] rounded animate-pulse" />
            </div>

            {/* 정렬 바 */}
            <div className="flex items-center gap-3 px-1 border-b border-[#eadfc9] pb-4">
              <div className="h-8 w-16 bg-[#ede8e6] rounded-lg animate-pulse" />
              <div className="h-8 w-16 bg-[#ede8e6] rounded-lg animate-pulse" />
              <div className="h-8 w-20 bg-[#ede8e6] rounded-lg animate-pulse" />
            </div>

            {/* 포스트 카드 — space-y-6 */}
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
        <aside className="hidden xl:block w-72 2xl:w-80 shrink-0 px-4 2xl:px-5 py-6 border-l border-[#eadfc9] sticky top-16 h-[calc(100vh-4rem)] bg-[#fffdf7] space-y-4">
          <div className="bg-white rounded-xl border border-[#F0EFED] p-5 h-36 animate-pulse" />
          <div className="bg-white rounded-xl border border-[#F0EFED] p-5 h-48 animate-pulse" />
          <div className="bg-white rounded-xl border border-[#F0EFED] p-5 h-36 animate-pulse" />
        </aside>
      </div>
    </div>
  );
}
