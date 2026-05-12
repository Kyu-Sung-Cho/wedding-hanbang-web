"use client";

import { Handshake } from "lucide-react";

interface CommunityHeroProps {
  postCount?: number;
  topVendor?: string | null;
}

export default function CommunityHero({ postCount = 0, topVendor }: CommunityHeroProps) {
  const displayCount = postCount > 0 ? `${postCount.toLocaleString("ko-KR")}개 글` : "실시간 글";

  return (
    <section className="rounded-lg border border-[#e4ded9] bg-[#fffdfb] px-4 py-5 sm:px-6 lg:px-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-3 inline-flex max-w-full items-center gap-2 rounded-full border border-[#d9c8c8] bg-white px-3 py-1.5 text-xs font-medium text-[#795252]">
            <Handshake className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">예비부부 커뮤니티</span>
          </div>

          <h1 className="font-serif-kr text-[27px] leading-tight text-[#1b1c1c] sm:text-[34px] lg:text-[40px]">
            견적·후기·질문,
            <br className="hidden sm:block" /> 여기서 같이 확인해요.
          </h1>

          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#504444] sm:text-[15px]">
            받은 견적이 애매할 때, 투어 후기가 궁금할 때, 계약 전에 물어볼 것이 있을 때
            비슷한 상황의 예비부부와 익명으로 나눕니다.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-[#625b4d]">
          <span className="rounded-full border border-[#eee6e0] bg-white px-3 py-1.5">{displayCount}</span>
          {topVendor ? (
            <span className="rounded-full border border-[#eee6e0] bg-white px-3 py-1.5">
              최근 언급 {topVendor}
            </span>
          ) : null}
          <span className="rounded-full border border-[#eee6e0] bg-white px-3 py-1.5">익명 질문</span>
          <span className="rounded-full border border-[#eee6e0] bg-white px-3 py-1.5">실제 후기</span>
        </div>
      </div>
    </section>
  );
}
