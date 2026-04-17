"use client";

import Link from "next/link";
import { MessageCircle, Wallet, CalendarCheck, HelpCircle, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import type { CommunityCategory } from "@/types/community.types";

interface ServiceCTAProps {
  category: CommunityCategory;
}

interface CTAConfig {
  icon: ReactNode;
  text: string;
  subtext: string;
  href: string;
}

const CTA_MAP: Record<string, CTAConfig> = {
  is_normal: {
    icon: <Sparkles className="w-5 h-5 text-[#C4967E]" />,
    text: "이 가격, 정상인지 AI가 분석해드려요",
    subtext: "견적서 사진만 보내면 항목별 분석 완료",
    href: "/chat",
  },
  tour_review: {
    icon: <MessageCircle className="w-5 h-5 text-[#C4967E]" />,
    text: "내 예산에 맞는 업체 찾기",
    subtext: "아모라가 맞춤 추천해드려요",
    href: "/chat",
  },
  tips_v2: {
    icon: <Sparkles className="w-5 h-5 text-[#C9A96E]" />,
    text: "AI 웨딩 플래너와 상담",
    subtext: "24시간 무료 상담",
    href: "/chat",
  },
  ama: {
    icon: <HelpCircle className="w-5 h-5 text-[#C4967E]" />,
    text: "아모라에게 질문하기",
    subtext: "궁금한 건 바로 답변받기",
    href: "/chat",
  },
  free: {
    icon: <MessageCircle className="w-5 h-5 text-[#C4967E]" />,
    text: "고민이 있으세요? 아모라와 이야기해보세요",
    subtext: "중립적이고 편안한 상담",
    href: "/chat",
  },
};

// 비용 관련 카테고리에는 예산 도구 CTA 추가
const BUDGET_CATEGORIES = new Set(["is_normal"]);
// 일정 관련 CTA
const SCHEDULE_CATEGORIES = new Set(["tips_v2", "ama"]);

export default function ServiceCTA({ category }: ServiceCTAProps) {
  const mainCta = CTA_MAP[category] ?? CTA_MAP.free;

  // 보조 CTA (예산 또는 일정)
  let secondaryCta: CTAConfig | null = null;
  if (BUDGET_CATEGORIES.has(category)) {
    secondaryCta = {
      icon: <Wallet className="w-5 h-5 text-[#C9A96E]" />,
      text: "내 예산 진단받기",
      subtext: "항목별 적정 가격 체크",
      href: "/budget",
    };
  } else if (SCHEDULE_CATEGORIES.has(category)) {
    secondaryCta = {
      icon: <CalendarCheck className="w-5 h-5 text-[#C9A96E]" />,
      text: "D-day까지 자동 체크리스트",
      subtext: "놓치기 쉬운 일정도 관리",
      href: "/schedule",
    };
  }

  return (
    <div className="rounded-2xl border border-[#F0EFED] bg-gradient-to-r from-[#FDFCFA] to-[#FAF8F5] p-[1px]">
      <div className="rounded-2xl bg-gradient-to-r from-[#FDFCFA] to-[#FAF8F5] px-5 py-4">
        {/* 메인 CTA */}
        <Link
          href={mainCta.href}
          className="flex items-center gap-4 group"
        >
          <div className="w-10 h-10 rounded-xl bg-white border border-[#F0EFED] flex items-center justify-center shrink-0 group-hover:border-[#C4967E]/30 transition-colors duration-200">
            {mainCta.icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[15px] font-medium text-[#1A1A1F] group-hover:text-[#C4967E] transition-colors duration-200">
              {mainCta.text}
            </p>
            <p className="text-[13px] text-[#B5ADA3] mt-0.5">
              {mainCta.subtext}
            </p>
          </div>
          <svg
            className="w-5 h-5 text-[#B5ADA3] group-hover:text-[#C4967E] group-hover:translate-x-0.5 transition-all duration-200 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </Link>

        {/* 보조 CTA */}
        {secondaryCta && (
          <>
            <div className="my-3 border-t border-[#F0EFED]" />
            <Link
              href={secondaryCta.href}
              className="flex items-center gap-4 group"
            >
              <div className="w-10 h-10 rounded-xl bg-white border border-[#F0EFED] flex items-center justify-center shrink-0 group-hover:border-[#C9A96E]/30 transition-colors duration-200">
                {secondaryCta.icon}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium text-[#1A1A1F] group-hover:text-[#C9A96E] transition-colors duration-200">
                  {secondaryCta.text}
                </p>
                <p className="text-[13px] text-[#B5ADA3] mt-0.5">
                  {secondaryCta.subtext}
                </p>
              </div>
              <svg
                className="w-5 h-5 text-[#B5ADA3] group-hover:text-[#C9A96E] group-hover:translate-x-0.5 transition-all duration-200 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
