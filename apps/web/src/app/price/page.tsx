import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ClipboardCheck, MapPin } from "lucide-react";
import { cache } from "react";

import { PriceAmoraBridge } from "@/components/price/PriceAmoraBridge";
import { loadPriceCatalogWithBuildFallback } from "@/lib/price/buildCatalog";
import {
  PRICE_CATEGORIES,
  vendorRegionCodes,
  type PriceCatalog,
  type PriceCategory,
} from "@/lib/price/catalog";
import { PRICE_CATEGORY_LABELS, PRICE_REGION_OPTIONS } from "@/lib/price/labels";
import { disclosureRoundLabel } from "@/lib/price/period";
import { loadPublicPriceCatalog } from "@/lib/price/publicListData";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * 공개된 위약금·환불 원문 건수. 분기 공시 갱신 때 함께 바뀐다.
 *
 * 2026-07-26 운영 `v_public_vendor_policies` 실조회: 831건 / vendor 행 502.
 * 다만 **업체 수로 쓸 값은 502가 아니라 406이다**(2026-08-08 재측정) — 같은 샵이
 * 대행사별로 여러 행에 들어와 있고 목록은 한 카드로 묶는다. 첫 화면 상수 주석 참고.
 */
const PUBLISHED_POLICY_COUNT = 831;

export const revalidate = 86_400;

// 허브는 카테고리 수와 공시 기간만 필요하다 — 옵션 원문은 한 건도 받지 않는다.
const loadCounts = cache((): Promise<PriceCatalog> => (
  loadPriceCatalogWithBuildFallback(() => (
    loadPublicPriceCatalog(createPublicClient(), { optionCategories: [] })
  ))
));

type RegionSummary = { code: string; label: string; count: number };

function buildCrossRegionCounts(catalog: PriceCatalog): RegionSummary[] {
  const tally = new Map<string, number>();
  for (const category of PRICE_CATEGORIES) {
    for (const vendor of catalog.categories[category]) {
      for (const code of new Set(vendorRegionCodes(vendor))) {
        tally.set(code, (tally.get(code) ?? 0) + 1);
      }
    }
  }
  return PRICE_REGION_OPTIONS
    .map(([code, label]) => ({ code, label, count: tally.get(code) ?? 0 }))
    .filter(({ count }) => count > 0)
    .sort((left, right) => right.count - left.count);
}

// 각 카테고리에서 실제로 공시되는 항목만 적는다(없는 정보를 약속하지 않는다).
const CATEGORY_HINTS: Record<PriceCategory, string> = {
  studio: "촬영 기본 금액과 앨범·촬영한 전체 사진 파일·수정해 주는 사진의 추가 금액",
  dress: "드레스 대여 기본 금액과 입어보기·결혼식 날 도움 비용 등 별도 항목",
  makeup: "두 사람의 헤어·메이크업 기본 금액과 부모님 메이크업·이른 시작 비용",
  hall: "장소 사용료·식사비와 계약상 최소 식사 인원 등 조건",
};

export async function generateMetadata(): Promise<Metadata> {
  const catalog = await loadCounts();
  const period = disclosureRoundLabel();
  const total = PRICE_CATEGORIES.reduce((sum, category) => sum + (catalog.counts[category] ?? 0), 0);
  const title = "사진 촬영·드레스·메이크업·결혼식장 공시 가격과 위약금";
  const description = `${period} 기준 업체 ${total.toLocaleString()}곳의 기본가·추가금과, 취소 위약금·환불 규정 원문 ${PUBLISHED_POLICY_COUNT.toLocaleString()}건을 한 화면에서. 요약도 판정도 하지 않습니다.`;
  return {
    title,
    description,
    alternates: { canonical: "/price" },
    openGraph: { title, description, url: "/price", type: "website" },
  };
}

