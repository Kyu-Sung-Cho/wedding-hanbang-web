"use client";

import Link from "next/link";
import { FileSearch, MessageSquarePlus, PenSquare, SearchCheck } from "lucide-react";

export default function FeedComposer() {
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_0.78fr_auto]">
      <Link
        href="/community/quote-check"
        className="group flex items-center gap-3 rounded-[14px] border border-[#eadfc9] bg-white px-3 py-3 shadow-[0_8px_18px_rgba(8,22,38,0.035)] transition-colors hover:border-[#d8bb86] hover:bg-[#fff8ec]"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[#fbefd6] text-[#9d6f36]">
          <FileSearch className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[#071629]">아모라 견적 체크리스트</div>
          <div className="mt-0.5 truncate text-sm font-medium text-[#7a8290]">
            견적가보다 빠진 항목과 추가금 리스크를 먼저 확인해요
          </div>
        </div>
      </Link>

      <Link
        href="/community?category=is_normal&feed=all#community-feed"
        className="group flex items-center gap-3 rounded-[14px] border border-[#eadfc9] bg-white px-3 py-3 shadow-[0_8px_18px_rgba(8,22,38,0.035)] transition-colors hover:border-[#d8bb86] hover:bg-[#fff8ec]"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-[#f5f7ee] text-[#9d6f36]">
          <SearchCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-[#071629]">이거 정상인가요?</div>
          <div className="mt-0.5 truncate text-sm font-medium text-[#7a8290]">
            업체 답변과 계약 조건을 다른 사람들과 비교해요
          </div>
        </div>
      </Link>

      <Link
        href="/community/post/write?category=is_normal"
        className="group flex items-center justify-center gap-2 rounded-[14px] border border-[#eadfc9] bg-white px-4 py-3 text-sm font-semibold text-[#9d6f36] shadow-[0_8px_18px_rgba(8,22,38,0.035)] transition-colors hover:border-[#d8bb86] hover:bg-[#fff8ec] lg:min-w-[132px]"
      >
        <MessageSquarePlus className="h-4 w-4" />
        같이 묻기
        <PenSquare className="hidden h-4 w-4 sm:block" />
      </Link>
    </div>
  );
}
