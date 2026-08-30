export default function BudgetLoading() {
  return (
    <div className="max-w-[1000px] mx-auto animate-pulse">
      {/* 요약 카드 3개 skeleton */}
      <div className="grid grid-cols-3 gap-4 mb-8 max-md:grid-cols-1">
        {/* 총 예산 */}
        <div className="bg-white rounded-[6px] p-6 border border-black/[0.04]">
          <div className="h-3 w-12 bg-[#F0EFED] rounded-[6px] mb-3" />
          <div className="h-9 w-28 bg-[#F0EFED] rounded-[6px]" />
        </div>
        {/* 사용 금액 */}
        <div className="bg-white rounded-[6px] p-6 border border-black/[0.04]">
          <div className="h-3 w-16 bg-[#F0EFED] rounded-[6px] mb-3" />
          <div className="h-9 w-24 bg-[#F0EFED] rounded-[6px] mb-3" />
          <div className="h-2 w-full bg-[#F5F2ED] rounded-full" />
          <div className="h-3 w-20 bg-[#F5F2ED] rounded-[6px] mt-2" />
        </div>
        {/* 잔여 예산 */}
        <div className="bg-white rounded-[6px] p-6 border border-black/[0.04]">
          <div className="h-3 w-14 bg-[#F0EFED] rounded-[6px] mb-3" />
          <div className="h-9 w-24 bg-[#F0EFED] rounded-[6px]" />
        </div>
      </div>

      {/* 사진 촬영·드레스·메이크업 묶음 로딩 상태 */}
      <div className="bg-white rounded-[6px] border border-black/[0.04] overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-black/[0.04] bg-gradient-to-r from-[#C4967E]/5 to-[#C9A96E]/5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex -space-x-1">
                <div className="w-6 h-6 rounded-full bg-[#F0EFED] ring-2 ring-white" />
                <div className="w-6 h-6 rounded-full bg-[#F0EFED] ring-2 ring-white" />
                <div className="w-6 h-6 rounded-full bg-[#F0EFED] ring-2 ring-white" />
              </div>
              <div>
                <div className="h-4 w-24 bg-[#F0EFED] rounded-[6px] mb-1" />
                <div className="h-3 w-32 bg-[#F5F2ED] rounded-[6px]" />
              </div>
            </div>
            <div className="h-4 w-28 bg-[#F0EFED] rounded-[6px]" />
          </div>
        </div>
        <div className="divide-y divide-black/[0.03]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-3.5">
              <div className="w-8 h-8 rounded-[6px] bg-[#F5F2ED]" />
              <div className="h-4 w-20 bg-[#F0EFED] rounded-[6px]" />
              <div className="flex-1 h-2 bg-[#F5F2ED] rounded-full" />
              <div className="h-4 w-16 bg-[#F0EFED] rounded-[6px]" />
              <div className="h-4 w-16 bg-[#F5F2ED] rounded-[6px]" />
            </div>
          ))}
        </div>
      </div>

      {/* 기타 카테고리 skeleton */}
      <div className="bg-white rounded-[6px] border border-black/[0.04] overflow-hidden">
        <div className="px-5 py-4 border-b border-black/[0.04]">
          <div className="h-4 w-24 bg-[#F0EFED] rounded-[6px]" />
        </div>
        <div className="divide-y divide-black/[0.03]">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-3 px-5 py-3.5"
              style={{ animationDelay: `${i * 40}ms` }}
            >
              <div className="w-8 h-8 rounded-[6px] bg-[#F5F2ED]" />
              <div className="h-4 w-20 bg-[#F0EFED] rounded-[6px]" />
              <div className="flex-1 h-2 bg-[#F5F2ED] rounded-full" />
              <div className="h-4 w-16 bg-[#F0EFED] rounded-[6px]" />
              <div className="h-4 w-16 bg-[#F5F2ED] rounded-[6px]" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
