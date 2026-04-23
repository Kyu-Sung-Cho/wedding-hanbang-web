"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";

interface PopularTag {
  vendor_name: string;
  mention_count: number;
}

interface WeeklySummary {
  newPostsThisWeek?: number;
  topVendor?: string | null;
  avgStudioPrice?: number | null;
}

interface RightSidebarProps {
  popularTags?: PopularTag[];
  weekly?: WeeklySummary;
}

export default function RightSidebar({ popularTags = [], weekly }: RightSidebarProps) {
  // 주간 요약 트렌드 계산
  const postCount = weekly?.newPostsThisWeek ?? 0;
  const postTrend = postCount > 50 ? "up" : postCount > 20 ? "steady" : "down";
  const postTrendLabel =
    postTrend === "up" ? "Trending Up" : postTrend === "steady" ? "Steady" : "Trending Down";
  const postTrendWidth = postTrend === "up" ? "75%" : postTrend === "steady" ? "50%" : "25%";

  return (
    <>
      {/* Pulse Section — 이번 주 요약 */}
      <div className="mb-10">
        <h3 className="font-serif-kr text-[28px] text-[#1b1c1c] mb-6 border-b border-[#e4e2e1] pb-2">
          이번 주 요약
        </h3>
        <div className="space-y-5">
          {/* 새 글 + 트렌드 바 */}
          <div>
            <div className="flex justify-between text-[17px] mb-2 text-[#504444]">
              <span>새 글</span>
              <span className="text-sage-500 font-medium">{postTrendLabel}</span>
            </div>
            <div className="w-full bg-[#f0eded] h-2 rounded-full overflow-hidden">
              <div
                className="bg-sage-500 h-full rounded-full transition-all duration-700"
                style={{ width: postTrendWidth }}
              />
            </div>
          </div>

          {/* 인기 업체 */}
          <div>
            <div className="flex justify-between text-[17px] mb-2 text-[#504444]">
              <span>인기 업체</span>
              <span className="text-[#795252] font-medium truncate max-w-[140px]">
                {weekly?.topVendor ?? "---"}
              </span>
            </div>
            <div className="w-full bg-[#f0eded] h-2 rounded-full overflow-hidden">
              <div
                className="bg-[#795252] h-full rounded-full transition-all duration-700"
                style={{ width: "60%" }}
              />
            </div>
          </div>

          {/* 평균 스튜디오 기본금 */}
          <div>
            <div className="flex justify-between text-[17px] mb-2 text-[#504444]">
              <span>스튜디오 평균</span>
              <span className="text-[#625b4d] font-medium">
                {weekly?.avgStudioPrice ? `${weekly.avgStudioPrice}만원` : "---"}
              </span>
            </div>
            <div className="w-full bg-[#f0eded] h-2 rounded-full overflow-hidden">
              <div
                className="bg-[#625b4d] h-full rounded-full transition-all duration-700"
                style={{ width: "40%" }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* 많이 찾는 업체 */}
      {popularTags.length > 0 && (
        <div className="mb-10">
          <h3 className="font-serif-kr text-[28px] text-[#1b1c1c] mb-4 border-b border-[#e4e2e1] pb-2">
            많이 찾는 업체
          </h3>
          <div className="flex flex-wrap gap-x-3 gap-y-2.5">
            {popularTags.slice(0, 12).map((tag) => (
              <Link
                key={tag.vendor_name}
                href={`/community/vendor/${encodeURIComponent(tag.vendor_name)}`}
                className="text-sm text-[#504444] hover:text-[#795252] transition-colors duration-200"
              >
                #{tag.vendor_name}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Hot Topics — 커뮤니티 원칙 */}
      <div className="mb-10">
        <h3 className="font-serif-kr text-[28px] text-[#1b1c1c] mb-4 border-b border-[#e4e2e1] pb-2">
          커뮤니티 원칙
        </h3>
        <div className="space-y-4 text-base">
          <div className="flex items-start gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-sage-500 mt-1.5 shrink-0" />
            <div>
              <span className="text-[#1b1c1c] font-medium">일반</span>
              <span className="text-[#504444]"> --- 직접 쓴 글</span>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-[#625b4d] mt-1.5 shrink-0" />
            <div>
              <span className="text-[#1b1c1c] font-medium">협찬</span>
              <span className="text-[#504444]"> --- 혜택 받은 글</span>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-2.5 h-2.5 rounded-full bg-[#795252] mt-1.5 shrink-0" />
            <div>
              <span className="text-[#1b1c1c] font-medium">광고</span>
              <span className="text-[#504444]"> --- 추천 알고리즘 미반영</span>
            </div>
          </div>
        </div>
        <p className="mt-5 text-xs text-[#504444] leading-relaxed">
          정직한 표시는 신뢰의 시작입니다. 미표시 신고 시 검토 후 제재됩니다.
        </p>
      </div>

      {/* 웨딩한방 AI CTA */}
      <div className="bg-gradient-to-br from-[#795252] to-[#946a6a] rounded-xl p-8 text-white">
        <div className="flex items-center gap-2.5 mb-4">
          <Sparkles className="w-5 h-5 text-[#dee6c4]" />
          <h3 className="font-serif-kr text-xl italic">웨딩한방 AI</h3>
        </div>
        <p className="text-base text-white/70 leading-relaxed mb-5">
          가격이 정상인지, 일정은 맞는지, AI 아모라가 답해드려요.
        </p>
        <Link
          href="/chat"
          className="block w-full text-center bg-white text-[#795252] rounded-xl py-3.5 text-base font-medium shadow-[0_4px_14px_0_rgba(0,0,0,0.1)] hover:shadow-[0_6px_20px_rgba(0,0,0,0.15)] transition-all duration-200"
        >
          아모라와 대화하기
        </Link>
      </div>
    </>
  );
}
