"use client";

import Link from "next/link";
import {
  ArrowRight,
  CalendarCheck,
  FileSearch,
  HelpCircle,
  MessageCircle,
  Wallet,
} from "lucide-react";
import type { ComponentType } from "react";
import { weddingPath } from "@/lib/weddingPaths";
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
    icon: FileSearch,
    label: "상황 확인",
    title: "이 글에서 확인할 질문을 아모라와 정리해볼까요?",
    subtext: "게시글은 이용자 작성 정보이며 검증된 사실이나 추천이 아니에요.",
    href: "/chat",
  },
  tour_review: {
    icon: MessageCircle,
    label: "후기 다음 단계",
    title: "후기에서 업체에 다시 확인할 질문을 정리하세요.",
    subtext: "후기는 이용자 작성 정보예요. 최신 조건은 업체 공식 문서로 다시 확인해야 해요.",
    href: "/chat",
  },
  tips_v2: {
    icon: CalendarCheck,
    label: "준비 흐름",
    title: "이 팁에서 필요한 항목만 직접 일정에 옮겨보세요.",
    subtext: "게시글의 시점과 조건을 확인한 뒤, 직접 정한 날짜만 기록합니다.",
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
    label: "질문 정리",
    title: "이 이야기를 아모라와 짧게 정리해볼까요?",
    subtext: "필요한 내용만 직접 붙여 넣고 답변을 참고하세요.",
    href: "/chat",
  },
};

const BUDGET_CATEGORIES = new Set(["is_normal"]);
const SCHEDULE_CATEGORIES = new Set(["tips_v2", "ama"]);
const AMORA_CONTEXT_NOTICE =
  "아모라는 현재 글을 자동으로 읽지 않아요. 필요한 문장을 직접 붙여 넣어 주세요.";

// 커뮤니티 본문·제목·가격은 URL query에 복사하지 않는다. URL은 브라우저 기록,
// 접근 로그와 referrer에 남을 수 있으므로 검증되지 않은 UGC와 회원 공개 글을
// 자동 전달하는 대신, 안전한 일반 질문만 채운다.
function buildChatHref() {
  const prompt = [
    "커뮤니티 글을 보며 생긴 궁금증을 정리하고 싶어.",
    "현재 커뮤니티 글은 자동으로 전달되지 않았어. 내가 필요한 내용을 붙여 넣을 때까지 원문을 봤다고 가정하지 마.",
    "게시글은 이용자 작성 정보이며 검증된 사실이나 추천이 아니라고 보고, 내 상황과 같다고 가정하지 마.",
    "가격 적정성이나 계약 안전성을 판정하지 말고, 내가 업체 문서로 다시 확인할 질문부터 물어봐 줘.",
  ]
    .join("\n");
  return weddingPath(`/chat?prefill=${encodeURIComponent(prompt)}`);
}

export default function ServiceCTA({ category }: ServiceCTAProps) {
  const mainCta = CTA_MAP[category] ?? CTA_MAP.free;
  const MainIcon = mainCta.icon;
  const mainHref =
    mainCta.href === "/chat"
      ? buildChatHref()
      : weddingPath(mainCta.href);

  let secondaryCta: CTAConfig | null = null;
  if (BUDGET_CATEGORIES.has(category)) {
    secondaryCta = {
      icon: Wallet,
      label: "예산",
      title: "직접 정한 금액을 예산에 기록하기",
      subtext: "계획 금액·서명한 계약 총액·실제 납부액을 구분해 기록합니다.",
      href: "/budget",
    };
  } else if (SCHEDULE_CATEGORIES.has(category)) {
    secondaryCta = {
      icon: CalendarCheck,
      label: "일정",
      title: "다음 확인일을 일정으로 넘기기",
      subtext: "업체와 직접 확인해 정한 날짜만 일정에 기록합니다.",
      href: "/schedule",
    };
  }

  return (
    <div className="rounded-lg border border-[#e4ded9] bg-[#f6efe5] px-3 py-3 sm:px-4">
      <p className="mb-2 text-[10px] font-medium tracking-[0.18em] text-[#928980]">
        다음 행동
      </p>

      <ServiceAction
        href={mainHref}
        icon={MainIcon}
        label={mainCta.label}
        title={mainCta.title}
        subtext={
          mainCta.href === "/chat"
            ? `${mainCta.subtext} ${AMORA_CONTEXT_NOTICE}`
            : mainCta.subtext
        }
      />

      {secondaryCta ? (
        <>
          <div className="my-2 border-t border-[#eee6e0]" />
          <ServiceAction
            href={weddingPath(secondaryCta.href)}
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
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[#eee6e0] bg-white text-[#36534E] transition-colors group-hover:border-[#dfc9c1]">
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="mb-0.5 block text-[10px] font-medium text-[#928980]">{label}</span>
        <span className="block text-[13px] font-medium leading-snug text-[#1A1A1F] transition-colors group-hover:text-[#36534E]">
          {title}
        </span>
        <span className="mt-0.5 block text-[12px] leading-snug text-[#635b51]">
          {subtext}
        </span>
      </span>
      <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-[#B5ADA3] transition-all group-hover:translate-x-0.5 group-hover:text-[#36534E]" />
    </Link>
  );
}
