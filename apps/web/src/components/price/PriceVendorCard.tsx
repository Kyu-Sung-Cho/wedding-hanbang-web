"use client";

import Link from "next/link";
import { ChevronDown, Heart, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { track } from "@/lib/analytics/track";
import { krwRangeLabel } from "@/lib/format/krw";
import {
  comparableOffers,
  offerOptionCount,
  pricePolicyBadgeClass,
  pricePolicyLabel,
  vendorRegionCodes,
  type PriceOffer,
  type PriceOption,
  type PriceVendor,
} from "@/lib/price/catalog";
import { priceRegionLabel } from "@/lib/price/labels";
import { hasUnverifiedBranch } from "@/lib/price/vendorIdentity";
import { VendorAvatar } from "./VendorAvatar";
import { loadVendorOptions } from "./vendorOptionsClient";

// 기본가 없이 옵션만 공시된 행(예: 결혼식장 "○○홀 옵션")은 "가격 확인 필요" 대신
// 옵션이 아래 추가금 목록에 있음을 안내한다 — 가격이 실제로는 공개돼 있기 때문.
function offerPriceLabel(offer: PriceOffer): string {
  const optionTotal = offerOptionCount(offer);
  if (offer.minimumKrw === null && offer.maximumKrw === null && optionTotal > 0) {
    return `추가금 ${optionTotal}개 참조`;
  }
  return krwRangeLabel(offer.minimumKrw, offer.maximumKrw);
}

/**
 * 여러 공시 행을 한 줄로 요약하되 `최대 N원`과 `N원부터`의 방향을 보존한다.
 *
 * 일부 행에 하한이 없으면 전체 하한도 주장하지 않고, 일부 행에 상한이 없으면
 * 전체 상한도 주장하지 않는다. 양쪽이 모두 불완전하면 범위를 억지로 만들지 않는다.
 */
function aggregateOfferPriceLabel(offers: readonly PriceOffer[]): string | null {
  const pricedOffers = offers.filter((offer) => (
    offer.minimumKrw !== null || offer.maximumKrw !== null
  ));
  if (pricedOffers.length === 0) return null;

  const hasCompleteMinimums = pricedOffers.every((offer) => offer.minimumKrw !== null);
  const hasCompleteMaximums = pricedOffers.every((offer) => offer.maximumKrw !== null);
  const minimumKrw = hasCompleteMinimums
    ? Math.min(...pricedOffers.map((offer) => offer.minimumKrw!))
    : null;
  const maximumKrw = hasCompleteMaximums
    ? Math.max(...pricedOffers.map((offer) => offer.maximumKrw!))
    : null;

  return minimumKrw === null && maximumKrw === null
    ? null
    : krwRangeLabel(minimumKrw, maximumKrw);
}

type PriceVendorCardProps = {
  vendor: PriceVendor;
  agencyOrder?: readonly { id: string; name: string }[];
  activeRegionCode?: string;
  isWishlisted: boolean;
  wishlistBusy?: boolean;
  preview?: boolean;
  onToggleWishlist(vendor: PriceVendor): void;
  onOpenCombo?(vendor: PriceVendor): void;
};

export function PriceVendorCard({
  vendor,
  agencyOrder,
  activeRegionCode,
  isWishlisted,
  wishlistBusy = false,
  preview = false,
  onToggleWishlist,
  onOpenCombo,
}: PriceVendorCardProps) {
  const cardRef = useRef<HTMLElement>(null);
  // 슬림 카탈로그(옵션 본문 미탑재)의 지연 로드 상태 — 펼칠 때 1회 조회, 모듈 캐시 공유.
  const [lazyOptions, setLazyOptions] = useState<Map<string, PriceOption[]> | null>(null);
  const [lazyStatus, setLazyStatus] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const [showAllAgencies, setShowAllAgencies] = useState(false);
  const offersByAgency = new Map<string, typeof vendor.offers>();
  for (const offer of vendor.offers) {
    if (!offer.agencyId) continue;
    const agencyOffers = offersByAgency.get(offer.agencyId) ?? [];
    agencyOffers.push(offer);
    offersByAgency.set(offer.agencyId, agencyOffers);
  }
  const directOffers = vendor.offers.filter(({ agencyId }) => agencyId === null);
  // agencyOrder(다중 선택)는 컬럼 순서만 정하고, 컬럼 자체는 이 벤더가 실제 보유한
  // 대행사만 만든다 — 미보유 대행사를 "—" 컬럼으로 채우면 카드가 대시로 뒤덮이고
  // 진짜 가격이 가로 스크롤 밖으로 밀려 "선택한 대행사인데 안 보이는" 문제가 된다.
  const agencyList = agencyOrder
    ? agencyOrder.filter((agency) => offersByAgency.has(agency.id))
    : [...new Map(
      vendor.offers.flatMap((offer) => offer.agencyId
        ? [[offer.agencyId, { id: offer.agencyId, name: offer.agencyName }] as const]
        : []),
    ).values()];
  // 같은 샵을 여러 대행사가 취급하면 가격이 갈린다 — 그 차이가 이 카드의 핵심이라
  // 싼 곳부터 세운다. 대행사를 직접 고른 경우(agencyOrder)는 사용자가 정한 순서를
  // 존중해 그대로 둔다.
  const agencyLowestKrw = (agencyId: string): number => {
    const prices = (offersByAgency.get(agencyId) ?? [])
      .map((offer) => offer.minimumKrw)
      .filter((value): value is number => typeof value === "number");
    return prices.length > 0 ? Math.min(...prices) : Number.MAX_SAFE_INTEGER;
  };
  const displayedAgencies = agencyOrder
    ? agencyList
    : [...agencyList].sort((left, right) =>
      agencyLowestKrw(left.id) - agencyLowestKrw(right.id)
      || left.name.localeCompare(right.name, "ko-KR"));
  const displayedAgencyOffers = displayedAgencies.flatMap(
    (agency) => offersByAgency.get(agency.id) ?? [],
  );
  const displayedOffers = [...displayedAgencyOffers, ...directOffers];
  const optionCount = displayedOffers.reduce(
    (count, offer) => count + offerOptionCount(offer),
    0,
  );
  const needsLazyLoad = displayedOffers.some(
    (offer) => offer.options.length === 0 && (offer.optionCount ?? 0) > 0,
  );
  const loadLazyOptions = () => {
    if (!needsLazyLoad || lazyStatus === "loading" || lazyStatus === "ready") return;
    setLazyStatus("loading");
    loadVendorOptions(vendor)
      .then((resolved) => {
        setLazyOptions(resolved);
        setLazyStatus("ready");
      })
      .catch(() => setLazyStatus("error"));
  };
  const optionsForOffer = (offer: PriceOffer): PriceOption[] =>
    offer.options.length > 0 ? offer.options : lazyOptions?.get(offer.id) ?? [];
  // 대행사가 많으면 가로 컬럼은 대부분이 화면 밖으로 밀린다(9곳이면 1,512px).
  // 세로로 세우되 기본은 싼 곳 3개만 두고 나머지는 접는다.
  const AGENCY_PREVIEW_COUNT = 3;
  const hiddenAgencyCount = Math.max(0, displayedAgencies.length - AGENCY_PREVIEW_COUNT);
  const visibleAgencies = showAllAgencies
    ? displayedAgencies
    : displayedAgencies.slice(0, AGENCY_PREVIEW_COUNT);
  const agencyPriceSummary = aggregateOfferPriceLabel(displayedAgencyOffers);
  const showAgencySpread = displayedAgencies.length > 1 && agencyPriceSummary !== null;
  // 요약 가격은 **대행사 오퍼만** 가지고 만든다. 대행사 없는 행은 같은 축의 가격이
  // 아니라서 섞으면 없는 가격이 만들어진다 — 실측 2건: 루미디아는 예식장 문서의
  // "1벌당 30만~70만" 추가금이 최저가가 되어 "30만원부터"로 보였고(실제와 5배 차이),
  // 그가사랑하는순간은 "스드메 280만 패키지"가 스튜디오 단품가로 들어와 최고가를
  // 부풀렸다. 그 행들은 아래 별도 블록에서 원문 그대로 계속 보인다 — 지우는 게
  // 아니라 비교 축에서만 뺀다.
  const comparableDisplayedOffers = displayedOffers
    .filter((offer) => comparableOffers(vendor).some((row) => row.id === offer.id));
  // 섞일 것이 없으면 빼지 않는다. 대행사 오퍼가 하나도 없는 업체는 비교로 왜곡될
  // 상대가 없는데, 그때까지 "가격 확인 필요"로 덮으면 공시된 가격이 있는 업체를
  // 없다고 말하게 된다(그 행은 바로 아래에 원문 그대로 보인다).
  const aggregatePriceSummary = aggregateOfferPriceLabel(
    comparableDisplayedOffers.length > 0 ? comparableDisplayedOffers : displayedOffers,
  );
  const summaryPrice = aggregatePriceSummary
    ? aggregatePriceSummary
    : optionCount > 0
      ? `추가금 ${optionCount}개 공시`
      : "가격 확인 필요";
  const disclosureSourceSummary = displayedAgencies.length > 0 && directOffers.length > 0
    ? `대행사 ${displayedAgencies.length}곳 + 직접 공시`
    : displayedAgencies.length > 0
      ? `대행사 ${displayedAgencies.length}곳 공시`
        : directOffers.length > 0
          ? "업체 직접 공시"
          : "공시 가격 항목 없음";
  const regionCodes = vendorRegionCodes(vendor);
  const regionLabels = (regionCodes.length > 0 ? regionCodes : [null])
    .map((code) => priceRegionLabel(code));
  const primaryRegionLabel = regionLabels[0]!;
  const hiddenRegionCount = Math.max(0, regionLabels.length - 1);
  const fullRegionLabel = regionLabels.join(", ");
  const baseDetailHref = preview
    ? `/wedding/vendors/${vendor.id}?preview=1`
    : `/price/vendor/${vendor.slug}`;
  const detailHref = activeRegionCode
    ? `${baseDetailHref}${preview ? "&" : "?"}region=${encodeURIComponent(activeRegionCode)}`
    : baseDetailHref;

  useEffect(() => {
    if (preview) return;
    const element = cardRef.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const storageKey = `hb-price-impression:${vendor.id}`;
    try {
      if (sessionStorage.getItem(storageKey)) return;
    } catch {
      // The event remains best effort when storage is unavailable.
    }
    let timer: ReturnType<typeof setTimeout> | null = null;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && entry.intersectionRatio >= 0.5) {
        if (timer === null) {
          timer = setTimeout(() => {
            try { sessionStorage.setItem(storageKey, "1"); } catch { /* no-op */ }
            track("vendor_impression", {
              vendor_id: vendor.id,
              surface: "price_list",
              context: {
                category: vendor.category,
                ...(vendor.regionCode ? { region: vendor.regionCode } : {}),
              },
            });
            observer.disconnect();
          }, 1_000);
        }
      } else if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    }, { threshold: [0.5] });
    observer.observe(element);
    return () => {
      if (timer !== null) clearTimeout(timer);
      observer.disconnect();
    };
  }, [preview, vendor.category, vendor.id, vendor.regionCode]);

  return (
    <article
      ref={cardRef}
      className="flex min-w-0 max-w-full flex-col overflow-hidden rounded-[6px] border border-[var(--hb-primary)]/12 bg-white [overflow-wrap:anywhere] shadow-[var(--shadow-raised)]"
    >
      <div
        data-card-header="true"
        className="flex h-32 overflow-hidden items-start justify-between gap-4 px-4 py-4 sm:px-6"
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <VendorAvatar id={vendor.id} name={vendor.name} />
          <div className="flex min-w-0 flex-1 flex-col">
            <Link
              href={detailHref}
              title={vendor.name}
              prefetch={false}
              onClick={preview ? undefined : () => track("vendor_card_click", {
                vendor_id: vendor.id,
                surface: "price_list",
                context: { category: vendor.category },
              })}
              className="line-clamp-2 min-h-12 max-h-12 min-w-0 rounded-[6px] text-xl font-bold leading-6 tracking-normal text-[var(--hb-text-strong)] [overflow-wrap:anywhere] hover:text-[#8F6662] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]"
            >
              {vendor.name}
            </Link>
            {/* 병합된 업체는 여러 대행사 지역에서 닿는다 — 하나만 내세우면
                "부산 대행사로도 되는데 서울로만 보이는" 오해가 생긴다. */}
            <span
              role="group"
              data-card-regions="true"
              aria-label={`공시 지역: ${fullRegionLabel}`}
              title={fullRegionLabel}
              className="mt-1 inline-flex min-w-0 max-w-full items-center gap-1"
            >
              <span
                aria-hidden="true"
                className="inline-flex min-w-0 max-w-full truncate rounded-full bg-[var(--hb-primary)]/8 px-2 py-1 text-[11px] font-bold text-[var(--hb-text-strong)]/85"
              >
                {primaryRegionLabel}
              </span>
              {hiddenRegionCount > 0 ? (
                <span
                  aria-hidden="true"
                  className="inline-flex shrink-0 rounded-full bg-[#F5ECE4] px-2 py-1 text-[11px] font-bold text-[var(--color-rose-700)]"
                >
                  외 {hiddenRegionCount}곳
                </span>
              ) : null}
            </span>
            <p
              data-card-alias="true"
              title={vendor.aliases.length > 0
                ? `다른 표기 · ${vendor.aliases.join(", ")}`
                : undefined}
              className="mt-1 min-h-4 truncate text-xs text-[var(--hb-text-strong)]/70"
            >
              {vendor.aliases.length > 0
                ? `다른 표기 · ${vendor.aliases.join(", ")}`
                : null}
            </p>
            {/* 지점이 여럿인데 대행사가 지점을 안 적은 경우다. 합치지도 가르지도
                못하므로 그 사실을 적는다 — 실측상 이런 카드의 가격 범위는 서로 다른
                지점 가격을 한 줄로 합친 값이다. 판정이 아니라 관찰이다. */}
            {hasUnverifiedBranch(vendor.category, vendor.name) ? (
              <p className="mt-1 text-xs text-[var(--hb-text-muted)]">
                지점이 여러 곳이에요 — 공시에 지점이 안 적혀 있어 어느 지점 가격인지 확인되지 않았어요.
              </p>
            ) : null}
          </div>
        </div>
        {!preview ? (
          <button
            type="button"
            onClick={() => onToggleWishlist(vendor)}
            disabled={wishlistBusy}
            aria-busy={wishlistBusy}
            aria-label={isWishlisted ? `${vendor.name} 찜 해제` : `${vendor.name} 찜하기`}
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-[var(--hb-primary)]/12 bg-[var(--hb-surface-page)] text-[#8F6662] hover:bg-[#F5ECE4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B89785] disabled:cursor-wait disabled:opacity-55"
          >
            <Heart aria-hidden="true" className="size-5" fill={isWishlisted ? "currentColor" : "none"} />
          </button>
        ) : null}
      </div>

      <div
        role="group"
        aria-label={`${vendor.name} 공시 가격 요약`}
        className="h-28 overflow-hidden border-y border-[var(--hb-primary)]/10 bg-[var(--hb-surface-page)]/70 px-4 py-4 sm:px-6"
      >
        <p className="text-xs font-semibold text-[var(--hb-text-strong)]/75">공시 가격</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
          <p className="whitespace-nowrap text-xl font-bold tabular-nums tracking-normal text-[var(--hb-text-strong)]">
            {summaryPrice}
          </p>
          <p
            title={disclosureSourceSummary}
            className="max-w-full truncate whitespace-nowrap text-xs font-semibold leading-5 text-[var(--hb-text-strong)]/75"
          >
            {disclosureSourceSummary}
          </p>
        </div>
      </div>

      {displayedAgencies.length > 0 || directOffers.length > 0 ? (
        <details data-price-breakdown="true" className="group border-b border-[var(--hb-primary)]/10">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-[var(--hb-text-strong)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#B89785] sm:px-6">
            <span>가격 항목 {displayedOffers.length}개 보기</span>
            <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="bg-[var(--hb-surface-page)]/70">
            {displayedAgencies.length > 0 ? (
              <div role="region" aria-label={`${vendor.name} 대행사별 공시가`}>
                {/* 같은 샵인데 대행사마다 가격이 다르다는 사실은 요약 범위에서 먼저
                    보여주고, 긴 구성 원문은 사용자가 펼쳤을 때만 세로 목록으로 연다. */}
                {showAgencySpread ? (
                  <p className="border-y border-[var(--hb-primary)]/10 px-4 py-3 text-sm font-bold text-[var(--hb-text-strong)] sm:px-6">
                    {agencyPriceSummary}
                    <span className="ml-2 text-xs font-semibold text-[var(--hb-text-muted)]">
                      대행사 {displayedAgencies.length}곳 · 경로에 따라 다름
                    </span>
                  </p>
                ) : null}
                <ul className="divide-y divide-[var(--hb-primary)]/10">
                  {visibleAgencies.map((agency) => {
                    const agencyOffers = offersByAgency.get(agency.id) ?? [];
                    return (
                      <li key={agency.id} className="px-4 py-3 sm:px-6">
                        <p className="text-xs font-semibold text-[var(--hb-text-strong)]/75">{agency.name}</p>
                        {agencyOffers.length > 0 ? (
                          <div className="mt-1 space-y-1.5">
                            {agencyOffers.map((offer) => (
                              <div key={offer.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                                {offer.itemName && offer.itemName !== vendor.name ? (
                                  <p className="min-w-0 text-xs font-semibold leading-5 text-[var(--hb-text-strong)]/75">
                                    {offer.itemName}
                                  </p>
                                ) : <span />}
                                <p className="text-lg font-bold tabular-nums text-[var(--hb-text-strong)]">
                                  {offerPriceLabel(offer)}
                                </p>
                                {offer.priceNote ? (
                                  <p className="w-full text-xs leading-5 text-[var(--hb-text-muted)]">{offer.priceNote}</p>
                                ) : null}
                              </div>
                            ))}
                          </div>
                        ) : <p className="mt-1 text-lg font-bold text-[var(--hb-text-strong)]">—</p>}
                      </li>
                    );
                  })}
                </ul>
                {hiddenAgencyCount > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowAllAgencies((open) => !open)}
                    aria-expanded={showAllAgencies}
                    className="flex min-h-11 w-full items-center justify-center gap-1.5 border-t border-[var(--hb-primary)]/10 px-4 text-sm font-semibold text-[var(--hb-text-strong)] hover:bg-[#F5ECE4] sm:px-6"
                  >
                    {showAllAgencies ? "대행사 접기" : `대행사 ${hiddenAgencyCount}곳 더 보기`}
                    <ChevronDown
                      aria-hidden="true"
                      className={`size-4 transition-transform ${showAllAgencies ? "rotate-180" : ""}`}
                    />
                  </button>
                ) : null}
              </div>
            ) : null}

            {directOffers.length > 0 ? (
              <div className={`grid sm:grid-cols-2 ${displayedAgencies.length > 0 ? "border-t border-[var(--hb-primary)]/10" : ""}`}>
                {directOffers.map((offer) => (
                  <div key={offer.id} className="min-w-0 border-b border-[var(--hb-primary)]/10 px-4 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 sm:px-6">
                    {/* 이 행은 대행사 오퍼가 아니다(agencyId 없음). 실측상 전부
                        예식장 공시에서 온 패키지 구성이고, 기준이 달라 위 대행사
                        가격과 나란히 두면 없는 가격이 만들어진다. 앱이 아는 사실은
                        "대행사를 거치지 않았다"까지이므로 딱 거기까지만 적는다. */}
                    <p className="text-xs font-semibold text-[var(--hb-text-strong)]/75">대행사를 거치지 않은 공시</p>
                    {displayedAgencies.length > 0 ? (
                      <p className="mt-1 text-xs leading-5 text-[var(--hb-text-muted)]">
                        위 대행사 가격과 기준이 달라요. 그대로 비교하지 마세요.
                      </p>
                    ) : null}
                    {offer.itemName && offer.itemName !== vendor.name ? (
                      <p className="mt-1 text-xs font-semibold leading-5 text-[var(--hb-text-strong)]/75">
                        {offer.itemName}
                      </p>
                    ) : null}
                    <p className="mt-1 text-lg font-bold tabular-nums text-[var(--hb-text-strong)]">
                      {offerPriceLabel(offer)}
                    </p>
                    {offer.priceNote ? (
                      <p className="mt-1.5 text-xs leading-5 text-[var(--hb-text-muted)]">{offer.priceNote}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}

      {optionCount > 0 ? (
        <details
          data-add-on-breakdown="true"
          className="group border-b border-[var(--hb-primary)]/10"
          onToggle={(event) => {
            if (!event.currentTarget.open) return;
            loadLazyOptions();
            if (!preview) {
              track("addon_expand", {
                vendor_id: vendor.id,
                surface: "price_list",
                context: { category: vendor.category },
              });
            }
          }}
        >
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-[var(--hb-text-strong)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#B89785] sm:px-6">
            <span>추가금 {optionCount}개</span>
            <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-4 bg-[#F5ECE4]/45 px-4 py-4 sm:px-6">
            {needsLazyLoad && lazyStatus !== "ready" ? (
              <p className="flex items-center gap-2 text-sm text-[var(--hb-text-strong)]/70">
                {lazyStatus === "error" ? (
                  <>
                    추가금을 불러오지 못했어요.
                    <button
                      type="button"
                      onClick={loadLazyOptions}
                      className="font-semibold text-[var(--hb-text-strong)] underline underline-offset-2"
                    >
                      다시 시도
                    </button>
                  </>
                ) : (
                  <>
                    <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
                    공시 원문을 불러오는 중이에요…
                  </>
                )}
              </p>
            ) : null}
            {displayedOffers.flatMap((offer) => optionsForOffer(offer).map((option) => (
              <div key={`${offer.id}:${option.id}`} className="text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-[var(--hb-text-strong)]">{option.name}</span>
                  <span className="font-semibold tabular-nums text-[var(--hb-text-strong)]">
                    {krwRangeLabel(option.minimumKrw, option.maximumKrw)}
                  </span>
                </div>
                {option.condition || option.unit ? (
                  <p className="mt-1 text-xs leading-5 text-[var(--hb-text-strong)]/75">
                    {[option.unit, option.condition].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {option.rawText ? (
                  <p className="mt-1 text-xs leading-5 text-[var(--hb-text-strong)]/75">
                    공시 원문 · {option.rawText}
                  </p>
                ) : null}
                {option.isEffectivelyMandatory ? (
                  <span className="mt-2 inline-flex rounded-full bg-[#A43E3E]/10 px-2 py-1 text-[11px] font-bold text-[#A43E3E]">
                    사실상 필수
                  </span>
                ) : null}
              </div>
            )))}
          </div>
        </details>
      ) : (
        <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-[var(--hb-primary)]/10 px-4 py-2 sm:px-6">
          <span className="text-sm font-semibold text-[var(--hb-text-strong)]/70">추가금 공시 항목 없음</span>
          <span className="text-[11px] font-medium text-[var(--color-rose-700)]">추가금이 없다는 뜻은 아니에요</span>
        </div>
      )}

      {vendor.policies ? (
        vendor.policies.length > 0 ? (
          <details className="group border-b border-[var(--hb-primary)]/10">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#B89785] sm:px-6">
            <span className="flex flex-wrap gap-1.5">
              {[...new Set(vendor.policies.map(({ type }) => type))].map((type) => (
                <span
                  key={type}
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${pricePolicyBadgeClass(type)}`}
                >
                  {pricePolicyLabel(type)}
                </span>
              ))}
            </span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-[var(--hb-text-strong)] transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 bg-[var(--hb-surface-page)]/70 px-4 py-4 sm:px-6">
            {vendor.policies.map((policy) => {
              const content = policy.summary ?? policy.content;
              const previewContent = content.length > 300 ? `${content.slice(0, 300)}…` : content;
              return (
                <div key={policy.id} className="text-sm">
                  <p className="font-semibold text-[var(--hb-text-strong)]">
                    {policy.title ?? pricePolicyLabel(policy.type)}
                  </p>
                  <p className="mt-1 whitespace-pre-line leading-6 text-[var(--hb-text-strong)]/70">
                    {previewContent}
                  </p>
                </div>
              );
            })}
          </div>
          </details>
        ) : (
          <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 border-b border-[var(--hb-primary)]/10 px-4 py-2 sm:px-6">
            <span className="text-sm font-semibold text-[var(--hb-text-strong)]/70">계약 조건 공시 항목 없음</span>
            <span className="text-[11px] font-medium text-[var(--color-rose-700)]">조건이 없다는 뜻은 아니에요</span>
          </div>
        )
      ) : null}

      <div data-card-actions="true" className="mt-auto flex items-center gap-3 px-4 py-4 sm:px-6">
        <Link
          href={detailHref}
          // 목록에 카드가 수십 장이라 자동 프리페치가 상세 RSC를 무더기로 당겨온다.
          prefetch={false}
          onClick={preview ? undefined : () => track("vendor_card_click", {
            vendor_id: vendor.id,
            surface: "price_list",
            context: { category: vendor.category },
          })}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-[6px] border border-[var(--hb-primary)]/18 px-4 text-sm font-semibold text-[var(--hb-text-strong)] hover:bg-[#F5ECE4]/55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B89785]"
        >
          상세 보기
        </Link>
        {!preview && vendor.category !== "hall" && onOpenCombo ? (
          <button
            type="button"
            onClick={() => onOpenCombo(vendor)}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-[6px] bg-[var(--hb-action)] px-4 text-sm font-semibold text-white hover:bg-[var(--hb-action-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B89785]"
          >
            + 조합에 담기
          </button>
        ) : null}
      </div>
    </article>
  );
}