export default async function PriceIndexPage() {
  const catalog = await loadCounts();
  const period = disclosureRoundLabel();
  const total = PRICE_CATEGORIES.reduce((sum, category) => sum + (catalog.counts[category] ?? 0), 0);
  const regionCounts = buildCrossRegionCounts(catalog);
  const topRegions = regionCounts.slice(0, 5);
  const otherRegionCount = regionCounts.slice(5).reduce((sum, r) => sum + r.count, 0);

  return (
    <>
      <section className="border-b border-[#243832]/10 bg-[radial-gradient(circle_at_top_right,rgba(181,151,122,0.2),transparent_42%),linear-gradient(180deg,#FFFDF8_0%,#FBF8F2_100%)] px-4 pb-8 pt-8 sm:px-6 sm:pb-10 sm:pt-12">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-bold tracking-[0.13em] text-[#8F6662]">한국소비자원 참가격 공시</p>
          <h1 className="mt-2 max-w-2xl text-3xl font-bold tracking-normal text-[#243832] sm:text-4xl">
            공시 가격과 위약금, 업체가 쓴 문장 그대로
          </h1>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-[#F5ECE4] px-3 py-1.5 text-xs font-bold text-[#7C5754]">
              {period} 공시 기준
            </span>
            <p className="text-sm font-semibold leading-6 text-[#243832]/75">
              가격을 공개한 업체 {total.toLocaleString()}곳
            </p>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-[#243832]/75">
            기본가와 추가금은 물론, 취소하면 얼마를 무는지까지 업체가 공시한 원문 그대로
            {" "}{PUBLISHED_POLICY_COUNT.toLocaleString()}건을 실었어요. 좋다·나쁘다 판정은 하지 않습니다.
          </p>
          {/* 유통 글의 c 계열 링크가 "위약금 원문을 모아뒀다"고 약속하고 여기로 보낸다.
              그런데 이 페이지에는 위약금이라는 단어조차 없었다(2026-07-26 실측) — 약속하고
              데려와 다른 걸 보여준 셈이다. 도착 즉시 그 약속을 눈으로 확인시킨다. */}
          <div className="mt-4 rounded-2xl border border-[#8F6662]/25 bg-white px-5 py-4">
            <p className="text-sm font-bold text-[#8F5150]">
              같은 업체인데 대행사에 따라 위약금이 달라요
            </p>
            <p className="mt-1.5 text-sm leading-6 text-[#243832]/75">
              촬영 60일 전 취소 기준으로 한쪽은 상품가의 20%인데 다른 쪽은 100%인 경우가
              있었어요. 업체를 고른 뒤 &ldquo;계약 전 확인&rdquo; 항목에서 대행사별 원문을 비교해 보세요.
            </p>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl px-4 pb-12 pt-8 sm:px-6">
        <h2 className="text-lg font-bold tracking-normal text-[#243832]">어떤 항목부터 볼까요?</h2>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {PRICE_CATEGORIES.map((category) => (
            <li key={category}>
              <Link
                href={`/price/${category}`}
                // 카테고리 페이지 RSC가 600~900KB — 4개를 미리 받으면 허브가 수 MB를 쓴다.
                prefetch={false}
                className="flex min-h-[104px] items-center justify-between gap-4 rounded-[20px] border border-[#243832]/12 bg-white px-5 py-5 transition-colors hover:border-[#36534E]/45 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]"
              >
                <span className="min-w-0">
                  <span className="flex flex-wrap items-baseline gap-2">
                    <span className="text-lg font-bold text-[#243832]">{PRICE_CATEGORY_LABELS[category]}</span>
                    <span className="text-sm font-semibold text-[#8F6662]">
                      {(catalog.counts[category] ?? 0).toLocaleString()}곳
                    </span>
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-[#243832]/75">{CATEGORY_HINTS[category]}</span>
                </span>
                <ArrowRight aria-hidden="true" className="size-5 shrink-0 text-[#36534E]" />
              </Link>
            </li>
          ))}
        </ul>

        {regionCounts.length > 0 ? (
          <section className="mt-8" aria-labelledby="region-overview-heading">
            <div className="flex items-center gap-2">
              <MapPin aria-hidden="true" className="size-4 text-[#8F6662]" />
              <h2 id="region-overview-heading" className="text-lg font-bold tracking-normal text-[#243832]">
                어느 지역에서 준비하세요?
              </h2>
            </div>
            <p className="mt-2 text-sm leading-6 text-[#243832]/75">
              같은 업체라도 대행사 지역에 따라 가격이 달라요. 카테고리를 고른 뒤 지역을 선택하면 해당 지역 대행사 가격만 볼 수 있어요.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {topRegions.map(({ code, label, count }) => (
                <span
                  key={code}
                  className="inline-flex items-center gap-1.5 rounded-full border border-[#243832]/12 bg-white px-3 py-1.5 text-sm"
                >
                  <span className="font-semibold text-[#243832]">{label}</span>
                  <span className="text-xs tabular-nums text-[#36534E]/70">{count.toLocaleString()}곳</span>
                </span>
              ))}
              {otherRegionCount > 0 ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-[#243832]/20 bg-[#FBF8F2] px-3 py-1.5 text-sm text-[#243832]/70">
                  그 밖의 지역 {otherRegionCount.toLocaleString()}곳
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-xs leading-5 text-[#243832]/60">
              지역 분포는 대행사 공시 기준이에요. 지역이 적어 보여도 공시한 업체만 실어서 그렇지, 실제 업체 수와는 달라요.
            </p>
          </section>
        ) : null}

        <Link
          href="/wedding/community/quote-check"
          prefetch={false}
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

        <p className="mt-6 text-xs leading-5 text-[#243832]/75">
          가격 출처: 한국소비자원 참가격 · {period} 공시 기준. 공시 가격은 기준 시점의 기본 조건 가격이라
          계약 시점·시즌·선택 옵션에 따라 실제 금액은 달라질 수 있어요. 계약 전 업체에 직접 확인하세요.
        </p>

        <PriceAmoraBridge />
      </div>
    </>
  );
}
