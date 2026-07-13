"use client";

import { useEffect, useState } from "react";
import { Handshake } from "lucide-react";
import { createBrowserClient } from "@supabase/ssr";

interface CommunityHeroProps {
  postCount?: number;
  topVendor?: string | null;
}

export default function CommunityHero({ postCount = 0, topVendor }: CommunityHeroProps) {
  const displayCount = postCount > 0 ? `${postCount.toLocaleString("ko-KR")}개 글` : "새 글 기다리는 중";

  // 로그인 유저에겐 hero 숨김 — 이미 커뮤니티를 이해한 재방문자라 매번 안내 노출이 불필요.
  // 비로그인엔 그대로 노출하여 온보딩 컨텍스트 제공.
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  useEffect(() => {
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setIsLoggedIn(true);
    });
  }, []);

  if (isLoggedIn) return null;

  return (
    <section className="rounded-lg border border-[#e4ded9] bg-[#f6efe5] px-4 py-5 sm:px-6 lg:px-7">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-3 inline-flex max-w-full items-center gap-2 rounded-full border border-[#dfc9c1] bg-white px-3 py-1.5 text-xs font-medium text-[#36534E]">
            <Handshake className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">예비부부 커뮤니티</span>
          </div>

          <h1 className="font-serif-kr text-[27px] leading-tight text-[#263832] sm:text-[34px] lg:text-[40px]">
            견적·후기·질문,
            <br className="hidden sm:block" /> 여기서 같이 확인해요.
          </h1>

          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#635b51] sm:text-[0.9375rem]">
            받은 견적이 애매할 때, 투어 후기가 궁금할 때, 계약 전에 물어볼 것이 있을 때
            비슷한 상황의 예비부부와 커뮤니티 닉네임으로 나눕니다.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-xs text-[#635b51]">
          <span className="rounded-full border border-[#eee6e0] bg-white px-3 py-1.5">{displayCount}</span>
          {topVendor ? (
            <span className="rounded-full border border-[#eee6e0] bg-white px-3 py-1.5">
              최근 언급 {topVendor}
            </span>
          ) : null}
          <span className="rounded-full border border-[#eee6e0] bg-white px-3 py-1.5">닉네임 공개</span>
          <span className="rounded-full border border-[#eee6e0] bg-white px-3 py-1.5">이용자 작성 후기</span>
        </div>
      </div>
    </section>
  );
}
