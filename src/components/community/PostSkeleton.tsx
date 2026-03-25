export default function PostSkeleton() {
  return (
    <div className="bg-white border border-[#F5F2ED] rounded-2xl p-4 sm:p-5 animate-pulse">
      <div className="flex gap-4">
        <div className="flex-1 min-w-0">
          {/* 카테고리 배지 */}
          <div className="flex items-center gap-2 mb-2">
            <div className="h-5 w-14 bg-[#F5F2ED] rounded-md" />
          </div>

          {/* 제목 */}
          <div className="h-5 w-3/4 bg-[#F5F2ED] rounded" />

          {/* 본문 미리보기 */}
          <div className="mt-2 space-y-1.5">
            <div className="h-4 w-full bg-[#F5F2ED] rounded" />
            <div className="h-4 w-2/3 bg-[#F5F2ED] rounded" />
          </div>

          {/* 작성자 + 시간 */}
          <div className="mt-3 flex items-center gap-2">
            <div className="h-3 w-16 bg-[#F5F2ED] rounded" />
            <div className="h-3 w-12 bg-[#F5F2ED] rounded" />
          </div>

          {/* 통계 */}
          <div className="mt-2 flex items-center gap-4">
            <div className="h-3 w-8 bg-[#F5F2ED] rounded" />
            <div className="h-3 w-8 bg-[#F5F2ED] rounded" />
            <div className="h-3 w-8 bg-[#F5F2ED] rounded" />
          </div>
        </div>

        {/* 썸네일 자리 */}
        <div className="shrink-0 w-20 h-20 sm:w-24 sm:h-24 bg-[#F5F2ED] rounded-xl" />
      </div>
    </div>
  );
}
