import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ClipboardCheck } from "lucide-react";
import { cache } from "react";

import { PriceAmoraBridge } from "@/components/price/PriceAmoraBridge";
import { loadPriceCatalogWithBuildFallback } from "@/lib/price/buildCatalog";
import { PRICE_CATEGORIES, type PriceCatalog, type PriceCategory } from "@/lib/price/catalog";
import { PRICE_CATEGORY_LABELS } from "@/lib/price/labels";
import { formatDisclosurePeriod } from "@/lib/price/period";
import { loadPublicPriceCatalog } from "@/lib/price/publicListData";
import { createPublicClient } from "@/lib/supabase/public";

export const revalidate = 86_400;

// 허브는 카테고리 수와 공시 기간만 필요하다 — 옵션 원문은 한 건도 받지 않는다.
const loadCounts = cache((): Promise<PriceCatalog> => (
  loadPriceCatalogWithBuildFallback(() => (
    loadPublicPriceCatalog(createPublicClient(), { optionCategories: [] })
  ))
));

// 각 카테고리에서 실제로 공시되는 항목만 적는다(없는 정보를 약속하지 않는다).
const CATEGORY_HINTS: Record<PriceCategory, string> = {
  studio: "촬영 상품 기본가와 앨범·원본·수정본 추가금",
  dress: "대여 기본가와 피팅비·헬퍼비 등 추가 항목",
  makeup: "신부 메이크업 기본가와 혼주·얼리스타트 추가금",
  hall: "대관료·식대와 보증인원 등 계약 조건",
};

export async function generateMetadata(): Promise<Metadata> {
  const catalog = await loadCounts();
  const period = formatDisclosurePeriod(catalog.periodLabel);
  const total = PRICE_CATEGORIES.reduce((sum, category) => sum + (catalog.counts[category] ?? 0), 0);
  const title = "스드메·예식장 공시 가격 — 업체별 기본가와 추가금";
  const description = `${period} 기준으로 가격을 공개한 업체 ${total.toLocaleString()}곳의 기본가와 추가금을 한 화면에서 비교하세요. 한국소비자원 참가격 공시 자료입니다.`;
  return {
    title,
    description,
    alternates: { canonical: "/price" },
    openGraph: { title, description, url: "/price", type: "website" },
  };
}

export default async function PriceIndexPage() {
  const catalog = await loadCounts();
  const period = formatDisclosurePeriod(catalog.periodLabel);
  const total = PRICE_CATEGORIES.reduce((sum, category) => sum + (catalog.counts[category] ?? 0), 0);

  return (
    <>
      <section className="border-b border-[#243832]/10 bg-[radial-gradient(circle_at_top_right,rgba(181,151,122,0.2),transparent_42%),linear-gradient(180deg,#FFFDF8_0%,#FBF8F2_100%)] px-4 pb-8 pt-8 sm:px-6 sm:pb-10 sm:pt-12">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-bold tracking-[0.13em] text-[#8F6662]">한국소비자원 참가격 공시</p>
          <h1 className="mt-2 max-w-2xl text-3xl font-bold tracking-[-0.04em] text-[#243832] sm:text-4xl">
            스드메·예식장 공시 가격
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-[#F5ECE4] px-3 py-1.5 text-xs font-bold text-[#7C5754]">
              {period} 공시 기준
            </span>
            <p className="text-sm font-semibold leading-6 text-[#243832]/75">
              가격을 공개한 업체 {total.toLocaleString()}곳
            </p>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#243832]/65">
            좋다·나쁘다 판정 없이, 업체가 직접 공개한 기본가와 추가금만 그대로 보여드려요.
            계약 전에 무엇을 더 물어봐야 하는지도 함께 정리해 드립니다.
          </p>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 pb-12 pt-8 sm:px-6">
        <h2 className="text-lg font-bold tracking-[-0.02em] text-[#243832]">어떤 항목부터 볼까요?</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {PRICE_CATEGORIES.map((category) => (
            <li key={category}>
              <Link
                href={`/price/${category}`}
                className="flex min-h-[104px] items-center justify-between gap-4 rounded-[20px] border border-[#243832]/12 bg-white px-5 py-5 transition-colors hover:border-[#36534E]/45 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]"
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="text-lg font-bold text-[#243832]">{PRICE_CATEGORY_LABELS[category]}</span>
                    <span className="text-sm font-semibold text-[#8F6662]">
                      {(catalog.counts[category] ?? 0).toLocaleString()}곳
                    </span>
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-[#243832]/65">{CATEGORY_HINTS[category]}</span>
                </span>
                <ArrowRight aria-hidden="true" className="size-5 shrink-0 text-[#36534E]" />
              </Link>
            </li>
          ))}
        </ul>

        <Link
          href="/wedding/community/quote-check"
          className="mt-6 flex items-center justify-between gap-4 rounded-[20px] bg-[#36534E] px-5 py-5 text-white transition-colors hover:bg-[#2B423E] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]"
        >
          <span className="min-w-0">
            <span className="flex items-center gap-2 text-sm font-bold">
              <ClipboardCheck aria-hidden="true" className="size-4" />
              이미 견적서를 받았다면
            </span>
            <span className="mt-1 block text-sm leading-6 text-white/75">
              빠진 항목이 없는지 3분 만에 확인하고, 업체에 보낼 질문까지 받아보세요. 로그인 없이 무료예요.
            </span>
          </span>
          <ArrowRight aria-hidden="true" className="size-5 shrink-0" />
        </Link>

        <p className="mt-6 text-xs leading-5 text-[#243832]/55">
          가격 출처: 한국소비자원 참가격 · {period} 공시 기준. 공시 가격은 기준 시점의 기본 조건 가격이라
          계약 시점·시즌·선택 옵션에 따라 실제 금액은 달라질 수 있어요. 계약 전 업체에 직접 확인하세요.
        </p>

        <PriceAmoraBridge />
      </div>
    </>
  );
}
