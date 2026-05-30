"use client";

import Link from "next/link";
import { ArrowRight, PenSquare } from "lucide-react";

export default function FeedComposer() {
  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-[#e5d8ca] bg-[#fbf8f2] px-4 py-3 shadow-[0_6px_16px_rgba(8,22,38,0.025)] sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#EEF4F1] text-[#36534E]">
          <PenSquare className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-[#263832]">
            짧은 질문은 커뮤니티에 바로 남겨보세요.
          </p>
          <p className="mt-0.5 text-xs font-medium text-[#7d7166]">
            다른 예비부부와 함께 보고 싶은 고민은 질문 글로 공유할 수 있어요.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Link
          href="/community/post/write"
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[#36534E] px-4 text-xs font-semibold text-white shadow-[0_8px_18px_rgba(6,26,52,0.14)]"
        >
          질문 글쓰기
          <PenSquare className="h-3.5 w-3.5" />
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
