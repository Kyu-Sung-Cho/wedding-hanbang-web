"use client";

import Link from "next/link";
import { AlertCircle, ArrowRight, Heart, LoaderCircle, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useUserScopedClientActor } from "@/components/common/UserScopedClientStateBoundary";
import { expectedActorHeaders } from "@/lib/auth/actorFence";
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

const EMPTY_FAVORITE_IDS: string[] = [];

function favoriteIdsFromResponse(value: unknown): string[] | null {
  if (!value || typeof value !== "object") return null;
  const vendorIds = (value as FavoritesResponse).vendorIds;
  if (!Array.isArray(vendorIds) || !vendorIds.every((id) => typeof id === "string")) {
    return null;
  }
  return [...new Set(vendorIds)];
}

export function PriceWishlist({ catalog }: { catalog: PriceCatalog }) {
  const actor = useUserScopedClientActor();
  const actorKey = actor.status === "ready" ? actor.actorKey : null;
  const actorUserId = actor.status === "ready" && actor.kind === "user" ? actor.userId : null;
  const [status, setStatus] = useState<WishlistStatus>("loading");
  const [stateActorKey, setStateActorKey] = useState<string | null>(null);
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState("");
  const [loadRevision, setLoadRevision] = useState(0);
  const favoriteBusy = useRef(new Set<string>());
  const actorKeyRef = useRef(actorKey);
  const loadGenerationRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const mutationControllersRef = useRef(new Map<string, AbortController>());
  actorKeyRef.current = actorKey;
  const canUsePrivateState = actorKey !== null && stateActorKey === actorKey;
  const currentStatus: WishlistStatus = canUsePrivateState ? status : "loading";
  const currentFavoriteIds = canUsePrivateState ? favoriteIds : EMPTY_FAVORITE_IDS;
  const currentFeedback = canUsePrivateState ? feedback : "";

  useEffect(() => {
    track("page_view", {
      surface: "price_list",
      context: { category: "wishlist" },
    });
  }, []);

  useEffect(() => {
    loadAbortRef.current?.abort();
    for (const mutationController of mutationControllersRef.current.values()) mutationController.abort();
    mutationControllersRef.current.clear();
    favoriteBusy.current.clear();
    setBusyIds(new Set());
    setFeedback("");
    if (!actorKey) {
      loadGenerationRef.current += 1;
      setStateActorKey(null);
      setFavoriteIds([]);
      setStatus("loading");
      return;
    }

    const controller = new AbortController();
    loadAbortRef.current = controller;
    const requestedActorKey = actorKey;
    const generation = ++loadGenerationRef.current;
    const isCurrentRequest = () => (
      !controller.signal.aborted
      && actorKeyRef.current === requestedActorKey
      && loadGenerationRef.current === generation
    );
    setStateActorKey(requestedActorKey);
    setFavoriteIds([]);
    setStatus("loading");

    void mobileAuthenticatedFetch("/api/favorites", {
      cache: "no-store",
      signal: controller.signal,
    }).then(async (response) => {
      if (!isCurrentRequest()) return;
      if (response.status === 401) {
        setFavoriteIds([]);
        setStatus("guest");
        return;
      }
      if (!response.ok) throw new Error("FAVORITES_UNAVAILABLE");
      const ids = favoriteIdsFromResponse(await response.json());
      if (!isCurrentRequest()) return;
      if (!ids) throw new Error("FAVORITES_INVALID_RESPONSE");
      setFavoriteIds(ids);
      setStatus("ready");
    }).catch((error: unknown) => {
      if (isCurrentRequest() && !(error instanceof DOMException && error.name === "AbortError")) {
        setStatus("error");
      }
    });

    return () => {
      controller.abort();
      if (loadGenerationRef.current === generation) loadGenerationRef.current += 1;
    };
  }, [actorKey, loadRevision]);

  const groups = useMemo(
    () => selectOfficialWishlistedVendors(catalog, currentFavoriteIds),
    [catalog, currentFavoriteIds],
  );
  const total = groups.reduce((count, group) => count + group.vendors.length, 0);

  const retry = useCallback(() => {
    setFeedback("");
    setLoadRevision((revision) => revision + 1);
  }, []);

  const removeFavorite = useCallback(async (vendor: PriceVendor) => {
    if (!actorKey || !canUsePrivateState || currentStatus !== "ready") return;
    if (favoriteBusy.current.has(vendor.id)) return;
    const requestedActorKey = actorKey;
    const requestedGeneration = loadGenerationRef.current;
    const controller = new AbortController();
    const isCurrentMutation = () => (
      !controller.signal.aborted
      && actorKeyRef.current === requestedActorKey
      && loadGenerationRef.current === requestedGeneration
      && mutationControllersRef.current.get(vendor.id) === controller
    );
    favoriteBusy.current.add(vendor.id);
    mutationControllersRef.current.set(vendor.id, controller);
    setFeedback("");
    setBusyIds((current) => new Set(current).add(vendor.id));
    try {
      const response = await mobileAuthenticatedFetch("/api/favorites", {
        method: "DELETE",
        credentials: "same-origin",
        headers: {
          "content-type": "application/json",
          ...(actorUserId ? expectedActorHeaders(actorUserId) : {}),
        },
        body: JSON.stringify({ vendorId: vendor.id }),
        signal: controller.signal,
      });
      if (!isCurrentMutation()) return;
      if (response.status === 401) {
        setStatus("guest");
        return;
      }
      if (!response.ok) throw new Error("FAVORITE_REMOVE_FAILED");
      const body = await response.json() as { isFavorite?: unknown };
      if (!isCurrentMutation()) return;
      if (body.isFavorite !== false) throw new Error("FAVORITE_REMOVE_NOT_CONFIRMED");
      setFavoriteIds((current) => current.filter((id) => id !== vendor.id));
    } catch (error: unknown) {
      if (!isCurrentMutation() || (error instanceof DOMException && error.name === "AbortError")) return;
      setFeedback("찜을 해제하지 못했어요. 잠시 후 다시 시도해 주세요.");
    } finally {
      if (mutationControllersRef.current.get(vendor.id) === controller) {
        mutationControllersRef.current.delete(vendor.id);
        favoriteBusy.current.delete(vendor.id);
        setBusyIds((current) => {
          const next = new Set(current);
          next.delete(vendor.id);
          return next;
        });
      }
    }
  }, [actorKey, actorUserId, canUsePrivateState, currentStatus]);

  return (
    <main className="min-h-screen bg-[#FBF8F2] px-4 pb-16 pt-10 text-[#243832] sm:px-6 sm:pt-14">
      <div className="mx-auto max-w-4xl">
        <header className="mb-7">
          <p className="text-xs font-bold tracking-[0.13em] text-[#8F6662]">
            한국소비자원 참가격 공시
          </p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-3xl font-bold tracking-[-0.035em] sm:text-4xl">
                찜한 공식 가격 업체
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-[#243832]/70">
                공식 가격이 공개된 업체만 한곳에서 비교해요. 찜 기록에 있어도 현재 공개 카탈로그에 없는 업체는 표시하지 않아요.
              </p>
            </div>
            {currentStatus === "ready" ? (
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
                className="flex min-h-12 items-center justify-between rounded-2xl border border-[#243832]/10 bg-white px-4 text-sm"
              >
                <span className="font-semibold">{PRICE_CATEGORY_LABELS[category]}</span>
                <span className="tabular-nums text-[#243832]/55">{currentStatus === "ready" ? count : "–"}</span>
              </div>
            );
          })}
        </div>

        {currentStatus === "loading" ? (
          <section
            aria-live="polite"
            className="flex min-h-64 items-center justify-center rounded-[24px] border border-[#243832]/10 bg-white"
          >
            <div className="text-center">
              <LoaderCircle aria-hidden="true" className="mx-auto size-7 animate-spin text-[#8F6662]" />
              <p className="mt-3 text-sm font-semibold">찜한 업체를 불러오고 있어요</p>
            </div>
          </section>
        ) : null}

        {currentStatus === "guest" ? (
          <StateCard
            icon={<Heart aria-hidden="true" className="size-6" />}
            title="로그인하면 찜한 업체를 이어서 볼 수 있어요"
            description="저장한 공식 가격 업체를 기기와 상관없이 안전하게 불러와요."
          >
            <Link
              href="/login?redirect=%2Fprice%2Fwishlist"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#36534E] px-5 text-sm font-bold text-white hover:bg-[#2B423E] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]"
            >
              로그인하고 보기
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </StateCard>
        ) : null}

        {currentStatus === "error" ? (
          <StateCard
            icon={<AlertCircle aria-hidden="true" className="size-6" />}
            title="찜한 업체를 불러오지 못했어요"
            description="저장된 찜에는 영향이 없어요. 연결을 확인한 뒤 다시 불러와 주세요."
          >
            <button
              type="button"
              onClick={retry}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#36534E] px-5 text-sm font-bold text-white hover:bg-[#2B423E] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]"
            >
              <RefreshCw aria-hidden="true" className="size-4" />
              다시 불러오기
            </button>
          </StateCard>
        ) : null}

        {currentStatus === "ready" && total === 0 ? (
          <StateCard
            icon={<Heart aria-hidden="true" className="size-6" />}
            title="공식 가격 업체를 아직 찜하지 않았어요"
            description="스튜디오·드레스·메이크업·웨딩홀의 공개 가격을 비교하고 마음에 드는 업체를 저장해 보세요."
          >
            <Link
              href="/price/studio"
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[#36534E] px-5 text-sm font-bold text-white hover:bg-[#2B423E] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]"
            >
              공식 가격 둘러보기
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </StateCard>
        ) : null}

        {currentStatus === "ready" && total > 0 ? (
          <div className="space-y-9">
            {groups.map(({ category, vendors }) => (
              <section key={category} aria-labelledby={`wishlist-${category}`}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 id={`wishlist-${category}`} className="text-lg font-bold">
                    {PRICE_CATEGORY_LABELS[category]}
                  </h2>
                  <span className="text-sm tabular-nums text-[#243832]/55">{vendors.length}개</span>
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
                  <div className="rounded-[20px] border border-dashed border-[#243832]/15 bg-white/55 px-5 py-5 text-sm text-[#243832]/60">
                    이 카테고리에 찜한 공식 가격 업체가 없어요.
                  </div>
                )}
              </section>
            ))}
          </div>
        ) : null}

        {currentFeedback ? (
          <p role="alert" className="mt-5 rounded-2xl bg-[#A43E3E]/8 px-4 py-3 text-sm font-semibold text-[#A43E3E]">
            {currentFeedback}
          </p>
        ) : null}

        <div className="mt-10 overflow-hidden rounded-[20px] border border-[#243832]/10 bg-white">
          <PriceDisclosureFooter />
        </div>
      </div>
    </main>
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
    <section className="rounded-[24px] border border-[#243832]/10 bg-white px-5 py-10 text-center shadow-[0_12px_34px_rgba(36,56,50,0.055)] sm:px-8">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-[#F5ECE4] text-[#8F6662]">
        {icon}
      </span>
      <h2 className="mt-5 text-xl font-bold tracking-[-0.02em]">{title}</h2>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[#243832]/70">{description}</p>
      <div className="mt-6">{children}</div>
    </section>
  );
}
