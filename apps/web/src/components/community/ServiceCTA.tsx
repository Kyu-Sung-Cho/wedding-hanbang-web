"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  HelpCircle,
  MessageCircle,
  Wallet,
} from "lucide-react";
import type { ComponentType } from "react";
import type { CommunityCategory } from "@/types/community.types";

interface ServiceCTAProps {
  category: CommunityCategory;
}

interface CTAConfig {
  icon: ComponentType<{ className?: string }>;
  label: string;
  title: string;
  subtext: string;
  href: string;
}

const CTA_MAP: Record<string, CTAConfig> = {
  is_normal: {
    icon: MessageCircle,
    label: "질문 정리",
    title: "이 견적에서 더 물어볼 내용을 먼저 정리해볼까요?",
    subtext: "조건과 맥락을 정리해 업체에 다시 확인할 질문을 다듬습니다.",
    href: "/chat",
  },
  tour_review: {
    icon: MessageCircle,
    label: "후기 다음 단계",
    title: "후기 기준으로 내 조건에 맞는 후보를 좁혀보세요.",
    subtext: "예산, 지역, 스타일을 기준으로 아모라와 비교할 수 있어요.",
    href: "/chat",
  },
  tips_v2: {
    icon: CalendarCheck,
    label: "준비 흐름",
    title: "이 팁을 내 일정에 맞게 다시 정리해보세요.",
    subtext: "해야 할 일과 확인 시점을 놓치지 않게 이어갑니다.",
    href: "/schedule",
  },
  ama: {
    icon: HelpCircle,
    label: "질문 정리",
    title: "더 물어볼 내용은 아모라와 먼저 정리해보세요.",
    subtext: "상황을 정리하고 커뮤니티에 올릴 질문까지 다듬을 수 있어요.",
    href: "/chat",
  },
  free: {
    icon: MessageCircle,
    label: "상담",
    title: "이 이야기를 아모라와 짧게 정리해볼까요?",
    subtext: "필요한 경우에만 상담으로 이어가요.",
    href: "/chat",
  },
};

const BUDGET_CATEGORIES = new Set(["is_normal"]);
const SCHEDULE_CATEGORIES = new Set(["tips_v2", "ama"]);

export default function ServiceCTA({ category }: ServiceCTAProps) {
  const mainCta = CTA_MAP[category] ?? CTA_MAP.free;
  const MainIcon = mainCta.icon;

  let secondaryCta: CTAConfig | null = null;
  if (BUDGET_CATEGORIES.has(category)) {
    secondaryCta = {
      icon: Wallet,
      label: "예산",
      title: "확인한 금액을 예산에 반영하기",
      subtext: "견적가와 예상 추가금을 한 곳에서 관리합니다.",
      href: "/budget",
    };
  } else if (SCHEDULE_CATEGORIES.has(category)) {
    secondaryCta = {
      icon: CalendarCheck,
      label: "일정",
      title: "다음 확인일을 일정으로 넘기기",
      subtext: "계약 전 질문과 마감일을 놓치지 않게 정리합니다.",
      href: "/schedule",
    };
  }

  return (
    <div className="rounded-lg border border-[#e4ded9] bg-[#fff8ec] px-3 py-3 sm:px-4">
      <p className="mb-2 text-[10px] font-medium tracking-[0.18em] text-[#928980]">
        다음 행동
      </p>

      <ServiceAction
        href={mainCta.href}
        icon={MainIcon}
        label={mainCta.label}
        title={mainCta.title}
        subtext={mainCta.subtext}
      />

      {secondaryCta ? (
        <>
          <div className="my-2 border-t border-[#eee6e0]" />
          <ServiceAction
            href={secondaryCta.href}
            icon={secondaryCta.icon}
            label={secondaryCta.label}
            title={secondaryCta.title}
            subtext={secondaryCta.subtext}
          />
        </>
      ) : null}
    </div>
  );
}

function ServiceAction({
  href,
  icon: Icon,
  label,
  title,
  subtext,
}: CTAConfig) {
  return (
    <Link href={href} className="group flex items-start gap-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#eee6e0] bg-white text-[#9d6f36] transition-colors group-hover:border-[#d8bb86]">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="mb-0.5 block text-[10px] font-medium text-[#928980]">{label}</span>
        <span className="block text-[13px] font-medium leading-snug text-[#1A1A1F] transition-colors group-hover:text-[#9d6f36]">
          {title}
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug text-[#5d6879]">
          {subtext}
        </span>
      </span>
      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[#B5ADA3] transition-all group-hover:translate-x-0.5 group-hover:text-[#9d6f36]" />
    </Link>
  );
}
