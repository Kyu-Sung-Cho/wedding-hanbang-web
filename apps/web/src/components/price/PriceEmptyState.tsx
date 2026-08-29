import Link from "next/link";
import { ArrowRight, FileHeart } from "lucide-react";

import { PRICE_CATEGORIES, type PriceCategory } from "@/lib/price/catalog";
import { PRICE_CATEGORY_LABELS, priceRegionLabel } from "@/lib/price/labels";

type PriceEmptyStateProps = {
  category?: PriceCategory;
  regionCode?: string;
  hasOtherFilters?: boolean;
  surface?: "public" | "app";
  preview?: boolean;
  onResetFilters?(): void;
};

// 결과 0건은 실패가 아니라 사실이다 — 왜 비었는지 정직하게 말하고,
// 사용자가 다음으로 갈 수 있는 실제 경로(필터 초기화·다른 카테고리)를 준다.
export function PriceEmptyState({
  category,
  regionCode,
  hasOtherFilters = false,
  surface = "public",
  preview = false,
  onResetFilters,
}: PriceEmptyStateProps) {
  const regionLabel = regionCode ? priceRegionLabel(regionCode) : null;
  const categoryLabel = category ? PRICE_CATEGORY_LABELS[category] : "이 카테고리";
  const heading = regionLabel && !hasOtherFilters
    ? `${regionLabel}에는 아직 ${categoryLabel} 공시가 없어요.`
    : "이 조건에 맞는 공시 업체가 아직 없어요.";
  const description = regionLabel && !hasOtherFilters
    ? "가격표시제 공시는 업체가 직접 공개한 것만 표시돼요. 다른 지역이나 다른 카테고리에는 공시가 있을 수 있어요."
    : "필터를 조금 풀거나 검색어를 바꿔보세요. 공시는 업체가 직접 공개한 것만 표시돼요.";
  const otherCategories = category
    ? PRICE_CATEGORIES.filter((value) => value !== category)
    : [];

  return (
    <section className="rounded-[24px] border border-[var(--hb-primary)]/12 bg-white px-5 py-10 text-center shadow-[0_12px_34px_rgba(36,56,50,0.06)] sm:px-8">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-[#F5ECE4] text-[#8F6662]">
        <FileHeart aria-hidden="true" className="size-6" />
      </span>
      <h2 className="mt-5 text-xl font-bold tracking-normal text-[var(--hb-text-strong)]">
        {heading}
      </h2>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[var(--hb-text-strong)]/70">
        {description}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
        {onResetFilters ? (
          <button
            type="button"
            onClick={onResetFilters}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--hb-primary)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(36,56,50,0.16)] hover:bg-[var(--hb-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]"
          >
            필터 초기화
          </button>
        ) : null}
        {otherCategories.map((value) => (
          <Link
            key={value}
            href={surface === "app"
              ? `/wedding/vendors?category=${value}${preview ? "&preview=1" : ""}`
              : `/price/${value}`}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-[var(--hb-primary)]/15 bg-white px-4 py-2.5 text-sm font-semibold text-[var(--hb-text-strong)]/80 hover:bg-[#F5ECE4]/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B89785]"
          >
            {PRICE_CATEGORY_LABELS[value]} 공시 보기
          </Link>
        ))}
      </div>
      <Link
        href="/wedding/community/quote-check"
        className="mt-5 inline-flex min-h-11 items-center justify-center gap-1 px-2 text-xs font-semibold text-[var(--color-rose-700)] underline-offset-4 hover:underline"
      >
        받은 견적 공유하고 다른 커플 돕기
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </Link>
    </section>
  );
}
