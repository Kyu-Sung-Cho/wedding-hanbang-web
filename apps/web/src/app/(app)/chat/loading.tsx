export default function ChatLoading() {
  return (
    <div className="max-w-[800px] mx-auto h-[calc(100vh-144px)] flex flex-col animate-pulse">
      {/* 상단 툴바 skeleton */}
      <div className="flex items-center justify-between px-2 pb-2 pt-1">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded bg-[#F0EFED]" />
          <div className="h-4 w-20 bg-[#F0EFED] rounded" />
        </div>
        <div className="flex items-center gap-1">
          <div className="h-6 w-12 bg-[#F0EFED] rounded-lg" />
        </div>
      </div>

      {/* 채팅 영역 skeleton */}
      <div className="flex-1 overflow-hidden pb-4 space-y-4 px-2">
        {/* AI 메시지 skeleton */}
        <div className="flex gap-2.5 max-w-[80%]">
          <div className="w-8 h-8 rounded-full bg-[#F0EFED] flex-shrink-0" />
          <div className="space-y-2 flex-1">
            <div className="bg-white rounded-2xl rounded-tl-sm border border-black/[0.04] p-4 space-y-2">
              <div className="h-3 w-full bg-[#F0EFED] rounded" />
              <div className="h-3 w-5/6 bg-[#F5F2ED] rounded" />
              <div className="h-3 w-3/4 bg-[#F5F2ED] rounded" />
            </div>
          </div>
        </div>

        {/* 유저 메시지 skeleton */}
        <div className="flex justify-end">
          <div className="bg-[#1A1A1F]/[0.04] rounded-2xl rounded-tr-sm p-4 max-w-[70%] space-y-2">
            <div className="h-3 w-40 bg-[#E8E6E3] rounded" />
            <div className="h-3 w-28 bg-[#E8E6E3] rounded" />
          </div>
        </div>

        {/* AI 메시지 skeleton */}
        <div className="flex gap-2.5 max-w-[80%]">
          <div className="w-8 h-8 rounded-full bg-[#F0EFED] flex-shrink-0" />
          <div className="space-y-2 flex-1">
            <div className="bg-white rounded-2xl rounded-tl-sm border border-black/[0.04] p-4 space-y-2">
              <div className="h-3 w-full bg-[#F0EFED] rounded" />
              <div className="h-3 w-4/5 bg-[#F5F2ED] rounded" />
            </div>
          </div>
        </div>
      </div>

      {/* 입력창 skeleton */}
      <div className="px-2 pb-2">
        {/* 대상 토글 skeleton */}
        <div className="flex items-center gap-1.5 mb-1.5 px-1">
          <div className="h-7 w-24 bg-[#E8E6E3] rounded-full" />
          <div className="h-7 w-24 bg-[#F0EFED] rounded-full" />
        </div>
        <div className="bg-white rounded-2xl border border-black/[0.06] shadow-[0_4px_20px_rgba(0,0,0,0.04)] flex items-center gap-2 p-2">
          <div className="w-11 h-11 rounded-xl bg-[#F5F2ED]" />
          <div className="flex-1 h-5 bg-[#F5F2ED] rounded" />
          <div className="w-11 h-11 rounded-xl bg-[#E8E6E3]" />
        </div>
      </div>
    </div>
  );
}
