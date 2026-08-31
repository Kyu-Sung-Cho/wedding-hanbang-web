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
import { communityPostPath } from "@/lib/community/routes";
import { weddingPath } from "@/lib/weddingPaths";
import type { CommunityCategory, PriceData } from "@/types/community.types";

interface ServiceCTAProps {
  category: CommunityCategory;
  postTitle?: string;
  postId?: string;
  postContent?: string;
  priceData?: PriceData | null;
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
    label: "아모라와 조건 정리",
    title: "답변에서 확인할 조건을 내 기준으로 다시 정리해보세요.",
    subtext: "결혼식 날짜, 예산, 준비 단계에 맞춰 다음 질문과 행동을 정리합니다.",
    href: "/chat",
  },
  tour_review: {
    icon: MessageCircle,
    label: "아모라와 후기 해석",
    title: "이 경험에서 우리 조건에 해당하는 부분만 골라보세요.",
    subtext: "예산, 지역, 원하는 분위기를 기준으로 더 확인할 내용을 정리합니다.",
    href: "/chat",
  },
  tips_v2: {
    icon: CalendarCheck,
    label: "일정으로 옮기기",
    title: "도움이 된 내용을 우리 일정에 맞게 다시 정리해보세요.",
    subtext: "해야 할 일과 확인 시점을 놓치지 않게 이어갑니다.",
    href: "/schedule",
  },
  ama: {
    icon: HelpCircle,
    label: "남은 질문 정리",
    title: "답변을 읽고도 남은 질문만 아모라와 정리해보세요.",
    subtext: "내 상황을 먼저 정리하고 커뮤니티에 더 물어볼 내용을 구체화합니다.",
    href: "/chat",
  },
  free: {
    icon: MessageCircle,
    label: "내 준비에 반영",
    title: "이 이야기에서 우리에게 필요한 행동만 정리해보세요.",
    subtext: "아모라에게 내 상황을 말하고 일정·예산·할 일 중 필요한 곳에 이어갑니다.",
    href: "/chat",
  },
};

const BUDGET_CATEGORIES = new Set(["is_normal"]);
const SCHEDULE_CATEGORIES = new Set(["tips_v2", "ama"]);

// HTML 본문 → 프롬프트용 평문 발췌 (아모라가 링크가 아니라 내용 자체를 받게)
function toPlainExcerpt(html: string, maxLen = 500): string {
  const text = html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
}

function formatPriceLine(priceData: PriceData): string {
  const parts = [
    priceData.region ? `지역 ${priceData.region}` : null,
    `기본금 ${priceData.base_price}만원`,
    priceData.extra_price != null ? `추가금 ${priceData.extra_price}만원` : null,
    priceData.details ? `상세: ${priceData.details.slice(0, 200)}` : null,
  ].filter(Boolean);
  return `글에 적힌 가격 정보(${priceData.vendor_category}): ${parts.join(", ")}`;
}

function buildChatHref(
  postTitle?: string,
  postId?: string,
  postContent?: string,
  priceData?: PriceData | null
) {
  if (!postTitle) return weddingPath("/chat");
  const prompt = [
    "이 커뮤니티 글을 내 결혼식 날짜, 예산, 준비 단계 기준으로 해석해줘.",
    `글 제목: ${postTitle}`,
    postContent ? `글 내용: ${toPlainExcerpt(postContent)}` : null,
    priceData ? formatPriceLine(priceData) : null,
    postId ? `글 링크: ${communityPostPath(postId)}` : null,
    "내가 확인해야 할 일정, 예산, 체크리스트를 알려줘.",
  ]
    .filter(Boolean)
    .join("\n");
  return weddingPath(`/chat?prefill=${encodeURIComponent(prompt)}`);
}

export default function ServiceCTA({ category, postTitle, postId, postContent, priceData }: ServiceCTAProps) {
  const mainCta = CTA_MAP[category] ?? CTA_MAP.free;
  const MainIcon = mainCta.icon;
  const mainHref =
    mainCta.href === "/chat"
      ? buildChatHref(postTitle, postId, postContent, priceData)
      : weddingPath(mainCta.href);

  let secondaryCta: CTAConfig | null = null;
  if (BUDGET_CATEGORIES.has(category)) {
    secondaryCta = {
      icon: Wallet,
      label: "예산",
      title: "확인한 금액을 예산에 반영하기",
      subtext: "확인한 견적가와 별도 금액을 한 곳에서 관리합니다.",
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
    <section className="overflow-hidden rounded-[6px] border border-[#c7d1c2] bg-[#f4f6f1]" aria-labelledby="community-next-action-heading">
      <div className="px-4 py-4 sm:px-5 sm:py-5">
        <p className="text-[10px] font-bold text-[var(--color-rose-700)]">답을 찾은 다음</p>
        <h2 id="community-next-action-heading" className="mt-1 font-serif-kr text-[var(--hb-text-strong)]">
          사람의 답변을 내 준비로 옮기기
        </h2>
        <p className="mt-1.5 max-w-[620px] text-[12px] font-medium leading-[1.65] text-[#667268]">
          이 글의 제목과 본문을 함께 넘겨, 우리 일정·예산·확인 항목에 맞는 다음 행동만 정리합니다.
        </p>
      </div>

      <div className={`grid gap-px border-t border-[#c7d1c2] bg-[#c7d1c2] ${secondaryCta ? "sm:grid-cols-2" : ""}`}>
        <ServiceAction
          href={mainHref}
          icon={MainIcon}
          label={mainCta.label}
          title={mainCta.title}
          subtext={mainCta.subtext}
          primary
        />

        {secondaryCta ? (
          <ServiceAction
            href={weddingPath(secondaryCta.href)}
            icon={secondaryCta.icon}
            label={secondaryCta.label}
            title={secondaryCta.title}
            subtext={secondaryCta.subtext}
          />
        ) : null}
      </div>

      <p className="border-t border-[#d8dfd4] px-4 py-3 text-[10.5px] font-medium leading-[1.55] text-[#6f786f] sm:px-5">
        아모라는 사람의 경험을 정답으로 확정하지 않습니다. 제안 내용을 확인한 뒤 반영 여부를 직접 선택하세요.
      </p>
    </section>
  );
}

function ServiceAction({
  href,
  icon: Icon,
  label,
  title,
  subtext,
  primary = false,
}: CTAConfig & { primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`group flex min-h-[118px] items-start gap-3 px-4 py-4 transition-colors sm:px-5 ${
        primary
          ? "bg-[var(--hb-primary)] text-white hover:bg-[#2d4642]"
          : "bg-white text-[var(--hb-text-strong)] hover:bg-[var(--hb-surface-page)]"
      }`}
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors ${
        primary
          ? "border-white/20 bg-white/10 text-white"
          : "border-[#d8dfd4] bg-[#eef4f1] text-[var(--hb-text-strong)]"
      }`}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className={`mb-1 block text-[10px] font-bold ${primary ? "text-white/65" : "text-[#8b8175]"}`}>{label}</span>
        <span className={`block text-[13px] font-bold leading-[1.45] ${primary ? "text-white" : "text-[var(--hb-text-strong)]"}`}>
          {title}
        </span>
        <span className={`mt-1 block text-[11px] font-medium leading-[1.55] ${primary ? "text-white/72" : "text-[#6f786f]"}`}>
          {subtext}
        </span>
      </span>
      <ArrowRight className={`mt-1 h-4 w-4 shrink-0 transition-all group-hover:translate-x-0.5 ${primary ? "text-white/70" : "text-[#8b8175] group-hover:text-[var(--hb-text-strong)]"}`} />
    </Link>
  );
}
