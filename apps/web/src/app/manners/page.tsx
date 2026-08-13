import type { Metadata } from "next";
import Link from "next/link";
import { CHECKLIST_CATEGORY_LABELS } from "@hanbang/shared/constants";

import { MANNERS_CATEGORIES, MANNERS_PARTS } from "@/lib/manners/data";
import { weddingLinkProps } from "@/lib/weddingPaths";
import MannersGuideIndex, { type MannersIndexGroup } from "./MannersGuideIndex";

export const metadata: Metadata = {
  title: "결혼 예절 안내 — 웨딩한방",
  description:
    "결혼 준비의 공통 흐름은 먼저 보고, 결혼 뒤 생활과 특정 선택에 필요한 예절은 따로 찾아볼 수 있게 정리했어요.",
  alternates: { canonical: "https://hanbang.ai/wedding/manners" },
};

export const MANNERS_QUICK_PATHS = [
  { label: "전체 준비 순서", slug: "planning-timeline" },
  { label: "첫 가족 인사", slug: "first-family-visit" },
  { label: "예산·계약", slug: "cost-saving" },
  { label: "청첩장 보내기", slug: "invitation-sending" },
  { label: "본식 당일", slug: "wedding-day" },
  { label: "축의금", slug: "gift-money" },
  { label: "하객 매너", slug: "guest-manners" },
  { label: "혼인신고", slug: "marriage-registration" },
] as const;

const GUIDE_PRINCIPLES = [
  "두 사람이 먼저 합의하고, 각자 자기 가족과 소통해요.",
  "돈·역할·일정은 말로만 두지 말고 함께 확인할 수 있게 남겨요.",
  "전통과 특정 예식 방식은 의무가 아니라 선택이에요.",
  "법·계약·건강 정보는 연결된 공식 안내와 전문가 확인을 우선해요.",
] as const;

function collectSearchStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(collectSearchStrings);
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).flatMap(collectSearchStrings);
  }
  return [];
}

export function buildMannersSearchText(part: (typeof MANNERS_PARTS)[number]): string {
  const journeyMapLabels = part.sections.flatMap((section) =>
    section.blocks.flatMap((block) =>
      block.kind === "journeyMap"
        ? block.stages.flatMap((stage) =>
            stage.categoryKeys.map((categoryKey) => CHECKLIST_CATEGORY_LABELS[categoryKey]),
          )
        : [],
    ),
  );
  return [
    part.title,
    part.subtitle,
    part.description,
    ...part.summary,
    ...collectSearchStrings(part.sections),
    ...journeyMapLabels,
  ].join(" ");
}

export default function MannersIndexPage() {
  const bySlug = new Map(MANNERS_PARTS.map((part) => [part.slug, part]));
  const groups: MannersIndexGroup[] = MANNERS_CATEGORIES.map((category) => ({
    id: category.id,
    tier: category.tier,
    label: category.label,
    description: category.description,
    parts: category.slugs.flatMap((slug) => {
      const part = bySlug.get(slug);
      if (!part) return [];
      return [{
        slug: part.slug,
        title: part.title,
        subtitle: part.subtitle,
        audience: part.audience,
        searchText: buildMannersSearchText(part),
      }];
    }),
  }));

  return (
    <div className="mx-auto w-full max-w-[900px] px-4 py-9 sm:px-6 sm:py-12">
      <header>
        <p className="text-[12px] font-semibold tracking-[0.14em] text-[#8F5150]">WEDDING MANNERS GUIDE</p>
        <h1 className="mt-2 text-[30px] font-semibold leading-snug text-[#1b1c1c] sm:text-[36px]">
          결혼 예절 가이드
        </h1>
        <p className="mt-3 max-w-[650px] text-[14.5px] leading-[1.85] text-[#3d4a45]">
          결혼 준비의 공통 흐름은 먼저 보고, 결혼 뒤 생활과 특정 선택에 필요한 내용은 따로 찾을 수 있게 나눴어요.
          정답을 정해 주기보다 근거와 실제 대화문으로 두 사람의 판단을 도와드려요.
        </p>

        <section
          aria-labelledby="guide-summary-heading"
          className="mt-6 border-y border-[#c7d1c2] bg-[#f7faf5] px-4 py-5 sm:px-5"
        >
          <p className="text-[11.5px] font-semibold tracking-[0.12em] text-[#6d806e]">60초 요약</p>
          <h2 id="guide-summary-heading" className="mt-1.5 text-[18px] font-semibold leading-snug text-[#243832]">
            예절에는 하나의 정답이 없어요
          </h2>
          <p className="mt-2 text-[13.5px] leading-6 text-[#3d4a45]">
            처음에는 핵심만 보여드려요. 식 이후의 생활이나 선택한 방식에 필요한 내용은 아래 범위를 바꿔 확인하세요.
          </p>
          <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
            {GUIDE_PRINCIPLES.map((principle) => (
              <li key={principle} className="flex gap-2 text-[13px] leading-6 text-[#31423d]">
                <span aria-hidden className="mt-[10px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#6d806e]" />
                <span>{principle}</span>
              </li>
            ))}
          </ul>
        </section>

        <nav aria-label="자주 찾는 예절 가이드" className="mt-5">
          <p className="text-[12px] font-semibold tracking-wide text-[#36534e]">지금 필요한 것부터 보기</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {MANNERS_QUICK_PATHS.map((path) => (
              <Link
                key={path.slug}
                href={`/wedding/manners/${path.slug}`}
                prefetch={false}
                className="inline-flex min-h-11 items-center rounded-full border border-[#c7d1c2] bg-white px-3.5 py-2 text-[12.5px] font-semibold text-[#36534e] transition-colors hover:border-[#6d806e] hover:bg-[#f7faf5] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6d806e] focus-visible:ring-offset-2"
              >
                {path.label}
              </Link>
            ))}
          </div>
        </nav>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link
            {...weddingLinkProps("/checklist")}
            className="inline-flex min-h-11 items-center rounded-full bg-[#36534e] px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-[#2b4541] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6d806e] focus-visible:ring-offset-2"
          >
            웨딩 체크리스트 열기
          </Link>
          <p className="text-[12.5px] leading-6 text-[#53645e]">가이드는 읽기, 체크리스트는 실제 준비 관리에 사용해요.</p>
        </div>

        <p className="mt-4 border-l-2 border-[#6d806e] bg-[#243832]/[0.035] px-4 py-3 text-[13px] leading-[1.7] text-[#3d4a45]">
          지역·가족·모임마다 관행이 다를 수 있어요. 수치가 있는 내용에는 확인한 출처와 날짜를 함께 표시했어요.
        </p>
      </header>

      <MannersGuideIndex groups={groups} />

      <p className="mt-12 text-[13px] leading-[1.75] text-[#3d4a45]/80">
        우리 상황에서는 어떻게 적용할지 막히면, 가족 구성과 고민을 아모라에게 그대로 말해 보세요.{" "}
        <Link {...weddingLinkProps("/chat")} className="font-medium text-[#8F5150] underline underline-offset-2">
          아모라에게 물어보기
        </Link>
      </p>
    </div>
  );
}
