"use client";

import Link from "next/link";
import { ArrowRight, MessageCircleQuestion, PenSquare, Sparkles } from "lucide-react";

export default function FeedComposer() {
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-[#e5d8ca] bg-[#fbf8f2] px-4 py-3 shadow-[0_6px_16px_rgba(8,22,38,0.025)] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#eaddd8] text-[#7f5e58]">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#263832]">
            고민이 생겼다면, 아모라에게 먼저 물어보세요.
          </p>
          <p className="mt-0.5 text-xs font-medium text-[#7d7166]">
            견적·계약 질문을 정리한 뒤 글쓰기에서 커뮤니티에 공유할 수 있어요.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href="/chat"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[#e5d8ca] bg-white px-4 text-xs font-semibold text-[#7f5e58] transition-colors hover:border-[#dfc9c1]"
        >
          <MessageCircleQuestion className="h-3.5 w-3.5" />
          아모라
        </Link>
        <Link
          href="/community/post/write"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[#263832] px-4 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(6,26,52,0.14)]"
        >
          글쓰기
          <PenSquare className="h-3.5 w-3.5" />
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
