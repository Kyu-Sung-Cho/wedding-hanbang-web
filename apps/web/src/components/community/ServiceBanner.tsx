"use client";

import { useMemo } from "react";
import Link from "next/link";
import { MessageCircle, Wallet, CalendarCheck, Sparkles } from "lucide-react";

interface BannerConfig {
  text: string;
  subtext: string;
  href: string;
  icon: "chat" | "budget" | "schedule";
}

const BANNER_OPTIONS: BannerConfig[] = [
  {
    text: "결혼 준비 어디서부터?",
    subtext: "AI 아모라가 맞춤 플랜을 만들어드려요",
    href: "/chat",
    icon: "chat",
  },
  {
    text: "예산이 걱정되세요?",
    subtext: "숨은 비용까지 관리하는 예산 도구",
    href: "/budget",
    icon: "budget",
  },
  {
    text: "D-day까지 뭘 해야 하지?",
    subtext: "자동 체크리스트로 하나씩 완료",
    href: "/schedule",
    icon: "schedule",
  },
  {
    text: "견적서가 적정한 가격인지 궁금하세요?",
    subtext: "사진만 보내면 AI가 항목별로 분석해드려요",
    href: "/chat",
    icon: "chat",
  },
  {
    text: "업체 계약 전 꼭 확인하세요",
    subtext: "아모라가 계약서 체크리스트를 만들어드려요",
    href: "/chat",
    icon: "chat",
  },
];

const ICON_MAP = {
  chat: <MessageCircle className="w-5 h-5" />,
  budget: <Wallet className="w-5 h-5" />,
  schedule: <CalendarCheck className="w-5 h-5" />,
};

interface ServiceBannerProps {
  /** 피드에서의 위치 인덱스 (다양한 배너를 위해 사용) */
  index?: number;
}

export default function ServiceBanner({ index = 0 }: ServiceBannerProps) {
  // 인덱스 기반으로 배너 선택 (랜덤 대신 결정적)
  const banner = useMemo(() => {
    return BANNER_OPTIONS[index % BANNER_OPTIONS.length];
  }, [index]);

  return (
    <Link
      href={banner.href}
      className="group block rounded-2xl bg-gradient-to-r from-[#FDFCFA] via-[#FAF8F5] to-[#F8F3EE] border border-[#F0EFED] hover:border-[#C4967E]/30 px-7 py-5 transition-all duration-300 hover:shadow-sm"
    >
      <div className="flex items-center gap-4">
        {/* 아이콘 */}
        <div className="w-11 h-11 rounded-xl bg-white border border-[#F0EFED] flex items-center justify-center shrink-0 text-[#C4967E] group-hover:border-[#C4967E]/30 transition-colors duration-200">
          {ICON_MAP[banner.icon]}
        </div>

        {/* 텍스트 */}
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-medium text-[#1A1A1F] group-hover:text-[#C4967E] transition-colors duration-200">
            {banner.text}
          </p>
          <p className="text-[13px] text-[#B5ADA3] mt-0.5">
            {banner.subtext}
          </p>
        </div>

        {/* 배지 + 화살표 */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#1A1A1F]/5 text-[11px] font-medium text-[#878680]">
            <Sparkles className="w-3 h-3 text-[#C9A96E]" />
            웨딩한방
          </span>
          <svg
            className="w-5 h-5 text-[#B5ADA3] group-hover:text-[#C4967E] group-hover:translate-x-0.5 transition-all duration-200"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
}
