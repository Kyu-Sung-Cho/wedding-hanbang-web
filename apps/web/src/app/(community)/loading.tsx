export default function CommunityLoading() {
  return (
    <div className="min-h-screen bg-[#FAFAF8]">
      {/* Nav skeleton */}
      <div className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-[#F0EFED]">
        <div className="px-4 sm:px-6 lg:px-8 h-14 sm:h-16 flex items-center gap-3 sm:gap-4">
          <div className="h-6 w-24 bg-[#F0EFED] rounded animate-pulse" />
          <div className="hidden sm:block flex-1 max-w-xl mx-auto h-10 bg-[#F5F2ED] rounded-full animate-pulse" />
          <div className="h-9 w-20 bg-[#F0EFED] rounded-full animate-pulse" />
        </div>
      </div>

      <div className="max-w-[1500px] mx-auto px-4 sm:px-5 lg:px-6 xl:px-8 2xl:px-10 py-5 sm:py-6 lg:py-8">
        <div className="flex gap-5 lg:gap-6">
          {/* 사이드바 skeleton */}
          <div className="hidden xl:block w-64 2xl:w-72 shrink-0 space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="h-9 bg-[#F0EFED] rounded-xl animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
            ))}
          </div>

          {/* 메인 피드 skeleton */}
          <div className="flex-1 max-w-[760px] 2xl:max-w-[800px] mx-auto space-y-5">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-[#F0EFED] p-5 space-y-3" style={{ animationDelay: `${i * 80}ms` }}>
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

          {/* 오른쪽 사이드바 skeleton */}
          <div className="hidden 2xl:block w-80 shrink-0 space-y-4">
            <div className="bg-white rounded-xl border border-[#F0EFED] p-5 h-36 animate-pulse" />
            <div className="bg-white rounded-xl border border-[#F0EFED] p-5 h-28 animate-pulse" />
          </div>
        </div>
      </div>
    </div>
  );
}
