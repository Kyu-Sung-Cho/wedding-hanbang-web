"use client";

import Link from "next/link";
import { MessageSquarePlus, PenSquare } from "lucide-react";

export default function FeedComposer() {
  return (
    <Link
      href="/community/post/write"
      className="group flex items-center gap-3 rounded-xl border border-[#e4e2e1] bg-white px-3 py-3 shadow-[0_1px_0_rgba(0,0,0,0.02)] transition-colors hover:border-[#d4c2c2] hover:bg-[#fffdfb]"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f6f3f2] text-[#795252]">
        <MessageSquarePlus className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1 rounded-full bg-[#f6f3f2] px-4 py-2 text-sm text-[#928980] transition-colors group-hover:bg-[#f0eded]">
        웨딩 고민, 견적, 일정 이야기를 공유해보세요
      </div>
      <div className="hidden shrink-0 items-center gap-1.5 rounded-full bg-[#795252] px-3 py-2 text-sm font-medium text-white sm:flex">
        <PenSquare className="h-4 w-4" />
        글쓰기
      </div>
    </Link>
  );
}
