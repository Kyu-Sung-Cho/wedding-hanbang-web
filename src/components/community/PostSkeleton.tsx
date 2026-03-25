export default function PostSkeleton() {
  return (
    <div className="bg-white rounded-lg shadow-sm border border-[#E5E7EB] animate-pulse">
      <div className="flex">
        {/* 왼쪽 투표 스트립 */}
        <div className="flex-shrink-0 w-11 bg-[#FAFAFA] rounded-l-lg flex flex-col items-center py-3 gap-1.5">
          <div className="w-5 h-5 bg-[#E5E7EB] rounded-md" />
          <div className="w-4 h-3 bg-[#E5E7EB] rounded-md" />
          <div className="w-5 h-5 bg-[#E5E7EB] rounded-md" />
        </div>

        {/* 오른쪽 콘텐츠 */}
        <div className="flex-1 min-w-0 p-2.5 sm:p-3">
          {/* 메타 라인 */}
          <div className="flex items-center gap-2 mb-1.5">
            <div className="h-3 w-12 bg-[#E5E7EB] rounded-md" />
            <div className="h-3 w-1 bg-[#E5E7EB] rounded-md" />
            <div className="h-3 w-16 bg-[#E5E7EB] rounded-md" />
            <div className="h-3 w-1 bg-[#E5E7EB] rounded-md" />
            <div className="h-3 w-10 bg-[#E5E7EB] rounded-md" />
          </div>

          {/* 제목 */}
          <div className="h-5 w-3/4 bg-[#E5E7EB] rounded-md" />

          {/* 본문 미리보기 */}
          <div className="mt-2 space-y-1.5">
            <div className="h-3.5 w-full bg-[#E5E7EB] rounded-md" />
            <div className="h-3.5 w-2/3 bg-[#E5E7EB] rounded-md" />
          </div>

          {/* 하단 액션 행 */}
          <div className="mt-2.5 flex items-center gap-3">
            <div className="h-3 w-16 bg-[#E5E7EB] rounded-md" />
            <div className="h-3 w-10 bg-[#E5E7EB] rounded-md" />
            <div className="h-3 w-10 bg-[#E5E7EB] rounded-md" />
            <div className="h-3 w-8 bg-[#E5E7EB] rounded-md" />
          </div>
        </div>
      </div>
    </div>
  );
}
