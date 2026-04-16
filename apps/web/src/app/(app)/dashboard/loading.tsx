export default function DashboardLoading() {
  return (
    <div className="max-w-[1100px] mx-auto animate-pulse">
      {/* D-day 히어로 skeleton */}
      <div className="bg-gradient-to-br from-[#1A1A1F] to-[#2A2A2F] rounded-3xl p-10 max-md:p-6 mb-8">
        <div className="flex items-center justify-between max-md:flex-col max-md:text-center max-md:gap-6">
          <div>
            <div className="h-3 w-20 bg-white/10 rounded mb-4" />
            <div className="h-16 w-40 bg-white/10 rounded-lg mb-3" />
            <div className="h-4 w-48 bg-white/10 rounded" />
          </div>
          <div className="w-[120px] h-[120px] rounded-full bg-white/[0.06]" />
        </div>
      </div>

      {/* 빠른 액션 skeleton */}
      <div className="grid grid-cols-3 gap-4 mb-8 max-md:grid-cols-1">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="bg-white rounded-2xl p-6 border border-black/[0.04]"
          >
            <div className="w-11 h-11 rounded-xl bg-[#F0EFED] mb-4" />
            <div className="h-4 w-32 bg-[#F0EFED] rounded mb-2" />
            <div className="h-3 w-24 bg-[#F5F2ED] rounded" />
          </div>
        ))}
      </div>

      {/* 카테고리 현황 + 시작 가이드 skeleton */}
      <div className="grid grid-cols-5 gap-6 max-lg:grid-cols-1">
        {/* 카테고리 현황 */}
        <div className="col-span-3 bg-white rounded-2xl p-6 border border-black/[0.04]">
          <div className="flex items-center justify-between mb-5">
            <div className="h-5 w-36 bg-[#F0EFED] rounded" />
            <div className="h-4 w-16 bg-[#F0EFED] rounded" />
          </div>
          <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="h-11 rounded-xl bg-[#FAF8F5] border border-black/[0.02]"
                style={{ animationDelay: `${i * 40}ms` }}
              />
            ))}
          </div>
        </div>

        {/* 시작 가이드 */}
        <div className="col-span-2 bg-white rounded-2xl p-6 border border-black/[0.04]">
          <div className="h-5 w-24 bg-[#F0EFED] rounded mb-5" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 px-3 py-3">
                <div className="w-8 h-8 rounded-lg bg-[#F5F2ED] flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-full bg-[#F0EFED] rounded" />
                  <div className="h-3 w-16 bg-[#F5F2ED] rounded" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
