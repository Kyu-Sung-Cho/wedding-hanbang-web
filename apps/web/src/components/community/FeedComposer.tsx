"use client";

import Link from "next/link";
import { FileSearch, MessageSquarePlus, PenSquare } from "lucide-react";

export default function FeedComposer() {
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
      <Link
        href="/community/quote-check"
        className="group flex items-center gap-3 rounded-xl border border-[#d9c8c8] bg-white px-3 py-3 shadow-[0_1px_0_rgba(0,0,0,0.02)] transition-colors hover:border-[#c6abab] hover:bg-[#fffdfb]"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#795252]/10 text-[#795252]">
          <FileSearch className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[#1b1c1c]">아모라 견적진단</div>
          <div className="mt-0.5 truncate text-sm text-[#928980]">
            견적가보다 빠진 항목과 추가금 리스크를 먼저 확인해요
          </div>
        </div>
      </Link>

      <Link
        href="/community/post/write?category=is_normal"
        className="group flex items-center justify-center gap-2 rounded-xl border border-[#e4e2e1] bg-white px-4 py-3 text-sm font-medium text-[#795252] transition-colors hover:border-[#d4c2c2] hover:bg-[#fffdfb] sm:min-w-[132px]"
      >
        <MessageSquarePlus className="h-4 w-4" />
        같이 묻기
        <PenSquare className="hidden h-4 w-4 sm:block" />
      </Link>
    </div>
  );
}
