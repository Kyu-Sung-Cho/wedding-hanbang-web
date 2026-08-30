"use client";

import { MapPin } from "lucide-react";

import { PRICE_REGION_OPTIONS, priceRegionLabel } from "@/lib/price/labels";

export type RegionCount = { code: string; label: string; count: number };

type RegionFirstPickerProps = {
  counts: RegionCount[];
  totalCount: number;
  onSelect: (regionCode: string) => void;
};

/**
 * 지역을 먼저 고르게 하는 첫 단계.
 *
 * 같은 샵이 여러 대행사에 걸쳐 있으면 한 카드로 묶이는데, 대행사 지역이 다르면
 * 가격도 다르다. 그래서 지역을 안 고른 목록은 "어디 가격인지 모르는 목록"이 된다.
 * 다만 막아 세우진 않는다 — 전체 보기를 눌러 그냥 둘러볼 수도 있어야 하고,
 * 목록 자체는 이 카드 아래에 그대로 렌더돼 검색 노출도 잃지 않는다.
 */
export function RegionFirstPicker({ counts, totalCount, onSelect }: RegionFirstPickerProps) {
  return (
    <section
      aria-labelledby="region-first-heading"
      className="mx-auto max-w-6xl px-4 pt-5 sm:px-6 sm:pt-7"
    >
      <div className="rounded-[24px] border border-[#8F6662]/20 bg-white p-5 shadow-[0_12px_34px_rgba(36,56,50,0.045)] sm:p-6">
        <p className="inline-flex items-center gap-1.5 text-xs font-bold text-[#8F5150]">
          <MapPin aria-hidden="true" className="size-3.5" />
          먼저 지역부터
        </p>
        <h2 id="region-first-heading" className="mt-2 text-xl font-bold sm:text-2xl">
          어느 지역에서 준비하세요?
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--hb-text-strong)]/85">
          같은 업체라도 어느 대행사를 끼는지에 따라 가격이 달라요. 지역을 고르면 그
          지역 대행사가 공시한 가격만 보여드릴게요.
        </p>

        <ul className="mt-5 flex flex-wrap gap-2">
          {counts.map(({ code, label, count }) => (
            <li key={code}>
              <button
                type="button"
                onClick={() => onSelect(code)}
                className="inline-flex min-h-11 items-center gap-2 rounded-[6px] border border-[var(--hb-primary)]/12 bg-[var(--hb-surface-page)] px-4 text-sm font-bold text-[var(--hb-text-strong)] transition-colors hover:border-[#8F6662]/45 hover:bg-[var(--hb-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-primary)]"
              >
                {label}
                <span className="text-xs font-semibold tabular-nums text-[var(--hb-text-muted)]">
                  {count.toLocaleString("ko-KR")}
                </span>
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          onClick={() => onSelect("")}
          className="mt-4 inline-flex min-h-11 items-center text-sm font-semibold text-[var(--hb-text-strong)] underline underline-offset-4 hover:text-[#8F6662] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-primary)]"
        >
          지역 상관없이 전체 {totalCount.toLocaleString("ko-KR")}곳 둘러보기
        </button>
      </div>
    </section>
  );
}

/**
 * 공시 업체가 적은 지역에서 왜 적은지 알려준다.
 *
 * 지역별 공급이 크게 기울어 있다(2026-07-30 실측: 서울 강남권 490 · 인천 5 · 대구 6).
 * 얇은 지역을 고른 사람에게 한두 곳만 덩그러니 보여주면 "이 서비스 별거 없네"로
 * 읽힌다. 실제로는 "공시한 업체만 싣는다"는 원칙의 결과다 — 그 이유를 말하고
 * 빠져나갈 길을 준다.
 */
export function ThinCoverageNotice({
  regionCode,
  count,
  onShowAll,
}: {
  regionCode: string;
  count: number;
  onShowAll: () => void;
}) {
  if (!regionCode || count > THIN_COVERAGE_THRESHOLD) return null;
  return (
    <div className="mx-auto max-w-6xl px-4 pt-3 sm:px-6">
      <p className="rounded-xl bg-[var(--hb-surface-hover)] px-4 py-3 text-sm leading-6 text-[var(--hb-text-strong)]">
        {priceRegionLabel(regionCode)}은 아직 가격을 공시한 업체가{" "}
        <span className="font-bold">{count.toLocaleString("ko-KR")}곳</span>뿐이에요.
        공시한 업체만 싣기 때문이라, 실제 업체 수와는 다릅니다.{" "}
        <button
          type="button"
          onClick={onShowAll}
          className="font-bold text-[#8F5150] underline underline-offset-4 hover:text-[#C4967E]"
        >
          전체 지역에서 찾아보기
        </button>
      </p>
    </div>
  );
}

/** 이 수 이하면 "적다"고 알린다 — 한 화면(20곳)의 절반이 기준. */
const THIN_COVERAGE_THRESHOLD = 10;

type RegionChipProps = {
  regionCode: string;
  count: number;
  onChange: () => void;
};

/** 지역을 고른 뒤 목록 위에 남는 표시 — 지금 무슨 지역을 보고 있는지 항상 보이게. */
export function RegionChip({ regionCode, count, onChange }: RegionChipProps) {
  return (
    <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 pt-5 sm:px-6 sm:pt-7">
      <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-[#F0E4DC] px-3.5 text-sm font-bold text-[#8F5150]">
        <MapPin aria-hidden="true" className="size-3.5" />
        {regionCode ? priceRegionLabel(regionCode) : "전체 지역"}
        <span className="text-xs font-semibold tabular-nums text-[var(--hb-text-muted)]">
          {count.toLocaleString("ko-KR")}곳
        </span>
      </span>
      <button
        type="button"
        onClick={onChange}
        className="inline-flex min-h-9 items-center rounded-[6px] border border-[var(--hb-primary)]/12 px-3.5 text-sm font-semibold text-[var(--hb-text-strong)] hover:border-[#8F6662]/45 hover:text-[#8F6662] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--hb-primary)]"
      >
        지역 바꾸기
      </button>
    </div>
  );
}

/** 카테고리 안에서 지역별 업체 수 — 고르기 전에 어디에 얼마나 있는지 보이게 한다. */
export function buildRegionCounts(
  regionCodesOf: (index: number) => string[],
  vendorCount: number,
): RegionCount[] {
  const tally = new Map<string, number>();
  for (let index = 0; index < vendorCount; index += 1) {
    // 한 업체가 여러 지역 대행사에 걸쳐 있으면 각 지역에서 모두 셀 수 있어야 한다.
    for (const code of new Set(regionCodesOf(index))) {
      tally.set(code, (tally.get(code) ?? 0) + 1);
    }
  }
  return PRICE_REGION_OPTIONS
    .map(([code, label]) => ({ code, label, count: tally.get(code) ?? 0 }))
    .filter(({ count }) => count > 0);
}
