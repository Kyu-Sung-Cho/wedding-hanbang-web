"use client";

import Link from "next/link";
import { ChevronDown, Heart } from "lucide-react";
import { useEffect, useRef } from "react";

import { track } from "@/lib/analytics/track";
import { krwRangeLabel } from "@/lib/format/krw";
import type { PriceVendor } from "@/lib/price/catalog";

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
  const optionCount = vendor.offers.reduce((count, offer) => count + offer.options.length, 0);
  const offersByAgency = new Map<string, typeof vendor.offers>();
  for (const offer of vendor.offers) {
    if (!offer.agencyId) continue;
    const agencyOffers = offersByAgency.get(offer.agencyId) ?? [];
    agencyOffers.push(offer);
    offersByAgency.set(offer.agencyId, agencyOffers);
  }
  const directOffers = vendor.offers.filter(({ agencyId }) => agencyId === null);
  const displayedAgencies = agencyOrder ?? [...new Map(
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
      className="min-w-0 max-w-full overflow-hidden rounded-[22px] border border-[#1D3557]/12 bg-white shadow-[0_12px_34px_rgba(29,53,87,0.055)]"
    >
      <div className="flex items-start justify-between gap-4 px-4 pb-4 pt-5 sm:px-6">
        <div className="min-w-0">
          <Link
            href={detailHref}
            onClick={preview ? undefined : () => track("vendor_card_click", {
              vendor_id: vendor.id,
              surface: "price_list",
              context: { category: vendor.category },
            })}
            className="rounded-sm text-xl font-bold tracking-[-0.025em] text-[#1D3557] hover:text-[#8F6662] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B5977A]"
          >
            {vendor.name}
          </Link>
          {vendor.aliases.length > 0 ? (
            <p className="mt-1 truncate text-xs text-[#1D3557]/55">
              (구. {vendor.aliases.join(", ")})
            </p>
          ) : null}
        </div>
        {!preview ? (
          <button
            type="button"
            onClick={() => onToggleWishlist(vendor)}
            disabled={wishlistBusy}
            aria-busy={wishlistBusy}
            aria-label={isWishlisted ? `${vendor.name} 찜 해제` : `${vendor.name} 찜하기`}
            className="flex size-11 shrink-0 items-center justify-center rounded-full border border-[#1D3557]/12 bg-[#FBF8F2] text-[#8F6662] hover:bg-[#F5ECE4] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B5977A] disabled:cursor-wait disabled:opacity-55"
          >
            <Heart aria-hidden="true" className="size-5" fill={isWishlisted ? "currentColor" : "none"} />
          </button>
        ) : null}
      </div>

      {displayedAgencies.length > 0 || directOffers.length > 0 ? (
        <div className="border-y border-[#1D3557]/10 bg-[#FBF8F2]/70">
          {displayedAgencies.length > 0 ? (
            <div
              role="region"
              aria-label={`${vendor.name} 대행사별 공시가`}
              tabIndex={0}
              className="max-w-full touch-pan-x overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#B5977A]"
            >
              <div className="grid w-max min-w-full grid-flow-col auto-cols-[minmax(10.5rem,1fr)]">
                {displayedAgencies.map((agency) => {
                  const agencyOffers = offersByAgency.get(agency.id) ?? [];
                  return (
                    <div key={agency.id} className="min-w-0 border-r border-[#1D3557]/10 px-4 py-4 last:border-r-0 sm:px-6">
                      <p className="truncate text-xs font-semibold text-[#1D3557]/65" title={agency.name}>
                        {agency.name}
                      </p>
                      {agencyOffers.length > 0 ? (
                        <div className="mt-1 divide-y divide-[#1D3557]/10">
                          {agencyOffers.map((offer) => (
                            <div key={offer.id} className="py-1 first:pt-0 last:pb-0">
                              {offer.itemName ? (
                                <p className="text-xs font-semibold leading-5 text-[#1D3557]/65">
                                  {offer.itemName}
                                </p>
                              ) : null}
                              <p className="text-lg font-bold tabular-nums text-[#1D3557]">
                                {krwRangeLabel(offer.minimumKrw, offer.maximumKrw)}
                              </p>
                              {offer.priceNote ? (
                                <p className="mt-1.5 text-xs leading-5 text-[#1D3557]/60">{offer.priceNote}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : <p className="mt-1 text-lg font-bold text-[#1D3557]">—</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {directOffers.length > 0 ? (
            <div className={`grid sm:grid-cols-2 ${displayedAgencies.length > 0 ? "border-t border-[#1D3557]/10" : ""}`}>
              {directOffers.map((offer) => (
                <div key={offer.id} className="min-w-0 border-b border-[#1D3557]/10 px-4 py-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 sm:px-6">
                  <p className="text-xs font-semibold text-[#1D3557]/65">업체 직접 공시</p>
                  {offer.itemName ? (
                    <p className="mt-1 text-xs font-semibold leading-5 text-[#1D3557]/65">
                      {offer.itemName}
                    </p>
                  ) : null}
                  <p className="mt-1 text-lg font-bold tabular-nums text-[#1D3557]">
                    {krwRangeLabel(offer.minimumKrw, offer.maximumKrw)}
                  </p>
                  {offer.priceNote ? (
                    <p className="mt-1.5 text-xs leading-5 text-[#1D3557]/60">{offer.priceNote}</p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {optionCount > 0 ? (
        <details
          className="group border-b border-[#1D3557]/10"
          onToggle={(event) => {
            if (!preview && event.currentTarget.open) {
              track("addon_expand", {
                vendor_id: vendor.id,
                surface: "price_list",
                context: { category: vendor.category },
              });
            }
          }}
        >
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold text-[#1D3557] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#B5977A] sm:px-6">
            <span>추가금 {optionCount}개</span>
            <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-4 bg-[#F5ECE4]/45 px-4 py-4 sm:px-6">
            {vendor.offers.flatMap((offer) => offer.options.map((option) => (
              <div key={`${offer.id}:${option.id}`} className="text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-[#1D3557]">{option.name}</span>
                  <span className="font-semibold tabular-nums text-[#1D3557]">
                    {krwRangeLabel(option.minimumKrw, option.maximumKrw)}
                  </span>
                </div>
                {option.condition || option.unit ? (
                  <p className="mt-1 text-xs leading-5 text-[#1D3557]/65">
                    {[option.unit, option.condition].filter(Boolean).join(" · ")}
                  </p>
                ) : null}
                {option.rawText ? (
                  <p className="mt-1 text-xs leading-5 text-[#1D3557]/65">
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

      <div className="flex items-center gap-3 px-4 py-4 sm:px-6">
        <Link
          href={detailHref}
          onClick={preview ? undefined : () => track("vendor_card_click", {
            vendor_id: vendor.id,
            surface: "price_list",
            context: { category: vendor.category },
          })}
          className="inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-[#1D3557]/18 px-4 text-sm font-semibold text-[#1D3557] hover:bg-[#F5ECE4]/55 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B5977A]"
        >
          상세 보기
        </Link>
        {!preview && vendor.category !== "hall" && onOpenCombo ? (
          <button
            type="button"
            onClick={() => onOpenCombo(vendor)}
            className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-full bg-[#1D3557] px-4 text-sm font-semibold text-white hover:bg-[#142844] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B5977A]"
          >
            + 조합에 담기
          </button>
        ) : null}
      </div>
    </article>
  );
}
