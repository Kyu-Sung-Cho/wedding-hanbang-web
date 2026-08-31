export default function PostSkeleton() {
  return (
    <div className="bg-white rounded-[6px] border border-[#F0EFED] animate-pulse">
      <div className="p-4">
        {/* 메타 라인 */}
        <div className="flex items-center gap-2 mb-2">
          <div className="w-6 h-6 bg-[#F0EFED] rounded-full" />
          <div className="h-3.5 w-16 bg-[#F0EFED] rounded-[6px]" />
          <div className="h-3.5 w-10 bg-[#F0EFED] rounded-[6px]" />
        </div>

        {/* 제목 */}
        <div className="h-5 w-3/4 bg-[#F0EFED] rounded-[6px]" />

        {/* 본문 미리보기 */}
        <div className="mt-2 space-y-2">
          <div className="h-4 w-full bg-[#F0EFED] rounded-[6px]" />
          <div className="h-4 w-2/3 bg-[#F0EFED] rounded-[6px]" />
        </div>

        {/* 하단 액션 행 */}
        <div className="mt-3 flex items-center gap-3">
          <div className="h-4 w-12 bg-[#F0EFED] rounded-[6px]" />
          <div className="h-4 w-10 bg-[#F0EFED] rounded-[6px]" />
          <div className="h-4 w-10 bg-[#F0EFED] rounded-[6px]" />
        </div>
      </div>
    </div>
  );
}
