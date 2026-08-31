export default function ChatLoading() {
  return (
    <div className="max-w-[800px] mx-auto h-[calc(100vh-144px)] flex flex-col animate-pulse">
      {/* 상단 툴바 skeleton */}
      <div className="flex items-center justify-between px-2 pb-3 pt-1">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-[6px] bg-[#F0EFED]" />
          <div className="h-5 w-28 bg-[#F0EFED] rounded-[6px]" />
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-8 w-16 bg-[#F0EFED] rounded-[6px]" />
        </div>
      </div>

      {/* 채팅 영역 skeleton */}
      <div className="flex-1 overflow-hidden pb-4 space-y-4 px-2">
        {/* AI 메시지 skeleton */}
        <div className="flex gap-3 max-w-[85%]">
          <div className="w-11 h-11 rounded-full bg-[#F0EFED] flex-shrink-0" />
          <div className="space-y-2 flex-1">
            <div className="bg-white rounded-[6px] rounded-tl-sm border border-black/[0.04] p-5 space-y-2.5">
              <div className="h-4 w-full bg-[#F0EFED] rounded-[6px]" />
              <div className="h-4 w-5/6 bg-[#F5F2ED] rounded-[6px]" />
              <div className="h-4 w-3/4 bg-[#F5F2ED] rounded-[6px]" />
            </div>
          </div>
        </div>

        {/* 유저 메시지 skeleton */}
        <div className="flex justify-end">
          <div className="bg-[#1A1A1F]/[0.04] rounded-[6px] rounded-tr-sm p-5 max-w-[75%] space-y-2.5">
            <div className="h-4 w-48 bg-[#E8E6E3] rounded-[6px]" />
            <div className="h-4 w-32 bg-[#E8E6E3] rounded-[6px]" />
          </div>
        </div>

        {/* AI 메시지 skeleton */}
        <div className="flex gap-3 max-w-[85%]">
          <div className="w-11 h-11 rounded-full bg-[#F0EFED] flex-shrink-0" />
          <div className="space-y-2 flex-1">
            <div className="bg-white rounded-[6px] rounded-tl-sm border border-black/[0.04] p-5 space-y-2.5">
              <div className="h-4 w-full bg-[#F0EFED] rounded-[6px]" />
              <div className="h-4 w-4/5 bg-[#F5F2ED] rounded-[6px]" />
            </div>
          </div>
        </div>
      </div>

      {/* 입력창 skeleton */}
      <div className="px-2 pb-2">
        {/* 대상 토글 skeleton */}
        <div className="flex items-center gap-2 mb-2.5 px-1">
          <div className="h-9 w-28 bg-[#E8E6E3] rounded-full" />
          <div className="h-9 w-28 bg-[#F0EFED] rounded-full" />
        </div>
        <div className="bg-white rounded-[6px] border border-black/[0.06] shadow-[var(--shadow-raised)] flex items-center gap-2 p-2.5">
          <div className="w-12 h-12 rounded-[6px] bg-[#F5F2ED]" />
          <div className="flex-1 h-6 bg-[#F5F2ED] rounded-[6px]" />
          <div className="w-12 h-12 rounded-[6px] bg-[#E8E6E3]" />
        </div>
      </div>
    </div>
  );
}
