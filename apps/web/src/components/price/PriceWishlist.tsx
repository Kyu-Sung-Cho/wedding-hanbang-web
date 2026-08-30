"use client";

import Link from "next/link";
import { AlertCircle, ArrowRight, Heart, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { track } from "@/lib/analytics/track";
import { mobileAuthenticatedFetch } from "@/lib/mobile/mobileAuthenticatedFetch";
import {
  PRICE_CATEGORIES,
  type PriceCatalog,
  type PriceVendor,
} from "@/lib/price/catalog";
import { PRICE_CATEGORY_LABELS } from "@/lib/price/labels";
import { selectOfficialWishlistedVendors } from "@/lib/price/wishlist";

import { PriceDisclosureFooter } from "./PriceDisclosureFooter";
import { PriceVendorCard } from "./PriceVendorCard";

type WishlistStatus = "loading" | "ready" | "guest" | "error";

type FavoritesResponse = {
  vendorIds?: unknown;
};

function favoriteIdsFromResponse(value: unknown): string[] | null {
  if (!value || typeof value !== "object") return null;
  const vendorIds = (value as FavoritesResponse).vendorIds;
  if (!Array.isArray(vendorIds) || !vendorIds.every((id) => typeof id === "string")) {
    return null;
  }
  return [...new Set(vendorIds)];
}

export function PriceWishlist({ catalog }: { catalog: PriceCatalog }) {
  const [status, setStatus] = useState<WishlistStatus>("loading");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState("");
  const [loadRevision, setLoadRevision] = useState(0);
  const favoriteBusy = useRef(new Set<string>());

  useEffect(() => {
    track("page_view", {
      surface: "price_list",
      context: { category: "wishlist" },
    });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setStatus("loading");

    void mobileAuthenticatedFetch("/api/favorites", {
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      if (response.status === 401) {
        setFavoriteIds([]);
        setStatus("guest");
        return;
      }
      if (!response.ok) throw new Error("FAVORITES_UNAVAILABLE");
      const ids = favoriteIdsFromResponse(await response.json());
      if (!ids) throw new Error("FAVORITES_INVALID_RESPONSE");
      setFavoriteIds(ids);
      setStatus("ready");
    }).catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus("error");
    });

    return () => controller.abort();
  }, [loadRevision]);

  const groups = useMemo(
    () => selectOfficialWishlistedVendors(catalog, favoriteIds),
    [catalog, favoriteIds],
  );
  const total = groups.reduce((count, group) => count + group.vendors.length, 0);

  const retry = useCallback(() => {
    setFeedback("");
    setLoadRevision((revision) => revision + 1);
  }, []);

  const removeFavorite = useCallback(async (vendor: PriceVendor) => {
    if (favoriteBusy.current.has(vendor.id)) return;
    favoriteBusy.current.add(vendor.id);
    setFeedback("");
    setBusyIds((current) => new Set(current).add(vendor.id));
    try {
      const response = await mobileAuthenticatedFetch("/api/favorites", {
        method: "DELETE",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vendorId: vendor.id }),
      });
      if (response.status === 401) {
        setStatus("guest");
        return;
      }
      if (!response.ok) throw new Error("FAVORITE_REMOVE_FAILED");
      const body = await response.json() as { isFavorite?: unknown };
      if (body.isFavorite !== false) throw new Error("FAVORITE_REMOVE_NOT_CONFIRMED");
      setFavoriteIds((current) => current.filter((id) => id !== vendor.id));
    } catch {
      setFeedback("찜을 해제하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      favoriteBusy.current.delete(vendor.id);
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(vendor.id);
        return next;
      });
    }
  }, []);

  return (
    <div className="min-h-screen bg-[var(--hb-surface-page)] px-4 pb-16 pt-10 text-[var(--hb-text-strong)] sm:px-6 sm:pt-14">
      <div className="mx-auto max-w-4xl">
        <header className="mb-7">
          <p className="text-xs font-bold tracking-[0.13em] text-[var(--color-rose-700)]">
            한국소비자원 참가격 공시
          </p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold tracking-normal sm:text-4xl">
                찜한 공식 가격 업체
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[var(--hb-text-strong)]/70">
                공식 가격이 공개된 업체만 한곳에서 비교해요. 찜 기록에 있어도 현재 공개 카탈로그에 없는 업체는 표시하지 않아요.
              </p>
            </div>
            {status === "ready" ? (
              <span className="rounded-full bg-[#F5ECE4] px-3 py-1.5 text-sm font-bold text-[#8F6662]">
                {total}개 저장됨
              </span>
            ) : null}
          </div>
        </header>

        <div
          aria-label="찜 카테고리 현황"
          className="mb-7 grid grid-cols-2 gap-2 sm:grid-cols-4"
        >
          {PRICE_CATEGORIES.map((category) => {
            const count = groups.find((group) => group.category === category)?.vendors.length ?? 0;
            return (
              <div
                key={category}
                className="flex min-h-12 items-center justify-between rounded-2xl border border-[var(--hb-primary)]/10 bg-white px-4 text-sm"
              >
                <span className="font-semibold">{PRICE_CATEGORY_LABELS[category]}</span>
                <span className="tabular-nums text-[var(--hb-text-strong)]/75">{status === "ready" ? count : "–"}</span>
              </div>
            );
          })}
        </div>

        {status === "loading" ? (
          <section
            aria-live="polite"
            className="flex min-h-64 items-center justify-center rounded-[24px] border border-[var(--hb-primary)]/10 bg-white"
          >
            <div className="text-center">
              <LoaderCircle aria-hidden="true" className="mx-auto size-7 animate-spin text-[#8F6662]" />
              <p className="mt-3 text-sm font-semibold">찜한 업체를 불러오고 있어요</p>
            </div>
          </section>
        ) : null}

        {status === "guest" ? (
          <StateCard
            icon={<Heart aria-hidden="true" className="size-6" />}
            title="로그인하면 찜한 업체를 이어서 볼 수 있어요"
            description="저장한 공식 가격 업체를 기기와 상관없이 안전하게 불러와요."
          >
            <Link
              href="/login?redirect=%2Fprice%2Fwishlist"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-5 text-sm font-bold text-white hover:bg-[var(--hb-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]"
            >
              로그인하고 보기
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </StateCard>
        ) : null}

        {status === "error" ? (
          <StateCard
            icon={<AlertCircle aria-hidden="true" className="size-6" />}
            title="찜한 업체를 불러오지 못했어요"
            description="저장된 찜에는 영향이 없어요. 연결을 확인한 뒤 다시 불러와 주세요."
          >
            <button
              type="button"
              onClick={retry}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-5 text-sm font-bold text-white hover:bg-[var(--hb-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]"
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              다시 불러오기
            </button>
          </StateCard>
        ) : null}

        {status === "ready" && total === 0 ? (
          <StateCard
            icon={<Heart aria-hidden="true" className="size-6" />}
            title="공식 가격 업체를 아직 찜하지 않았어요"
            description="스튜디오·드레스·메이크업·웨딩홀의 공개 가격을 비교하고 마음에 드는 업체를 저장해 보세요."
          >
            <Link
              href="/price/studio"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[6px] bg-[var(--hb-primary)] px-5 text-sm font-bold text-white hover:bg-[var(--hb-primary-hover)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]"
            >
              공식 가격 둘러보기
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </StateCard>
        ) : null}

        {status === "ready" && total > 0 ? (
          <div className="space-y-9">
            {groups.map(({ category, vendors }) => (
              <section key={category} aria-labelledby={`wishlist-${category}`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 id={`wishlist-${category}`} className="text-lg font-bold">
                    {PRICE_CATEGORY_LABELS[category]}
                  </h2>
                  <span className="text-sm tabular-nums text-[var(--hb-text-strong)]/75">{vendors.length}개</span>
                </div>
                {vendors.length > 0 ? (
                  <div className="space-y-4">
                    {vendors.map((vendor) => (
                      <PriceVendorCard
                        key={vendor.id}
                        vendor={vendor}
                        isWishlisted
                        wishlistBusy={busyIds.has(vendor.id)}
                        onToggleWishlist={removeFavorite}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rounded-[20px] border border-dashed border-[var(--hb-primary)]/15 bg-white/55 px-5 py-5 text-sm text-[var(--hb-text-strong)]/60">
                    이 카테고리에 찜한 공식 가격 업체가 없어요.
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : null}

        {feedback ? (
          <p role="alert" className="mt-5 rounded-2xl bg-[#A43E3E]/8 px-4 py-3 text-sm font-semibold text-[#A43E3E]">
            {feedback}
          </p>
        ) : null}

        <div className="mt-10 overflow-hidden rounded-[20px] border border-[var(--hb-primary)]/10 bg-white">
          <PriceDisclosureFooter />
        </div>
      </div>
    </div>
  );
}

function StateCard({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[24px] border border-[var(--hb-primary)]/10 bg-white px-5 py-10 text-center shadow-[0_12px_34px_rgba(36,56,50,0.055)] sm:px-8">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-[#F5ECE4] text-[#8F6662]">
        {icon}
      </span>
      <h2 className="mt-5 text-xl font-bold tracking-normal">{title}</h2>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[var(--hb-text-strong)]/70">{description}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}
