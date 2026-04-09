"use client";

import Link from "next/link";
import { TrendingUp, Sparkles, Tag, Shield } from "lucide-react";

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
  return (
    <aside className="space-y-4">
      {/* 이번 주 요약 */}
      <section className="bg-white border border-[#F0EFED] rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp className="w-5 h-5 text-[#C4967E]" />
          <h3 className="font-serif text-lg font-medium text-[#1A1A1F]">이번 주 요약</h3>
        </div>
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="text-[#878680]">새 글</span>
            <span className="text-[#1A1A1F] font-medium">
              {weekly?.newPostsThisWeek ?? 0}개
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#878680]">가장 많이 언급된 업체</span>
            <span className="text-[#1A1A1F] font-medium truncate max-w-[140px]">
              {weekly?.topVendor ?? "—"}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[#878680]">평균 스튜디오 기본금</span>
            <span className="text-[#1A1A1F] font-medium">
              {weekly?.avgStudioPrice ? `${weekly.avgStudioPrice}만원` : "—"}
            </span>
          </div>
        </div>
      </section>

      {/* 많이 찾는 업체 */}
      {popularTags.length > 0 && (
        <section className="bg-white border border-[#F0EFED] rounded-2xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <Tag className="w-5 h-5 text-[#C4967E]" />
            <h3 className="font-serif text-lg font-medium text-[#1A1A1F]">많이 찾는 업체</h3>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-2">
            {popularTags.slice(0, 12).map((tag) => (
              <Link
                key={tag.vendor_name}
                href={`/community/vendor/${encodeURIComponent(tag.vendor_name)}`}
                className="text-sm text-[#B5ADA3] hover:text-[#C4967E] transition-colors"
              >
                #{tag.vendor_name}
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* 커뮤니티 원칙 */}
      <section className="bg-white border border-[#F0EFED] rounded-2xl p-6">
        <div className="flex items-center gap-2 mb-4">
          <Shield className="w-5 h-5 text-[#C4967E]" />
          <h3 className="font-serif text-lg font-medium text-[#1A1A1F]">커뮤니티 원칙</h3>
        </div>
        <div className="space-y-3 text-sm">
          <div className="flex items-start gap-2.5">
            <span className="w-2 h-2 rounded-full bg-[#22C55E] mt-1.5 shrink-0" />
            <div>
              <span className="text-[#1A1A1F] font-medium">일반</span>
              <span className="text-[#878680]"> — 직접 쓴 글</span>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="w-2 h-2 rounded-full bg-[#EAB308] mt-1.5 shrink-0" />
            <div>
              <span className="text-[#1A1A1F] font-medium">협찬</span>
              <span className="text-[#878680]"> — 혜택 받은 글</span>
            </div>
          </div>
          <div className="flex items-start gap-2.5">
            <span className="w-2 h-2 rounded-full bg-[#EF4444] mt-1.5 shrink-0" />
            <div>
              <span className="text-[#1A1A1F] font-medium">광고</span>
              <span className="text-[#878680]"> — 추천 알고리즘 미반영</span>
            </div>
          </div>
        </div>
        <p className="mt-4 text-xs text-[#B5ADA3] leading-relaxed">
          정직한 표시는 신뢰의 시작입니다. 미표시 신고 시 검토 후 제재됩니다.
        </p>
      </section>

      {/* 웨딩한방 서비스 */}
      <section className="bg-[#1A1A1F] rounded-2xl p-6 text-white">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-5 h-5 text-[#C9A96E]" />
          <h3 className="font-serif text-lg font-medium">웨딩한방 AI</h3>
        </div>
        <p className="text-sm text-white/70 leading-relaxed mb-4">
          가격이 정상인지, 일정은 맞는지, AI 아모라가 답해드려요.
        </p>
        <Link
          href="/chat"
          className="block w-full text-center bg-white text-[#1A1A1F] rounded-xl py-2.5 text-sm font-medium hover:bg-[#FAFAF8] transition-colors"
        >
          아모라와 대화하기
        </Link>
      </section>
    </aside>
  );
}
