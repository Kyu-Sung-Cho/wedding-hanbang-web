"use client";

import Link from "next/link";
import { ChevronDown, Heart, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { track } from "@/lib/analytics/track";
import { krwRangeLabel } from "@/lib/format/krw";
import {
  offerOptionCount,
  pricePolicyBadgeClass,
  pricePolicyLabel,
  type PriceOffer,
  type PriceOption,
  type PriceVendor,
} from "@/lib/price/catalog";
import { priceRegionLabel } from "@/lib/price/labels";
import { VendorAvatar } from "./VendorAvatar";
import { loadVendorOptions } from "./vendorOptionsClient";

// 기본가 없이 옵션만 공시된 행(예: 예식장 "○○홀 옵션")은 "가격 확인 필요" 대신
// 옵션이 아래 추가금 목록에 있음을 안내한다 — 가격이 실제로는 공개돼 있기 때문.
function offerPriceLabel(offer: PriceOffer): string {
  const optionTotal = offerOptionCount(offer);
  if (offer.minimumKrw === null && offer.maximumKrw === null && optionTotal > 0) {
    return `추가금 ${optionTotal}개 참조`;
  }
  return krwRangeLabel(offer.minimumKrw, offer.maximumKrw);
}

type PriceVendorCardProps = {
  vendor: PriceVendor;
  agencyOrder?: readonly { id: string; name: string }[];
  isWishlisted: boolean;
  wishlistBusy?: boolean;
  preview?: boolean;
  onToggleWishlist(vendor: PriceVendor): void;
  onOpenCombo?(vendor: PriceVendor): void;
};

export function PriceVendorCard({
  vendor,
  agencyOrder,
  isWishlisted,
  wishlistBusy = false,
  preview = false,
  onToggleWishlist,
  onOpenCombo,
}: PriceVendorCardProps) {
  const cardRef = useRef<HTMLElement>(null);
  const optionCount = vendor.offers.reduce((count, offer) => count + offerOptionCount(offer), 0);
  // 슬림 카탈로그(옵션 본문 미탑재)의 지연 로드 상태 — 펼칠 때 1회 조회, 모듈 캐시 공유.
  const [lazyOptions, setLazyOptions] = useState<Map<string, PriceOption[]> | null>(null);
  const [lazyStatus, setLazyStatus] = useState<"idle" | "loading" | "error" | "ready">("idle");
  const needsLazyLoad = vendor.offers.some(
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
  const displayedAgencies = agencyOrder
    ? agencyOrder.filter((agency) => offersByAgency.has(agency.id))
    : [...new Map(
      vendor.offers.flatMap((offer) => offer.agencyId
        ? [[offer.agencyId, { id: offer.agencyId, name: offer.agencyName }] as const]
        : []),
    ).values()];
  const detailHref = preview
    ? `/wedding/vendors/${vendor.id}?preview=1`
    : `/price/vendor/${vendor.slug}`;

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
      className="min-w-0 max-w-full overflow-hidden rounded-[22px] border border-[#243832]/12 bg-white shadow-[0_12px_34px_rgba(36,56,50,0.055)]"
    >
      <div className="flex items-start justify-between gap-4 px-4 pb-4 pt-5 sm:px-6">
        <div className="flex min-w-0 items-start gap-3">
          <VendorAvatar id={vendor.id} name={vendor.name} />
          <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={detailHref}
              onClick={preview ? undefined : () => track("vendor_card_click", {
                vendor_id: vendor.id,
                surface: "price_list",
                context: { category: vendor.category },
              })}
              className="rounded-sm text-xl font-bold tracking-[-0.025em] text-[#243832] hover:text-[#8F6662] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]"
            >
              {vendor.name}
            </Link>
            <span className="inline-flex rounded-full bg-[#36534E]/8 px-2 py-1 text-[11px] font-bold text-[#36534E]/75">
              {priceRegionLabel(vendor.regionCode)}
            </span>
          </div>
          {vendor.aliases.length > 0 ? (
            <p className="mt-1 truncate text-xs text-[#243832]/55">
              (구. {vendor.aliases.join(", ")})
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
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-[#243832]/12 bg-[#FBF8F2] text-[#8F6662] hover:bg-[#F5ECE4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B89785] disabled:cursor-wait disabled:opacity-55"
          >
            <Heart aria-hidden="true" className="size-5" fill={isWishlisted ? "currentColor" : "none"} />
          </button>
        ) : null}
      </div>

      {displayedAgencies.length > 0 || directOffers.length > 0 ? (
        <div className="border-y border-[#243832]/10 bg-[#FBF8F2]/70">
          {displayedAgencies.length > 0 ? (
            <div
              role="region"
              aria-label={`${vendor.name} 대행사별 공시가`}
              tabIndex={0}
              className="max-w-full touch-pan-x overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#B89785]"
            >
              <div className="grid w-max min-w-full grid-flow-col auto-cols-[minmax(10.5rem,1fr)]">
                {displayedAgencies.map((agency) => {
                  const agencyOffers = offersByAgency.get(agency.id) ?? [];
                  return (
                    <div key={agency.id} className="min-w-0 border-r border-[#243832]/10 px-4 py-4 last:border-r-0 sm:px-6">
                      <p className="truncate text-xs font-semibold text-[#243832]/65" title={agency.name}>
                        {agency.name}
                      </p>
                      {agencyOffers.length > 0 ? (
                        <div className="mt-1 divide-y divide-[#243832]/10">
                          {agencyOffers.map((offer) => (
                            <div key={offer.id} className="py-1 first:pt-0 last:pb-0">
                              {offer.itemName && offer.itemName !== vendor.name ? (
                                <p className="text-xs font-semibold leading-5 text-[#243832]/65">
                                  {offer.itemName}
                                </p>
                              ) : null}
                              <p className="text-lg font-bold tabular-nums text-[#243832]">
                                {offerPriceLabel(offer)}
                              </p>
                              {offer.priceNote ? (
                                <p className="mt-1.5 text-xs leading-5 text-[#243832]/60">{offer.priceNote}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : <p className="mt-1 text-lg font-bold text-[#243832]">—</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {directOffers.length > 0 ? (
            <div className={`grid sm:grid-cols-2 ${displayedAgencies.length > 0 ? "border-t border-[#243832]/10" : ""}`}>
              {directOffers.map((offer) => (
                <div key={offer.id} className="min-w-0 border-b border-[#243832]/10 px-4 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 sm:px-6">
                  <p className="text-xs font-semibold text-[#243832]/65">업체 직접 공시</p>
                  {offer.itemName && offer.itemName !== vendor.name ? (
                    <p className="mt-1 text-xs font-semibold leading-5 text-[#243832]/65">
                      {offer.itemName}
                    </p>
                  ) : null}
                  <p className="mt-1 text-lg font-bold tabular-nums text-[#243832]">
                    {offerPriceLabel(offer)}
                  </p>
                  {offer.priceNote ? (
                    <p className="mt-1.5 text-xs leading-5 text-[#243832]/60">{offer.priceNote}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {optionCount > 0 ? (
        <details
          className="group border-b border-[#243832]/10"
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
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-[#243832] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#B89785] sm:px-6">
            <span>추가금 {optionCount}개</span>
            <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-4 bg-[#F5ECE4]/45 px-4 py-4 sm:px-6">
            {needsLazyLoad && lazyStatus !== "ready" ? (
              <p className="flex items-center gap-2 text-sm text-[#243832]/70">
                {lazyStatus === "error" ? (
                  <>
                    추가금을 불러오지 못했어요.
                    <button
                      type="button"
                      onClick={loadLazyOptions}
                      className="font-semibold text-[#36534E] underline underline-offset-2"
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
            {vendor.offers.flatMap((offer) => optionsForOffer(offer).map((option) => (
              <div key={`${offer.id}:${option.id}`} className="text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-[#243832]">{option.name}</span>
                  <span className="font-semibold tabular-nums text-[#243832]">
                    {krwRangeLabel(option.minimumKrw, option.maximumKrw)}
                  </span>
                </div>
                {option.condition || option.unit ? (
                  <p className="mt-1 text-xs leading-5 text-[#243832]/65">
                    {[option.unit, option.condition].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {option.rawText ? (
                  <p className="mt-1 text-xs leading-5 text-[#243832]/65">
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
      ) : null}

      {vendor.policies?.length ? (
        <details className="group border-b border-[#243832]/10">
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
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-[#243832] transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-3 bg-[#FBF8F2]/70 px-4 py-4 sm:px-6">
            {vendor.policies.map((policy) => {
              const content = policy.summary ?? policy.content;
              const previewContent = content.length > 300 ? `${content.slice(0, 300)}…` : content;
              return (
                <div key={policy.id} className="text-sm">
                  <p className="font-semibold text-[#243832]">
                    {policy.title ?? pricePolicyLabel(policy.type)}
                  </p>
                  <p className="mt-1 whitespace-pre-line leading-6 text-[#243832]/70">
                    {previewContent}
                  </p>
                </div>
              );
            })}
          </div>
        </details>
      ) : null}

      <div className="flex items-center gap-3 px-4 py-4 sm:px-6">
        <Link
          href={detailHref}
          // 목록에 카드가 수십 장이라 자동 프리페치가 상세 RSC를 무더기로 당겨온다.
          prefetch={false}
          onClick={preview ? undefined : () => track("vendor_card_click", {
            vendor_id: vendor.id,
            surface: "price_list",
            context: { category: vendor.category },
          })}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-[#243832]/18 px-4 text-sm font-semibold text-[#243832] hover:bg-[#F5ECE4]/55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B89785]"
        >
          상세 보기
        </Link>
        {!preview && vendor.category !== "hall" && onOpenCombo ? (
          <button
            type="button"
            onClick={() => onOpenCombo(vendor)}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-full bg-[#36534E] px-4 text-sm font-semibold text-white hover:bg-[#2B423E] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B89785]"
          >
            + 조합에 담기
          </button>
        ) : null}
      </div>
    </article>
  );
}
