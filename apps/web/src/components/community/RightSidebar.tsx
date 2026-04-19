"use client";

import Link from "next/link";
import { Sparkles, Tag, Shield } from "lucide-react";

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
  // 주간 요약 트렌드 계산 (임시 로직 - 실제는 주간 비교 데이터 사용)
  const postCount = weekly?.newPostsThisWeek ?? 0;
  const postTrend = postCount > 50 ? "up" : postCount > 20 ? "steady" : "down";

  return (
    <aside className="space-y-8">
      {/* 이번 주 요약 */}
      <section className="bg-[#FDFCFA] rounded-2xl p-6">
        <h3 className="font-serif-kr text-lg italic text-[#1A1A1F] border-b border-[#F0EFED] pb-2 mb-5">
          이번 주 요약
        </h3>

        <div className="space-y-5">
          {/* 새 글 + 트렌드 바 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[#B5ADA3] tracking-wide uppercase">새 글</span>
              <span className="text-sm font-medium text-[#1A1A1F] tabular-nums">
                {postCount}개
              </span>
            </div>
            <div className="h-1 bg-[#F0EFED] rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  postTrend === "up"
                    ? "bg-[#22C55E] w-4/5"
                    : postTrend === "steady"
                    ? "bg-[#C9A96E] w-1/2"
                    : "bg-[#B5ADA3] w-1/4"
                }`}
              />
            </div>
            <span className={`text-[10px] mt-1 inline-block ${
              postTrend === "up" ? "text-[#22C55E]" : postTrend === "steady" ? "text-[#C9A96E]" : "text-[#B5ADA3]"
            }`}>
              {postTrend === "up" ? "Trending Up" : postTrend === "steady" ? "Steady" : "Trending Down"}
            </span>
          </div>

          {/* 인기 업체 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[#B5ADA3] tracking-wide uppercase">인기 업체</span>
              <span className="text-sm font-medium text-[#1A1A1F] truncate max-w-[140px]">
                {weekly?.topVendor ?? "---"}
              </span>
            </div>
            <div className="h-1 bg-[#F0EFED] rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-[#C4967E] w-3/5 transition-all duration-700" />
            </div>
          </div>

          {/* 평균 스튜디오 기본금 */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[#B5ADA3] tracking-wide uppercase">스튜디오 평균</span>
              <span className="text-sm font-medium text-[#1A1A1F]">
                {weekly?.avgStudioPrice ? `${weekly.avgStudioPrice}만원` : "---"}
              </span>
            </div>
            <div className="h-1 bg-[#F0EFED] rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-[#C9A96E] w-2/5 transition-all duration-700" />
            </div>
          </div>
        </div>
      </section>

      {/* 많이 찾는 업체 */}
      {popularTags.length > 0 && (
        <section className="bg-[#FDFCFA] rounded-2xl p-6">
          <div className="flex items-center gap-2.5 border-b border-[#F0EFED] pb-2 mb-5">
            <Tag className="w-4 h-4 text-[#C4967E]" />
            <h3 className="font-serif-kr text-lg italic text-[#1A1A1F]">많이 찾는 업체</h3>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-2.5">
            {popularTags.slice(0, 12).map((tag) => (
              <Link
                key={tag.vendor_name}
                href={`/community/vendor/${encodeURIComponent(tag.vendor_name)}`}
                className="text-sm text-[#B5ADA3] hover:text-[#C4967E] transition-colors duration-200"
              >
                #{tag.vendor_name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 커뮤니티 원칙 */}
      <section className="bg-[#FDFCFA] rounded-2xl p-6">
        <div className="flex items-center gap-2.5 border-b border-[#F0EFED] pb-2 mb-5">
          <Shield className="w-4 h-4 text-[#C4967E]" />
          <h3 className="font-serif-kr text-lg italic text-[#1A1A1F]">커뮤니티 원칙</h3>
        </div>
        <div className="space-y-4 text-sm">
          <div className="flex items-start gap-3">
            <span className="w-2 h-2 rounded-full bg-[#22C55E] mt-1.5 shrink-0" />
            <div>
              <span className="text-[#1A1A1F] font-medium">일반</span>
              <span className="text-[#878680]"> --- 직접 쓴 글</span>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-2 h-2 rounded-full bg-[#EAB308] mt-1.5 shrink-0" />
            <div>
              <span className="text-[#1A1A1F] font-medium">협찬</span>
              <span className="text-[#878680]"> --- 혜택 받은 글</span>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="w-2 h-2 rounded-full bg-[#EF4444] mt-1.5 shrink-0" />
            <div>
              <span className="text-[#1A1A1F] font-medium">광고</span>
              <span className="text-[#878680]"> --- 추천 알고리즘 미반영</span>
            </div>
          </div>
        </div>
        <p className="mt-5 text-xs text-[#B5ADA3] leading-relaxed">
          정직한 표시는 신뢰의 시작입니다. 미표시 신고 시 검토 후 제재됩니다.
        </p>
      </section>

      {/* 웨딩한방 서비스 */}
      <section className="bg-[#1A1A1F] rounded-2xl p-7 text-white">
        <div className="flex items-center gap-2.5 mb-4">
          <Sparkles className="w-5 h-5 text-[#C9A96E]" />
          <h3 className="font-serif-kr text-lg italic">웨딩한방 AI</h3>
        </div>
        <p className="text-sm text-white/60 leading-relaxed mb-5">
          가격이 정상인지, 일정은 맞는지, AI 아모라가 답해드려요.
        </p>
        <Link
          href="/chat"
          className="block w-full text-center bg-white text-[#1A1A1F] rounded-xl py-3 text-sm font-medium hover:bg-[#FAFAF8] transition-colors"
        >
          아모라와 대화하기
        </Link>
      </section>
    </aside>
  );
}
