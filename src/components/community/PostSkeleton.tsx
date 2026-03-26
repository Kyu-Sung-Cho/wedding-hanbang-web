export default function PostSkeleton() {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-[#E5E7EB] animate-pulse">
      <div className="flex">
        {/* 왼쪽 투표 스트립 */}
        <div className="flex-shrink-0 w-11 bg-[#FAFAFA] rounded-l-xl flex flex-col items-center py-3 gap-2">
          <div className="w-5 h-5 bg-[#E5E7EB] rounded-lg" />
          <div className="w-4 h-3 bg-[#E5E7EB] rounded-lg" />
          <div className="w-5 h-5 bg-[#E5E7EB] rounded-lg" />
        </div>

        {/* 오른쪽 콘텐츠 */}
        <div className="flex-1 min-w-0 p-4">
          {/* 메타 라인 (text-sm = 20px line height) */}
          <div className="flex items-center gap-2 mb-2">
            <div className="h-3.5 w-12 bg-[#E5E7EB] rounded-lg" />
            <div className="h-3.5 w-1 bg-[#E5E7EB] rounded-lg" />
            <div className="h-3.5 w-16 bg-[#E5E7EB] rounded-lg" />
            <div className="h-3.5 w-1 bg-[#E5E7EB] rounded-lg" />
            <div className="h-3.5 w-10 bg-[#E5E7EB] rounded-lg" />
          </div>

          {/* 제목 (text-base) */}
          <div className="h-6 w-3/4 bg-[#E5E7EB] rounded-lg" />

          {/* 본문 미리보기 (text-sm) */}
          <div className="mt-2 space-y-2">
            <div className="h-4 w-full bg-[#E5E7EB] rounded-lg" />
            <div className="h-4 w-2/3 bg-[#E5E7EB] rounded-lg" />
          </div>

          {/* 하단 액션 행 (text-sm) */}
          <div className="mt-3 flex items-center gap-3">
            <div className="h-4 w-16 bg-[#E5E7EB] rounded-lg" />
            <div className="h-4 w-10 bg-[#E5E7EB] rounded-lg" />
            <div className="h-4 w-10 bg-[#E5E7EB] rounded-lg" />
            <div className="h-4 w-8 bg-[#E5E7EB] rounded-lg" />
          </div>
        </div>
      </div>
    </div>
  );
}
