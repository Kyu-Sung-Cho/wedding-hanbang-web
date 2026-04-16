export default function CommunityFeedLoading() {
  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      <div className="flex w-full">
        {/* 왼쪽 사이드바 skeleton */}
        <aside className="hidden lg:flex flex-col w-[280px] xl:w-[300px] shrink-0 sticky top-[72px] h-[calc(100vh-72px)] border-r border-[#F0EFED] bg-white py-5 px-3">
          {/* 동기방 카드 skeleton */}
          <div className="px-2 mb-4">
            <div className="rounded-2xl bg-[#1A1A1F] h-32 animate-pulse" />
          </div>
          {/* 카테고리 탭 skeleton */}
          <div className="space-y-2 px-2">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-9 bg-[#F0EFED] rounded-xl animate-pulse"
                style={{ animationDelay: `${i * 60}ms` }}
              />
            ))}
          </div>
          {/* 글쓰기 버튼 skeleton */}
          <div className="mt-auto pt-4 px-2 space-y-2">
            <div className="h-11 bg-[#F0EFED] rounded-full animate-pulse" />
            <div className="h-12 bg-[#E8E6E3] rounded-full animate-pulse" />
          </div>
        </aside>

        {/* 메인 피드 skeleton */}
        <main className="flex-1 min-w-0 px-5 sm:px-8 lg:px-10 py-6">
          <div className="max-w-[800px] mx-auto lg:mx-0 lg:max-w-none">
            {/* 정렬 바 skeleton */}
            <div className="flex items-center gap-3 mb-5 px-1">
              <div className="h-8 w-16 bg-[#F0EFED] rounded-lg animate-pulse" />
              <div className="h-8 w-16 bg-[#F0EFED] rounded-lg animate-pulse" />
              <div className="h-8 w-20 bg-[#F0EFED] rounded-lg animate-pulse" />
            </div>

            {/* 포스트 카드 skeleton */}
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-white rounded-2xl border border-[#F0EFED] p-6 space-y-3"
                  style={{ animationDelay: `${i * 80}ms` }}
                >
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-16 bg-[#F0EFED] rounded animate-pulse" />
                    <div className="h-4 w-20 bg-[#F0EFED] rounded animate-pulse" />
                    <div className="h-4 w-12 bg-[#F0EFED] rounded animate-pulse" />
                  </div>
                  <div className="h-6 w-3/4 bg-[#F0EFED] rounded animate-pulse" />
                  <div className="h-4 w-full bg-[#F5F2ED] rounded animate-pulse" />
                  <div className="h-4 w-2/3 bg-[#F5F2ED] rounded animate-pulse" />
                  <div className="flex items-center gap-6 pt-2">
                    <div className="h-5 w-16 bg-[#F0EFED] rounded animate-pulse" />
                    <div className="h-5 w-12 bg-[#F0EFED] rounded animate-pulse" />
                    <div className="h-5 w-12 bg-[#F0EFED] rounded animate-pulse" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </main>

        {/* 오른쪽 사이드바 skeleton */}
        <aside className="hidden xl:flex flex-col w-[340px] 2xl:w-[380px] shrink-0 sticky top-[72px] h-[calc(100vh-72px)] py-6 pr-6 pl-2 space-y-4 border-l border-[#F0EFED]">
          <div className="bg-white rounded-2xl border border-[#F0EFED] p-5 h-40 animate-pulse" />
          <div className="bg-white rounded-2xl border border-[#F0EFED] p-5 h-48 animate-pulse" />
          <div className="bg-white rounded-2xl border border-[#F0EFED] p-5 h-32 animate-pulse" />
        </aside>
      </div>
    </div>
  );
}
