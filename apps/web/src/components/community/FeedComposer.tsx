"use client";

import Link from "next/link";
import { FileSearch, MessageSquarePlus, PenSquare, SearchCheck } from "lucide-react";

export default function FeedComposer() {
  return (
    <div className="grid gap-3 lg:grid-cols-[1fr_0.78fr_auto]">
      <Link
        href="/community/quote-check"
        className="group flex items-center gap-3 rounded-lg border border-[#d9c8c8] bg-white px-3 py-3 shadow-[0_1px_0_rgba(0,0,0,0.02)] transition-colors hover:border-[#c6abab] hover:bg-[#fffdfb]"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#795252]/10 text-[#795252]">
          <FileSearch className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[#1b1c1c]">아모라 견적 체크리스트</div>
          <div className="mt-0.5 truncate text-sm text-[#928980]">
            견적가보다 빠진 항목과 추가금 리스크를 먼저 확인해요
          </div>
        </div>
      </Link>

      <Link
        href="/community/is_normal"
        className="group flex items-center gap-3 rounded-lg border border-[#e2dfd8] bg-white px-3 py-3 shadow-[0_1px_0_rgba(0,0,0,0.02)] transition-colors hover:border-[#c8d0b5] hover:bg-[#fbfcf8]"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#dee6c4]/35 text-[#5a6147]">
          <SearchCheck className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[#1b1c1c]">이거 정상인가요?</div>
          <div className="mt-0.5 truncate text-sm text-[#928980]">
            업체 답변과 계약 조건을 다른 사람들과 비교해요
          </div>
        </div>
      </Link>

      <Link
        href="/community/post/write?category=is_normal"
        className="group flex items-center justify-center gap-2 rounded-lg border border-[#e4e2e1] bg-white px-4 py-3 text-sm font-medium text-[#795252] transition-colors hover:border-[#d4c2c2] hover:bg-[#fffdfb] lg:min-w-[132px]"
      >
        <MessageSquarePlus className="h-4 w-4" />
        같이 묻기
        <PenSquare className="hidden h-4 w-4 sm:block" />
      </Link>
    </div>
  );
}
