"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  FileSearch,
  MessageCircle,
  PenLine,
  Wallet,
} from "lucide-react";

interface BannerConfig {
  eyebrow: string;
  title: string;
  subtext: string;
  href: string;
  icon: "quote" | "chat" | "budget" | "schedule" | "write";
}

const BANNER_OPTIONS: BannerConfig[] = [
  {
    eyebrow: "견적 확인",
    title: "받은 견적에서 빠진 항목이 있는지 먼저 볼까요?",
    subtext: "추가금 가능성과 계약 전 질문을 한 번에 정리합니다.",
    href: "/community/quote-check",
    icon: "quote",
  },
  {
    eyebrow: "상담 정리",
    title: "업체 답변이 애매하면 아모라와 같이 읽어보세요.",
    subtext: "다시 물어볼 문장과 확인할 조건을 정리합니다.",
    href: "/chat",
    icon: "chat",
  },
  {
    eyebrow: "커뮤니티 질문",
    title: "비슷한 조건의 예비부부에게 익명으로 물어볼 수 있어요.",
    subtext: "지역, 예산, 포함 항목을 적으면 비교가 쉬워집니다.",
    href: "/community/post/write?category=is_normal",
    icon: "write",
  },
  {
    eyebrow: "예산 관리",
    title: "확인한 금액을 내 예산표에 바로 반영하세요.",
    subtext: "견적가와 예상 추가금을 한 곳에서 관리합니다.",
    href: "/budget",
    icon: "budget",
  },
  {
    eyebrow: "일정 관리",
    title: "계약 전 확인할 일을 일정으로 넘겨두세요.",
    subtext: "질문, 마감일, 재확인 일정을 놓치지 않게 정리합니다.",
    href: "/schedule",
    icon: "schedule",
  },
];

const ICON_MAP = {
  quote: FileSearch,
  chat: MessageCircle,
  budget: Wallet,
  schedule: CalendarCheck,
  write: PenLine,
};

interface ServiceBannerProps {
  index?: number;
}

export default function ServiceBanner({ index = 0 }: ServiceBannerProps) {
  const banner = useMemo(() => {
    return BANNER_OPTIONS[index % BANNER_OPTIONS.length];
  }, [index]);
  const Icon = ICON_MAP[banner.icon];

  return (
    <Link
      href={banner.href}
      className="group block rounded-lg border border-[#e4ded9] bg-[#f6efe5] px-4 py-4 transition-colors hover:border-[#dfc9c1] hover:bg-white sm:px-5"
    >
      <div className="flex items-start gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#eee6e0] bg-white text-[#36534E] transition-colors group-hover:border-[#dfc9c1]">
          <Icon className="h-5 w-5" />
        </span>

        <div className="min-w-0 flex-1">
          <p className="mb-1 text-[11px] font-medium tracking-[0.18em] text-[#928980]">
            {banner.eyebrow}
          </p>
          <p className="text-[15px] font-medium leading-snug text-[#1A1A1F] transition-colors group-hover:text-[#36534E]">
            {banner.title}
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-[#635b51]">
            {banner.subtext}
          </p>
        </div>

        <ArrowRight className="mt-1 h-5 w-5 shrink-0 text-[#B5ADA3] transition-all group-hover:translate-x-0.5 group-hover:text-[#36534E]" />
      </div>
    </Link>
  );
}
