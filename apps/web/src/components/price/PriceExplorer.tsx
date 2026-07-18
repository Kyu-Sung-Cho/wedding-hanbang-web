"use client";

import Link from "next/link";
import {
  Calculator,
  ChevronDown,
  Filter,
  Heart,
  RotateCcw,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";

import { track } from "@/lib/analytics/track";
import type { BudgetCombination } from "@/lib/price/budgetFinder";
import {
  filterPriceCatalog,
  PRICE_CATEGORIES,
  type PriceCatalog,
  type PriceCategory,
  type PriceVendor,
} from "@/lib/price/catalog";
import {
  createPriceComboStore,
  type ComboCategory,
  type ComboSelection,
} from "@/lib/price/comboStore";
import {
  PRICE_CATEGORY_LABELS,
  PRICE_REGION_OPTIONS,
} from "@/lib/price/labels";
import { formatDisclosurePeriod } from "@/lib/price/period";

import { AddToComboModal } from "./AddToComboModal";
import { AuthGateModal } from "./AuthGateModal";
import { BudgetFinderModal } from "./BudgetFinderModal";
import { ComboBar } from "./ComboBar";
import { PriceDisclosureFooter } from "./PriceDisclosureFooter";
import { PriceEmptyState } from "./PriceEmptyState";
import { PriceVendorCard } from "./PriceVendorCard";

const PAGE_SIZE = 20;
const comboStore = createPriceComboStore();

type AuthStatus = "loading" | "authenticated" | "guest" | "unknown";
type WishlistHydrationStatus = "loading" | "ready" | "error";

function manwonToKrw(value: string): number | null {
  if (!value.trim()) return null;
  const manwon = Number(value);
  if (!Number.isFinite(manwon) || manwon < 0 || manwon > 100_000) return null;
  return Math.round(manwon * 10_000);
}

function comboPayloadSelection(selection: ComboSelection | null) {
  if (!selection) return null;
  return {
    vendor_id: selection.vendorId,
    agency_id: selection.agencyId,
    base_krw: selection.baseKrw,
    selected_options: selection.selectedOptions,
    custom_krw: selection.customKrw,
  };
}

type PriceExplorerProps = {
  catalog: PriceCatalog;
  category: PriceCategory;
};

export function PriceExplorer({ catalog, category }: PriceExplorerProps) {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [regionCode, setRegionCode] = useState("");
  const [agencyIds, setAgencyIds] = useState<string[]>([]);
  const [minimumManwon, setMinimumManwon] = useState("");
  const [maximumManwon, setMaximumManwon] = useState("");
  const [wishlistOnly, setWishlistOnly] = useState(false);
  const [sort, setSort] = useState<"name" | "lowest_price">("name");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [wishlistedIds, setWishlistedIds] = useState<Set<string>>(new Set());
  const [wishlistBusyIds, setWishlistBusyIds] = useState<Set<string>>(new Set());
  const [wishlistHydrationStatus, setWishlistHydrationStatus] =
    useState<WishlistHydrationStatus>("loading");
  const [ownerStateReload, setOwnerStateReload] = useState(0);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [showAuthGate, setShowAuthGate] = useState(false);
  const [comboVendor, setComboVendor] = useState<PriceVendor | null>(null);
  const [showBudgetFinder, setShowBudgetFinder] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [comboSaving, setComboSaving] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const favoriteBusy = useRef(new Set<string>());
  const comboSaveBusy = useRef(false);
  const comboSaveRequest = useRef<{ key: string; signature: string } | null>(null);
  const lastTrackedSearchSignature = useRef("");
  const lastTrackedFilterSignature = useRef("");

  const selections = useStore(comboStore, (state) => state.selections);
  const comboTotalKrw = useStore(comboStore, (state) => state.totalKrw);
  const comboCount = Object.values(selections).filter(Boolean).length;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    comboStore.getState().hydrate(sessionStorage);
    track("page_view", { surface: "price_list", context: { category } });
  }, [category]);

  useEffect(() => {
    const controller = new AbortController();
    setWishlistHydrationStatus("loading");
    void Promise.all([
      fetch("/api/price/combos", { cache: "no-store", signal: controller.signal }),
      fetch("/api/favorites", { cache: "no-store", signal: controller.signal }),
    ]).then(async ([comboResponse, favoriteResponse]) => {
      if (controller.signal.aborted) return;
      if (comboResponse.status === 401 || favoriteResponse.status === 401) {
        setAuthStatus("guest");
      } else if (comboResponse.ok) {
        setAuthStatus("authenticated");
      } else {
        setAuthStatus("unknown");
      }

      if (favoriteResponse.status === 401) {
        setWishlistedIds(new Set());
        setWishlistHydrationStatus("ready");
        return;
      }
      if (!favoriteResponse.ok) {
        setWishlistOnly(false);
        setWishlistHydrationStatus("error");
        return;
      }

      let body: { vendorIds?: unknown };
      try {
        body = await favoriteResponse.json() as { vendorIds?: unknown };
      } catch {
        body = {};
      }
      if (controller.signal.aborted) return;
      if (
        !Array.isArray(body.vendorIds)
        || !body.vendorIds.every((id): id is string => typeof id === "string" && id.length > 0)
      ) {
        setWishlistOnly(false);
        setWishlistHydrationStatus("error");
        return;
      }
      setWishlistedIds(new Set(body.vendorIds));
      setWishlistHydrationStatus("ready");
    }).catch((error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        setAuthStatus("unknown");
        setWishlistOnly(false);
        setWishlistHydrationStatus("error");
      }
    });
    return () => controller.abort();
  }, [ownerStateReload]);

  const vendors = catalog.categories[category];
  const activeAgencyIds = useMemo(() => new Set(vendors.flatMap((vendor) => vendor.offers.flatMap((offer) => (
    offer.agencyId ? [offer.agencyId] : []
  )))), [vendors]);
  const activeAgencies = useMemo(() => catalog.agencies.filter(({ id }) => activeAgencyIds.has(id)), [activeAgencyIds, catalog.agencies]);
  const cardAgencyOrder = useMemo(() => {
    if (agencyIds.length === 0) return activeAgencies;
    const agenciesById = new Map(activeAgencies.map((agency) => [agency.id, agency]));
    return agencyIds.flatMap((id) => {
      const agency = agenciesById.get(id);
      return agency ? [agency] : [];
    });
  }, [activeAgencies, agencyIds]);
  const budgetAgencies = useMemo(() => {
    const categoryAgencyIds = (["studio", "dress", "makeup"] as const).map((comboCategory) => new Set(
      catalog.categories[comboCategory].flatMap((vendor) => vendor.offers.flatMap((offer) => (
        offer.agencyId ? [offer.agencyId] : []
      ))),
    ));
    return catalog.agencies.filter(({ id }) => categoryAgencyIds.every((ids) => ids.has(id)));
  }, [catalog.agencies, catalog.categories]);
  const minimumKrw = manwonToKrw(minimumManwon);
  const maximumKrw = manwonToKrw(maximumManwon);
  const filtered = useMemo(() => filterPriceCatalog(vendors, {
    search: debouncedSearch,
    regionCode,
    agencyIds,
    minimumKrw,
    maximumKrw,
    wishlistOnly,
    wishlistedIds,
    sort,
  }), [agencyIds, debouncedSearch, maximumKrw, minimumKrw, regionCode, sort, vendors, wishlistOnly, wishlistedIds]);
  const searchResultCount = filtered.length;
  const filterSignature = [
    category,
    regionCode,
    agencyIds.join(","),
    minimumKrw ?? "",
    maximumKrw ?? "",
    wishlistOnly ? "wishlist" : "all",
    sort,
  ].join("|");

  useEffect(() => {
    if (!debouncedSearch) return;
    const signature = `${category}\0${debouncedSearch}`;
    if (lastTrackedSearchSignature.current === signature) return;
    lastTrackedSearchSignature.current = signature;
    track("search", {
      surface: "price_list",
      context: { category, zero_result: searchResultCount === 0 },
    });
  }, [category, debouncedSearch, searchResultCount]);

  useEffect(() => {
    if (!lastTrackedFilterSignature.current) {
      lastTrackedFilterSignature.current = filterSignature;
      return;
    }
    if (lastTrackedFilterSignature.current === filterSignature) return;
    lastTrackedFilterSignature.current = filterSignature;
    track("filter_use", {
      surface: "price_list",
      context: {
        category,
        ...(regionCode ? { region: regionCode } : {}),
        zero_result: filtered.length === 0,
      },
    });
  }, [category, filterSignature, filtered.length, regionCode]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [agencyIds, debouncedSearch, maximumManwon, minimumManwon, regionCode, sort, wishlistOnly, category]);

  useEffect(() => {
    const element = loadMoreRef.current;
    if (!element || visibleCount >= filtered.length || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) setVisibleCount((count) => Math.min(count + PAGE_SIZE, filtered.length));
    }, { rootMargin: "300px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [filtered.length, visibleCount]);

  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(""), 4_000);
    return () => clearTimeout(timer);
  }, [feedback]);

  const activeFilterCount = (regionCode ? 1 : 0)
    + agencyIds.length
    + (minimumKrw !== null ? 1 : 0)
    + (maximumKrw !== null ? 1 : 0)
    + (wishlistOnly ? 1 : 0);

  const resetFilters = () => {
    setRegionCode("");
    setAgencyIds([]);
    setMinimumManwon("");
    setMaximumManwon("");
    setWishlistOnly(false);
    setSort("name");
  };

  const toggleWishlist = useCallback(async (vendor: PriceVendor) => {
    if (wishlistHydrationStatus !== "ready") {
      if (wishlistHydrationStatus === "error") {
        setFeedback("찜 목록을 먼저 다시 불러와 주세요.");
      }
      return;
    }
    if (authStatus === "guest") {
      setShowAuthGate(true);
      return;
    }
    if (favoriteBusy.current.has(vendor.id)) return;
    const desiredFavorite = !wishlistedIds.has(vendor.id);
    favoriteBusy.current.add(vendor.id);
    setWishlistBusyIds((current) => new Set(current).add(vendor.id));
    try {
      const response = await fetch("/api/favorites", {
        method: desiredFavorite ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ vendorId: vendor.id }),
      });
      if (response.status === 401) {
        setAuthStatus("guest");
        setShowAuthGate(true);
        return;
      }
      if (!response.ok) {
        setFeedback("찜을 바꾸지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      const body = await response.json() as { isFavorite?: boolean };
      if (body.isFavorite !== desiredFavorite) {
        setFeedback("찜 상태를 확인하지 못했어요. 다시 시도해 주세요.");
        return;
      }
      setAuthStatus("authenticated");
      setWishlistedIds((current) => {
        const next = new Set(current);
        if (desiredFavorite) next.add(vendor.id);
        else next.delete(vendor.id);
        return next;
      });
      if (desiredFavorite) {
        track("wishlist_add", {
          vendor_id: vendor.id,
          surface: "price_list",
          context: { category: vendor.category },
        });
      }
    } catch {
      setFeedback("네트워크를 확인한 뒤 다시 시도해 주세요.");
    } finally {
      favoriteBusy.current.delete(vendor.id);
      setWishlistBusyIds((current) => {
        const next = new Set(current);
        next.delete(vendor.id);
        return next;
      });
    }
  }, [authStatus, wishlistHydrationStatus, wishlistedIds]);

  const addCombo = (comboCategory: ComboCategory, selection: ComboSelection) => {
    comboStore.getState().setSelection(comboCategory, selection);
    track("combo_add", {
      vendor_id: selection.vendorId,
      ...(selection.agencyId ? { agency_id: selection.agencyId } : {}),
      surface: "combo",
      context: { category: comboCategory },
    });
    setFeedback(`${selection.vendorName}을(를) 조합에 담았어요.`);
  };

  const chooseBudgetCombination = (combination: BudgetCombination) => {
    for (const comboCategory of ["studio", "dress", "makeup"] as const) {
      const choice = combination[comboCategory];
      addCombo(comboCategory, {
        vendorId: choice.vendorId,
        vendorSlug: choice.vendorSlug,
        vendorName: choice.vendorName,
        agencyId: choice.agencyId,
        agencyName: choice.agencyName,
        baseKrw: choice.baseKrw,
        selectedOptions: [],
        customKrw: null,
      });
    }
    setShowBudgetFinder(false);
    setFeedback("예산 안의 스드메 조합을 담았어요.");
  };

  const saveCombo = async () => {
    if (authStatus === "guest") {
      setShowAuthGate(true);
      return;
    }
    if (comboSaveBusy.current) return;
    const payload = {
      name: "내 스드메 조합",
      selections: {
        studio: comboPayloadSelection(selections.studio),
        dress: comboPayloadSelection(selections.dress),
        makeup: comboPayloadSelection(selections.makeup),
      },
    };
    const signature = JSON.stringify(payload);
    if (comboSaveRequest.current?.signature !== signature) {
      if (typeof globalThis.crypto?.randomUUID !== "function") {
        setFeedback("이 브라우저에서는 안전한 저장 요청을 만들 수 없어요. 브라우저를 업데이트해 주세요.");
        return;
      }
      comboSaveRequest.current = {
        key: globalThis.crypto.randomUUID(),
        signature,
      };
    }
    comboSaveBusy.current = true;
    setComboSaving(true);
    setFeedback("조합을 안전하게 저장하고 있어요…");
    try {
      const response = await fetch("/api/price/combos", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": comboSaveRequest.current.key,
        },
        body: signature,
      });
      if (response.status === 401) {
        setAuthStatus("guest");
        setFeedback("");
        setShowAuthGate(true);
        return;
      }
      if (response.status === 409) {
        setFeedback("가격이 갱신됐어요. 최신 가격으로 다시 조합해 주세요.");
        return;
      }
      if (!response.ok) {
        setFeedback("조합을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");
        return;
      }
      setAuthStatus("authenticated");
      setFeedback("조합을 저장했어요. 다음에 다시 확인할 수 있어요.");
      track("combo_save", { surface: "combo" });
    } catch {
      setFeedback("네트워크를 확인한 뒤 다시 저장해 주세요.");
    } finally {
      comboSaveBusy.current = false;
      setComboSaving(false);
    }
  };

  const shareCombo = async () => {
    const names = (["studio", "dress", "makeup"] as const)
      .flatMap((comboCategory) => selections[comboCategory]?.vendorName ?? []);
    const text = `웨딩한방에서 고른 스드메 조합: ${names.join(" · ")}`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "나의 스드메 조합", text, url: window.location.href });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(`${text}\n${window.location.href}`);
        setFeedback("공유할 내용을 복사했어요.");
      } else {
        setFeedback("이 브라우저에서는 공유를 지원하지 않아요.");
        return;
      }
      track("combo_share", { surface: "combo" });
    } catch {
      // Cancelling the native share sheet is not an error that needs a toast.
    }
  };

  const displayVendors = filtered.slice(0, visibleCount).map((vendor) => agencyIds.length === 0
    ? vendor
    : { ...vendor, offers: vendor.offers.filter(({ agencyId }) => agencyId === null || agencyIds.includes(agencyId)) });

  return (
    <main className={`min-h-screen bg-[#FBF8F2] text-[#1D3557] ${comboCount > 0 ? "pb-52 sm:pb-44" : "pb-12"}`}>
      <section className="border-b border-[#1D3557]/10 bg-[radial-gradient(circle_at_top_right,rgba(181,151,122,0.2),transparent_42%),linear-gradient(180deg,#FFFDF8_0%,#FBF8F2_100%)] px-4 pb-6 pt-8 sm:px-6 sm:pb-8 sm:pt-12">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold tracking-[0.13em] text-[#8F6662]">한국소비자원 참가격 공시</p>
              <h1 className="mt-2 max-w-2xl text-3xl font-bold tracking-[-0.04em] text-[#1D3557] sm:text-4xl">
                스드메·예식장 공시가 비교
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full bg-[#F5ECE4] px-3 py-1.5 text-xs font-bold text-[#7C5754]">
                  {formatDisclosurePeriod(catalog.periodLabel)} 공시 기준
                </span>
                <p className="text-sm font-semibold leading-6 text-[#1D3557]/75">
                  가격표시제에 따라 가격을 공개한 업체만 표시됩니다.
                </p>
              </div>
              <p className="mt-2 text-sm leading-6 text-[#1D3557]/65">
                업체별 기본가와 추가금을 한 화면에서 편하게 확인하세요.
              </p>
            </div>
            <button type="button" onClick={() => setShowBudgetFinder(true)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#8F6662] px-5 text-sm font-bold text-white shadow-[0_10px_24px_rgba(143,102,98,0.18)] hover:bg-[#7C5754]">
              <Calculator aria-hidden="true" className="size-4" />
              내 예산으로 조합 찾기
            </button>
          </div>

          <nav className="-mx-4 mt-7 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0" aria-label="가격 카테고리">
            {PRICE_CATEGORIES.map((value) => (
              <Link
                key={value}
                href={`/price/${value}`}
                aria-current={value === category ? "page" : undefined}
                className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-full border px-4 text-sm font-bold transition-colors ${value === category ? "border-[#1D3557] bg-[#1D3557] text-white" : "border-[#1D3557]/12 bg-white text-[#1D3557] hover:bg-[#F5ECE4]"}`}
              >
                {PRICE_CATEGORY_LABELS[value]}
                <span className={value === category ? "text-white/65" : "text-[#1D3557]/45"}>{catalog.counts[value]}</span>
              </Link>
            ))}
          </nav>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-7" aria-label="업체 가격 찾기">
        <div className="rounded-[24px] border border-[#1D3557]/10 bg-white p-3 shadow-[0_12px_34px_rgba(29,53,87,0.045)] sm:p-4">
          <div className="flex gap-2">
            <label className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl bg-[#FBF8F2] px-4 focus-within:ring-2 focus-within:ring-[#B5977A]">
              <Search aria-hidden="true" className="size-4 shrink-0 text-[#1D3557]/45" />
              <span className="sr-only">업체명 검색</span>
              <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="업체명 또는 이전 상호 검색" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#1D3557]/40" />
            </label>
            <button type="button" onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen} className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl border border-[#1D3557]/12 bg-white px-4 text-sm font-bold text-[#1D3557] md:hidden">
              <Filter aria-hidden="true" className="size-4" />
              필터{activeFilterCount > 0 ? ` ${activeFilterCount}` : ""}
              <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
            </button>
          </div>

          <div className={`${filtersOpen ? "block" : "hidden"} mt-4 border-t border-[#1D3557]/10 pt-4 md:block`}>
            <div className="grid gap-4 md:grid-cols-4">
              <label className="text-xs font-bold text-[#1D3557]/65">
                지역
                <select value={regionCode} onChange={(event) => {
                  setRegionCode(event.target.value);
                }} className="mt-2 min-h-11 w-full rounded-xl border border-[#1D3557]/12 bg-[#FBF8F2] px-3 text-sm font-medium text-[#1D3557] outline-none focus:ring-2 focus:ring-[#B5977A]">
                  <option value="">전체 지역</option>
                  {PRICE_REGION_OPTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-[#1D3557]/65">
                최소 가격
                <span className="mt-2 flex min-h-11 items-center rounded-xl border border-[#1D3557]/12 bg-[#FBF8F2] px-3 focus-within:ring-2 focus-within:ring-[#B5977A]">
                  <input value={minimumManwon} onChange={(event) => setMinimumManwon(event.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
                  <span className="text-xs font-medium text-[#1D3557]/50">만원</span>
                </span>
              </label>
              <label className="text-xs font-bold text-[#1D3557]/65">
                최대 가격
                <span className="mt-2 flex min-h-11 items-center rounded-xl border border-[#1D3557]/12 bg-[#FBF8F2] px-3 focus-within:ring-2 focus-within:ring-[#B5977A]">
                  <input value={maximumManwon} onChange={(event) => setMaximumManwon(event.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="제한 없음" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
                  <span className="text-xs font-medium text-[#1D3557]/50">만원</span>
                </span>
              </label>
              <label className="text-xs font-bold text-[#1D3557]/65">
                정렬
                <select value={sort} onChange={(event) => {
                  setSort(event.target.value as "name" | "lowest_price");
                }} className="mt-2 min-h-11 w-full rounded-xl border border-[#1D3557]/12 bg-[#FBF8F2] px-3 text-sm font-medium text-[#1D3557] outline-none focus:ring-2 focus:ring-[#B5977A]">
                  <option value="name">업체명순</option>
                  <option value="lowest_price">최저가순</option>
                </select>
              </label>
            </div>

            {activeAgencies.length > 0 ? (
              <fieldset className="mt-4">
                <legend className="text-xs font-bold text-[#1D3557]/65">대행사</legend>
                <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                  {activeAgencies.map((agency) => {
                    const checked = agencyIds.includes(agency.id);
                    return (
                      <label key={agency.id} className={`inline-flex min-h-11 shrink-0 cursor-pointer items-center rounded-full border px-3 text-xs font-semibold ${checked ? "border-[#8F6662] bg-[#F5ECE4] text-[#7C5754]" : "border-[#1D3557]/12 bg-white text-[#1D3557]/70"}`}>
                        <input type="checkbox" checked={checked} onChange={() => {
                          setAgencyIds((current) => checked ? current.filter((id) => id !== agency.id) : [...current, agency.id]);
                        }} className="sr-only" />
                        {agency.name}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#1D3557]/10 pt-4">
              <button type="button" onClick={() => {
                if (wishlistHydrationStatus !== "ready") return;
                if (authStatus === "guest") {
                  setShowAuthGate(true);
                  return;
                }
                setWishlistOnly((value) => !value);
              }} disabled={wishlistHydrationStatus !== "ready"} aria-busy={wishlistHydrationStatus === "loading"} aria-pressed={wishlistOnly} className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${wishlistOnly ? "bg-[#8F6662] text-white" : "bg-[#F5ECE4] text-[#1D3557]"}`}>
                <Heart aria-hidden="true" className="size-4" fill={wishlistOnly ? "currentColor" : "none"} />
                찜한 업체만
              </button>
              {activeFilterCount > 0 ? (
                <button type="button" onClick={resetFilters} className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-xs font-bold text-[#1D3557]/65 hover:bg-[#FBF8F2]">
                  <RotateCcw aria-hidden="true" className="size-3.5" />
                  필터 초기화
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {wishlistHydrationStatus === "error" ? (
          <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#8F6662]/25 bg-[#F5ECE4] px-4 py-3 text-sm text-[#7A4742]">
            <p className="font-semibold">찜 목록을 불러오지 못했어요. 기존 찜은 변경하지 않았어요.</p>
            <button
              type="button"
              onClick={() => setOwnerStateReload((value) => value + 1)}
              className="inline-flex min-h-11 items-center rounded-full border border-[#8F6662]/30 bg-white px-4 text-xs font-bold hover:bg-[#FBF8F2] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8F6662]"
            >
              다시 불러오기
            </button>
          </div>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-sm text-[#1D3557]/65"><strong className="font-bold text-[#1D3557]">{filtered.length}</strong>개 업체</p>
          {debouncedSearch ? <p className="max-w-[65%] truncate text-xs text-[#1D3557]/50">‘{debouncedSearch}’ 검색 결과</p> : null}
        </div>

        {displayVendors.length > 0 ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            {displayVendors.map((vendor) => (
              <PriceVendorCard
                key={vendor.id}
                vendor={vendor}
                agencyOrder={cardAgencyOrder}
                isWishlisted={wishlistedIds.has(vendor.id)}
                wishlistBusy={wishlistHydrationStatus !== "ready" || wishlistBusyIds.has(vendor.id)}
                onToggleWishlist={toggleWishlist}
                onOpenCombo={setComboVendor}
              />
            ))}
          </div>
        ) : <div className="mt-4"><PriceEmptyState /></div>}

        <div ref={loadMoreRef} className="flex min-h-16 items-center justify-center" aria-hidden={visibleCount >= filtered.length}>
          {visibleCount < filtered.length ? (
            <button type="button" onClick={() => setVisibleCount((count) => Math.min(count + PAGE_SIZE, filtered.length))} className="min-h-11 rounded-full border border-[#1D3557]/15 bg-white px-5 text-sm font-bold text-[#1D3557]">
              더 보기
            </button>
          ) : null}
        </div>

        <PriceDisclosureFooter periodLabel={catalog.periodLabel} />
      </section>

      <AddToComboModal key={comboVendor?.id ?? "closed"} vendor={comboVendor} onClose={() => setComboVendor(null)} onAdd={addCombo} />
      <BudgetFinderModal
        open={showBudgetFinder}
        catalog={{ studio: catalog.categories.studio, dress: catalog.categories.dress, makeup: catalog.categories.makeup }}
        agencies={budgetAgencies}
        onClose={() => setShowBudgetFinder(false)}
        onChoose={chooseBudgetCombination}
      />
      <AuthGateModal open={showAuthGate} redirectPath={`/price/${category}`} onClose={() => setShowAuthGate(false)} />
      <ComboBar
        selections={selections}
        totalKrw={comboTotalKrw}
        saving={comboSaving}
        onClear={(comboCategory) => comboStore.getState().clearSelection(comboCategory)}
        onSave={() => void saveCombo()}
        onShare={() => void shareCombo()}
      />
      <p className="sr-only" role="status" aria-live="polite">{feedback}</p>
      {feedback ? <div className="fixed bottom-40 left-1/2 z-[105] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full bg-[#10233D] px-4 py-2.5 text-center text-xs font-semibold text-white shadow-xl sm:bottom-32">{feedback}</div> : null}
    </main>
  );
}
