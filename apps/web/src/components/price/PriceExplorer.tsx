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
import { mobileAuthenticatedFetch } from "@/lib/mobile/mobileAuthenticatedFetch";
import type { BudgetCombination } from "@/lib/price/budgetFinder";
import {
  filterPriceCatalog,
  PRICE_CATEGORIES,
  vendorRegionCodes,
  type PriceCatalog,
  type PriceCategory,
  type PriceVendor,
} from "@/lib/price/catalog";
import {
  buildRegionCounts,
  RegionChip,
  RegionFirstPicker,
  ThinCoverageNotice,
} from "@/components/price/RegionFirstPicker";
import {
  createPriceComboStore,
  type ComboCategory,
  type ComboSelection,
} from "@/lib/price/comboStore";
import {
  PRICE_CATEGORY_LABELS,
  PRICE_REGION_OPTIONS,
} from "@/lib/price/labels";
import { disclosureRoundLabel } from "@/lib/price/period";
import {
  parseLatestSavedComboPayload,
  restoreSavedComboAgainstCatalog,
  type SavedComboPreview,
} from "@/lib/price/savedComboRestore";

import { AddToComboModal } from "./AddToComboModal";
import { AuthGateModal } from "./AuthGateModal";
import { BudgetFinderModal } from "./BudgetFinderModal";
import { ComboBar } from "./ComboBar";
import { PriceDisclosureFooter } from "./PriceDisclosureFooter";
import { PriceEmptyState } from "./PriceEmptyState";
import { PriceVendorCard } from "./PriceVendorCard";

const PAGE_SIZE = 20;
// 고른 지역은 브라우저에 남긴다 — 올 때마다 다시 묻지 않기 위해서.
const REGION_STORAGE_KEY = "hanbang.price.region";
// 접힌 상태에서 보여줄 대행사 칩 수 — 나머지는 "모두 보기"로 펼친다.
const AGENCY_PREVIEW_COUNT = 12;
const comboStore = createPriceComboStore();

type AuthStatus = "loading" | "authenticated" | "guest" | "unknown";
type WishlistHydrationStatus = "loading" | "ready" | "error";
type SavedComboHydrationStatus = "loading" | "ready" | "error";

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
  surface?: "public" | "app";
  preview?: boolean;
};

export function PriceExplorer({
  catalog,
  category,
  surface = "public",
  preview = false,
}: PriceExplorerProps) {
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [regionCode, setRegionCode] = useState("");
  // 지역을 아직 한 번도 안 골랐을 때만 첫 단계 카드를 띄운다. localStorage는
  // 렌더 중에 못 읽으므로(하이드레이션 불일치) 확정 전까지는 "미정"으로 둔다.
  const [regionChoiceStatus, setRegionChoiceStatus] =
    useState<"unknown" | "needed" | "chosen">("unknown");
  const [agencyIds, setAgencyIds] = useState<string[]>([]);
  const [minimumManwon, setMinimumManwon] = useState("");
  const [maximumManwon, setMaximumManwon] = useState("");
  const [wishlistOnly, setWishlistOnly] = useState(false);
  const [sort, setSort] = useState<"name" | "lowest_price">("name");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [agencyListOpen, setAgencyListOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [wishlistedIds, setWishlistedIds] = useState<Set<string>>(new Set());
  const [wishlistBusyIds, setWishlistBusyIds] = useState<Set<string>>(new Set());
  const [wishlistHydrationStatus, setWishlistHydrationStatus] =
    useState<WishlistHydrationStatus>("loading");
  const [ownerStateReload, setOwnerStateReload] = useState(0);
  const [authStatus, setAuthStatus] = useState<AuthStatus>("loading");
  const [savedComboHydrationStatus, setSavedComboHydrationStatus] =
    useState<SavedComboHydrationStatus>("loading");
  const [latestSavedCombo, setLatestSavedCombo] = useState<SavedComboPreview | null>(null);
  const [restoreConfirming, setRestoreConfirming] = useState(false);
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
  const visibleComboCount = preview ? 0 : comboCount;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // 지역 결정: URL(?region=) > 저장된 선택 > 미정. 링크를 공유하면 상대도 같은
  // 지역을 보고, 다음 방문에는 다시 묻지 않는다.
  useEffect(() => {
    if (preview) {
      setRegionChoiceStatus("chosen");
      return;
    }
    let stored: string | null = null;
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("region");
      stored = fromUrl ?? window.localStorage.getItem(REGION_STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (stored === null) {
      setRegionChoiceStatus("needed");
      return;
    }
    const valid = stored === "" || PRICE_REGION_OPTIONS.some(([code]) => code === stored);
    if (!valid) {
      setRegionChoiceStatus("needed");
      return;
    }
    setRegionCode(stored);
    setRegionChoiceStatus("chosen");
  }, [preview]);

  const chooseRegion = useCallback((nextRegion: string) => {
    setRegionCode(nextRegion);
    setRegionChoiceStatus("chosen");
    try {
      window.localStorage.setItem(REGION_STORAGE_KEY, nextRegion);
      const url = new URL(window.location.href);
      if (nextRegion) url.searchParams.set("region", nextRegion);
      else url.searchParams.delete("region");
      window.history.replaceState(null, "", url);
    } catch {
      // 저장 실패는 조용히 넘긴다 — 이번 방문에는 그대로 동작한다.
    }
  }, []);

  useEffect(() => {
    if (preview) return;
    comboStore.getState().hydrate(sessionStorage);
    track("page_view", { surface: "price_list", context: { category } });
  }, [category, preview]);

  useEffect(() => {
    if (preview) {
      setAuthStatus("guest");
      setWishlistedIds(new Set());
      setWishlistBusyIds(new Set());
      setWishlistOnly(false);
      setWishlistHydrationStatus("ready");
      setLatestSavedCombo(null);
      setSavedComboHydrationStatus("ready");
      setRestoreConfirming(false);
      return;
    }
    const controller = new AbortController();
    setWishlistHydrationStatus("loading");
    setSavedComboHydrationStatus("loading");
    setRestoreConfirming(false);
    void Promise.all([
      mobileAuthenticatedFetch("/api/price/combos", { cache: "no-store", signal: controller.signal }),
      mobileAuthenticatedFetch("/api/favorites", { cache: "no-store", signal: controller.signal }),
    ]).then(async ([comboResponse, favoriteResponse]) => {
      if (controller.signal.aborted) return;
      if (comboResponse.status === 401 || favoriteResponse.status === 401) {
        setAuthStatus("guest");
      } else if (comboResponse.ok) {
        setAuthStatus("authenticated");
      } else {
        setAuthStatus("unknown");
      }

      if (comboResponse.status === 401) {
        setLatestSavedCombo(null);
        setSavedComboHydrationStatus("ready");
      } else if (!comboResponse.ok) {
        setSavedComboHydrationStatus("error");
      } else {
        let comboBody: unknown;
        try {
          comboBody = await comboResponse.json() as unknown;
        } catch {
          comboBody = null;
        }
        if (controller.signal.aborted) return;
        const parsedCombo = parseLatestSavedComboPayload(comboBody);
        if (!parsedCombo.ok) {
          setSavedComboHydrationStatus("error");
        } else {
          setLatestSavedCombo(parsedCombo.combo);
          setSavedComboHydrationStatus("ready");
        }
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
        setSavedComboHydrationStatus("error");
      }
    });
    return () => controller.abort();
  }, [ownerStateReload, preview]);

  const vendors = catalog.categories[category];
  const activeAgencyIds = useMemo(() => new Set(vendors.flatMap((vendor) => vendor.offers.flatMap((offer) => (
    offer.agencyId ? [offer.agencyId] : []
  )))), [vendors]);
  const activeAgencies = useMemo(() => catalog.agencies.filter(({ id }) => activeAgencyIds.has(id)), [activeAgencyIds, catalog.agencies]);
  const cardAgencyOrder = useMemo(() => {
    if (agencyIds.length === 0) return undefined;
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
  const regionCounts = useMemo(
    () => buildRegionCounts((index) => vendorRegionCodes(vendors[index]), vendors.length),
    [vendors],
  );
  // 칩에 붙는 수는 "이 지역에 몇 곳"이어야 한다. 검색어·가격 필터까지 반영한
  // filtered.length를 쓰면 "서울 강남권 3곳"처럼 지역 규모를 잘못 알려준다.
  const regionOnlyCount = useMemo(() => (
    regionCode
      ? vendors.filter((vendor) => vendorRegionCodes(vendor).includes(regionCode)).length
      : vendors.length
  ), [regionCode, vendors]);
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
    if (preview || !debouncedSearch) return;
    const signature = `${category}\0${debouncedSearch}`;
    if (lastTrackedSearchSignature.current === signature) return;
    lastTrackedSearchSignature.current = signature;
    track("search", {
      surface: "price_list",
      context: { category, zero_result: searchResultCount === 0 },
    });
  }, [category, debouncedSearch, preview, searchResultCount]);

  useEffect(() => {
    if (preview) return;
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
  }, [category, filterSignature, filtered.length, preview, regionCode]);

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
  const hasRecoverableFilters = Boolean(
    searchInput.trim()
    || regionCode
    || agencyIds.length > 0
    || minimumManwon
    || maximumManwon
    || wishlistOnly,
  );

  const resetFilters = () => {
    chooseRegion("");
    setAgencyIds([]);
    setMinimumManwon("");
    setMaximumManwon("");
    setWishlistOnly(false);
    setSort("name");
  };

  const toggleWishlist = useCallback(async (vendor: PriceVendor) => {
    if (preview) return;
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
      const response = await mobileAuthenticatedFetch("/api/favorites", {
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
  }, [authStatus, preview, wishlistHydrationStatus, wishlistedIds]);

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
    setFeedback("예산 안의 사진·드레스·메이크업 조합을 담았어요.");
  };

  const restoreLatestCombo = () => {
    if (!latestSavedCombo || savedComboHydrationStatus !== "ready") return;
    if (comboCount > 0 && !restoreConfirming) {
      setRestoreConfirming(true);
      return;
    }

    const restored = restoreSavedComboAgainstCatalog(latestSavedCombo, catalog);
    setRestoreConfirming(false);
    if (restored.restoredCategories.length === 0) {
      setFeedback("최근 저장 조합의 가격이 바뀌었거나 업체가 공개 종료되어 불러오지 않았어요.");
      return;
    }

    comboStore.getState().replaceSelections(restored.selections);
    if (restored.skippedCategories.length > 0) {
      setFeedback(`최근 저장 조합 ${restored.restoredCategories.length}개를 불러왔어요. 변경되거나 공개 종료된 ${restored.skippedCategories.length}개는 제외했어요.`);
    } else {
      setFeedback("최근 저장 조합을 현재 공시 정보로 확인해 불러왔어요.");
    }
  };

  const saveCombo = async () => {
    if (authStatus === "guest") {
      setShowAuthGate(true);
      return;
    }
    if (comboSaveBusy.current) return;
    const payload = {
      name: "내 사진·드레스·메이크업 조합",
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
      const response = await mobileAuthenticatedFetch("/api/price/combos", {
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
      setFeedback("조합을 저장했어요. ‘최근 저장 조합 불러오기’로 다시 열 수 있어요.");
      setOwnerStateReload((value) => value + 1);
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
    const text = `웨딩한방에서 고른 사진·드레스·메이크업 조합: ${names.join(" · ")}`;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "사진·드레스·메이크업 조합", text, url: window.location.href });
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
  // 공개 가격 레이아웃이 이미 유일한 <main>을 제공한다. 앱 표면과 공개 표면 모두
  // 여기서는 중립 컨테이너를 써 중첩·중복 main landmark를 만들지 않는다.
  const Root = "div";
  const totalVendorCount = new Set(PRICE_CATEGORIES.flatMap((value) => (
    catalog.categories[value].map((vendor) => vendor.id)
  ))).size;

  return (
    <Root className={`${surface === "app" ? "overflow-hidden rounded-[20px] border border-[#eadfc9] bg-[#FBF8F2]" : "min-h-screen bg-[#FBF8F2]"} text-[#243832] ${visibleComboCount > 0 ? "pb-52 sm:pb-44" : "pb-12"}`}>
      {preview ? (
        <div
          role="status"
          aria-label="관리자 미리보기 상태"
          className="border-b border-[#B89785]/35 bg-[#F7F1E8] px-4 py-3 text-center text-sm font-bold text-[#36534E] sm:px-6"
        >
          검수 전 미리보기 — 일반 사용자에게는 보이지 않음 · 자동 추출·정확성 미보장
        </div>
      ) : null}
      {surface === "app" ? (
        <section className="border-b border-[#243832]/10 bg-white px-4 py-6 sm:px-6" aria-labelledby="vendor-hub-title">
          <p className="text-[11px] font-bold tracking-[0.16em] text-[#8F6662]">WEDDING HANBANG</p>
          <h1 id="vendor-hub-title" className="mt-1 text-3xl font-bold tracking-normal">
            {preview ? "업체 공시가 검수 미리보기" : "업체 탐색"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-[#243832]/75">
            {preview
              ? "자동 추출된 검수 전 데이터입니다. 업체·가격·연결 정보의 정확성이 보장되지 않습니다."
              : "출처가 확인된 공식 가격 업체를 비교하고, 마음에 드는 후보를 저장해 보세요."}
          </p>
          <div className="mt-5 grid grid-cols-3 gap-2" aria-label="업체 탐색 현황">
            <div className="rounded-2xl bg-[#FBF8F2] px-3 py-4">
              <p className="text-[11px] font-bold text-[#243832]/75">
                {preview ? "자동 추출 업체" : "공식 가격 업체"}
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums">{totalVendorCount}</p>
            </div>
            {preview ? (
              <div className="rounded-2xl bg-[#F5ECE4] px-3 py-4">
                <p className="text-[11px] font-bold text-[#243832]/75">검수 상태</p>
                <p className="mt-1 text-sm font-bold text-[#36534E]">읽기 전용</p>
              </div>
            ) : (
              <Link href="/price/wishlist" className="rounded-2xl bg-[#F5ECE4] px-3 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8F6662]">
                <p className="text-[11px] font-bold text-[#243832]/75">찜한 업체</p>
                <p className="mt-1 text-xl font-bold tabular-nums">
                  {wishlistHydrationStatus === "ready" ? wishlistedIds.size : "–"}
                </p>
              </Link>
            )}
            <div className="rounded-2xl bg-[#FBF8F2] px-3 py-4">
              <p className="text-[11px] font-bold text-[#243832]/75">가격 카테고리</p>
              <p className="mt-1 text-xl font-bold tabular-nums">
                {PRICE_CATEGORIES.filter((value) => catalog.counts[value] > 0).length}
              </p>
            </div>
          </div>
          {!preview ? (
            <div className="mt-4 flex flex-col gap-3 rounded-2xl bg-[#36534E] px-4 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-bold">조건이 아직 막막하다면 아모라와 먼저 정리해요</p>
                <p className="mt-1 text-xs leading-5 text-white/70">예산·지역·취향을 함께 좁힌 뒤 공시 근거가 있는 후보만 살펴볼 수 있어요.</p>
              </div>
              <Link href="/wedding/chat" className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-white px-4 text-sm font-bold text-[#243832]">
                아모라와 찾기
              </Link>
            </div>
          ) : null}
        </section>
      ) : null}
      <section className="border-b border-[#243832]/10 bg-[radial-gradient(circle_at_top_right,rgba(181,151,122,0.2),transparent_42%),linear-gradient(180deg,#FFFDF8_0%,#FBF8F2_100%)] px-4 pb-6 pt-8 sm:px-6 sm:pb-8 sm:pt-12">
        <div className="mx-auto max-w-6xl">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-xs font-bold tracking-[0.13em] text-[#8F6662]">
                {preview ? "관리자 검수용 자동 추출 데이터" : "한국소비자원 참가격 공시"}
              </p>
              <h1 className="mt-2 max-w-2xl text-3xl font-bold tracking-normal text-[#243832] sm:text-4xl">
                {preview
                  ? "사진·드레스·메이크업·결혼식장 공시 가격 검수"
                  : "사진·드레스·메이크업·결혼식장 공시 가격 비교"}
              </h1>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full bg-[#F5ECE4] px-3 py-1.5 text-xs font-bold text-[#7C5754]">
                  {disclosureRoundLabel()} 공시 기준
                </span>
                <p className="text-sm font-semibold leading-6 text-[#243832]/75">
                  {preview
                    ? "승인 전 원문 대조가 필요한 자동 추출 결과입니다."
                    : "가격표시제에 따라 가격을 공개한 업체만 표시됩니다."}
                </p>
              </div>
              {/* 허브(/price)는 위약금을 앞세우는데 카테고리로 들어오면 그 말이 사라져,
                  위약금을 보러 온 사람이 여기서 훅을 잃었다. 정작 원문은 한 번 더 들어간
                  업체 상세에 있으므로 그 경로를 여기서 짚어 준다. */}
              <p className="mt-2 text-sm leading-6 text-[#243832]/75">
                {preview
                  ? "일반 사용자에게는 보이지 않으며, 검수 완료 전 저장·추천에 사용하지 않습니다."
                  : "업체별 기본가와 추가금을 한 화면에서 확인하고, 업체를 누르면 취소 위약금·환불 규정 원문까지 그대로 볼 수 있어요."}
              </p>
            </div>
            {!preview ? (
              <button type="button" onClick={() => setShowBudgetFinder(true)} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#8F6662] px-5 text-sm font-bold text-white shadow-[0_10px_24px_rgba(143,102,98,0.18)] hover:bg-[#7C5754]">
                <Calculator aria-hidden="true" className="size-4" />
                내 예산으로 조합 찾기
              </button>
            ) : null}
          </div>

          {/* 375px에서 네 번째 탭(웨딩홀)이 화면 밖 x=386에 놓여 스크롤 힌트도 없이
              사라졌다 — 지출이 가장 큰 카테고리가 모바일에서 도달 불가였다.
              대행사 칩과 같은 처방으로 가로 스크롤 대신 줄바꿈으로 담는다.
              ※ scrollbar-hide + overflow-x-auto로 되돌리지 말 것 —
                 PriceExplorer.test.tsx가 overflow-x-auto 부재를 단정한다. */}
          <nav className="mt-7 flex flex-wrap gap-2" aria-label="가격 카테고리">
            {PRICE_CATEGORIES.map((value) => (
              <Link
                key={value}
                href={surface === "app"
                  ? `/wedding/vendors?category=${value}${preview ? "&preview=1" : ""}`
                  : `/price/${value}`}
                // 카테고리 페이지 RSC가 600~900KB라 자동 프리페치는 모바일에서
                // 안 볼 탭까지 수 MB를 미리 받게 만든다 — 클릭 시에만 가져온다.
                prefetch={false}
                aria-current={value === category ? "page" : undefined}
                className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-bold transition-colors ${value === category ? "border-[#243832] bg-[#36534E] text-white" : "border-[#243832]/12 bg-white text-[#243832] hover:bg-[#F5ECE4]"}`}
              >
                {PRICE_CATEGORY_LABELS[value]}
                <span className={value === category ? "text-white/65" : "text-[#243832]/45"}>{catalog.counts[value]}</span>
              </Link>
            ))}
          </nav>
        </div>
      </section>

      {regionChoiceStatus === "needed" ? (
        <RegionFirstPicker
          counts={regionCounts}
          totalCount={vendors.length}
          onSelect={chooseRegion}
        />
      ) : null}
      {regionChoiceStatus === "chosen" && !preview ? (
        <RegionChip
          regionCode={regionCode}
          count={regionOnlyCount}
          onChange={() => setRegionChoiceStatus("needed")}
        />
      ) : null}
      {regionChoiceStatus === "chosen" && !preview ? (
        <ThinCoverageNotice
          regionCode={regionCode}
          count={regionOnlyCount}
          onShowAll={() => chooseRegion("")}
        />
      ) : null}

      <section className="mx-auto max-w-6xl px-4 py-5 sm:px-6 sm:py-7" aria-label="업체 가격 찾기">
        <div className="rounded-[24px] border border-[#243832]/10 bg-white p-3 shadow-[0_12px_34px_rgba(36,56,50,0.045)] sm:p-4">
          <div className="flex gap-2">
            {/* 좁은 화면에서는 여백을 줄여 입력 폭을 확보한다(오른쪽에 필터 버튼이 붙는다).
                색은 라운지 팔레트(#243832·#B89785) 기준 — 구 팔레트(#1D3557·#B5977A)로
                되돌리지 말 것. 그리고 "다른 표기로도 검색된다"는 힌트는 placeholder에
                보이게 둔다(업체 개명이 잦아 sr-only로 숨기면 사용자가 모른다). */}
            <label className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-xl bg-[#FBF8F2] px-3 focus-within:ring-2 focus-within:ring-[#B89785] sm:gap-3 sm:px-4">
              <Search aria-hidden="true" className="size-4 shrink-0 text-[#243832]/45" />
              <span className="sr-only">업체명 검색</span>
              <input value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="업체명 또는 다른 표기 검색" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#243832]/40" />
            </label>
            <button type="button" onClick={() => setFiltersOpen((value) => !value)} aria-expanded={filtersOpen} className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-xl border border-[#243832]/12 bg-white px-4 text-sm font-bold text-[#243832] md:hidden">
              <Filter aria-hidden="true" className="size-4" />
              필터{activeFilterCount > 0 ? ` ${activeFilterCount}` : ""}
              <ChevronDown aria-hidden="true" className={`size-4 transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
            </button>
          </div>

          <div className={`${filtersOpen ? "block" : "hidden"} mt-4 border-t border-[#243832]/10 pt-4 md:block`}>
            <div className="grid gap-4 md:grid-cols-4">
              <label className="text-xs font-bold text-[#243832]/75">
                지역
                <select value={regionCode} onChange={(event) => {
                  chooseRegion(event.target.value);
                }} className="mt-2 min-h-11 w-full rounded-xl border border-[#243832]/12 bg-[#FBF8F2] px-3 text-sm font-medium text-[#243832] outline-none focus:ring-2 focus:ring-[#B89785]">
                  <option value="">전체 지역</option>
                  {PRICE_REGION_OPTIONS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
                </select>
              </label>
              <label className="text-xs font-bold text-[#243832]/75">
                최소 가격
                <span className="mt-2 flex min-h-11 items-center rounded-xl border border-[#243832]/12 bg-[#FBF8F2] px-3 focus-within:ring-2 focus-within:ring-[#B89785]">
                  <input value={minimumManwon} onChange={(event) => setMinimumManwon(event.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="0" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
                  <span className="text-xs font-medium text-[#243832]/50">만원</span>
                </span>
              </label>
              <label className="text-xs font-bold text-[#243832]/75">
                최대 가격
                <span className="mt-2 flex min-h-11 items-center rounded-xl border border-[#243832]/12 bg-[#FBF8F2] px-3 focus-within:ring-2 focus-within:ring-[#B89785]">
                  <input value={maximumManwon} onChange={(event) => setMaximumManwon(event.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" placeholder="제한 없음" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
                  <span className="text-xs font-medium text-[#243832]/50">만원</span>
                </span>
              </label>
              <label className="text-xs font-bold text-[#243832]/75">
                정렬
                <select value={sort} onChange={(event) => {
                  setSort(event.target.value as "name" | "lowest_price");
                }} className="mt-2 min-h-11 w-full rounded-xl border border-[#243832]/12 bg-[#FBF8F2] px-3 text-sm font-medium text-[#243832] outline-none focus:ring-2 focus:ring-[#B89785]">
                  <option value="name">업체명순</option>
                  <option value="lowest_price">최저가순</option>
                </select>
              </label>
            </div>

            {activeAgencies.length > 0 ? (
              <fieldset className="mt-4">
                <legend className="text-xs font-bold text-[#243832]/75">대행사</legend>
                {/* 대행사가 수십 개라 가로 스크롤(스크롤바 숨김)로는 칸을 뚫고 나가
                    잘려 보였다 — 줄바꿈으로 전부 칸 안에 담고, 기본은 일부만 +
                    "모두 보기"로 펼친다. 선택된 칩은 접힌 상태에서도 항상 보인다. */}
                <div className="mt-2 flex flex-wrap gap-2">
                  {(agencyListOpen
                    ? activeAgencies
                    : activeAgencies.filter((agency, index) => (
                      index < AGENCY_PREVIEW_COUNT || agencyIds.includes(agency.id)
                    ))
                  ).map((agency) => {
                    const checked = agencyIds.includes(agency.id);
                    return (
                      <label key={agency.id} className={`inline-flex min-h-11 cursor-pointer items-center rounded-full border px-3 text-xs font-semibold ${checked ? "border-[#8F6662] bg-[#F5ECE4] text-[#7C5754]" : "border-[#243832]/12 bg-white text-[#243832]/70"}`}>
                        <input type="checkbox" checked={checked} onChange={() => {
                          setAgencyIds((current) => checked ? current.filter((id) => id !== agency.id) : [...current, agency.id]);
                        }} className="sr-only" />
                        {agency.name}
                      </label>
                    );
                  })}
                  {activeAgencies.length > AGENCY_PREVIEW_COUNT ? (
                    <button
                      type="button"
                      onClick={() => setAgencyListOpen((value) => !value)}
                      aria-expanded={agencyListOpen}
                      className="inline-flex min-h-11 items-center gap-1 rounded-full border border-dashed border-[#243832]/25 bg-[#FBF8F2] px-3 text-xs font-semibold text-[#243832]/70 hover:bg-[#F5ECE4]"
                    >
                      {agencyListOpen
                        ? "접기"
                        : `+${activeAgencies.length - Math.min(AGENCY_PREVIEW_COUNT, activeAgencies.length)}개 모두 보기`}
                      <ChevronDown aria-hidden="true" className={`size-3.5 transition-transform ${agencyListOpen ? "rotate-180" : ""}`} />
                    </button>
                  ) : null}
                </div>
              </fieldset>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-[#243832]/10 pt-4">
              {!preview ? <button type="button" onClick={() => {
                if (wishlistHydrationStatus !== "ready") return;
                if (authStatus === "guest") {
                  setShowAuthGate(true);
                  return;
                }
                setWishlistOnly((value) => !value);
              }} disabled={wishlistHydrationStatus !== "ready"} aria-busy={wishlistHydrationStatus === "loading"} aria-pressed={wishlistOnly} className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50 ${wishlistOnly ? "bg-[#8F6662] text-white" : "bg-[#F5ECE4] text-[#243832]"}`}>
                <Heart aria-hidden="true" className="size-4" fill={wishlistOnly ? "currentColor" : "none"} />
                찜한 업체만
              </button> : null}
              {activeFilterCount > 0 ? (
                <button type="button" onClick={resetFilters} className="inline-flex min-h-11 items-center gap-2 rounded-full px-3 text-xs font-bold text-[#243832]/75 hover:bg-[#FBF8F2]">
                  <RotateCcw aria-hidden="true" className="size-3.5" />
                  필터 초기화
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {!preview && wishlistHydrationStatus === "error" ? (
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

        {!preview && authStatus === "authenticated" && savedComboHydrationStatus === "error" ? (
          <div role="alert" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#243832]/15 bg-white px-4 py-3 text-sm text-[#243832]">
            <p className="font-semibold">저장한 조합을 불러오지 못했어요. 현재 담은 조합은 그대로 두었어요.</p>
            <button
              type="button"
              onClick={() => setOwnerStateReload((value) => value + 1)}
              className="inline-flex min-h-11 items-center rounded-full border border-[#243832]/20 bg-[#FBF8F2] px-4 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8F6662]"
            >
              다시 불러오기
            </button>
          </div>
        ) : null}

        {!preview && authStatus === "authenticated"
          && savedComboHydrationStatus === "ready"
          && latestSavedCombo ? (
            <section aria-label="최근 저장 조합" className="mt-4 rounded-2xl border border-[#243832]/12 bg-[#F5ECE4] px-4 py-4 text-[#243832]">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-[11px] font-bold tracking-[0.1em] text-[#8F6662]">최근 저장 조합</p>
                  <p className="mt-1 truncate text-sm font-bold">{latestSavedCombo.name}</p>
                  <p className="mt-1 text-xs leading-5 text-[#243832]/60">현재 공개 중인 업체와 가격이 일치하는 항목만 안전하게 불러옵니다.</p>
                </div>
                {restoreConfirming ? (
                  <div className="flex flex-wrap items-center gap-2" role="group" aria-label="현재 조합 교체 확인">
                    <span className="w-full text-xs font-semibold text-[#7A4742] sm:w-auto">현재 담은 조합을 바꿀까요?</span>
                    <button
                      type="button"
                      onClick={restoreLatestCombo}
                      className="inline-flex min-h-11 items-center rounded-full bg-[#36534E] px-4 text-xs font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8F6662]"
                    >
                      바꾸기
                    </button>
                    <button
                      type="button"
                      onClick={() => setRestoreConfirming(false)}
                      className="inline-flex min-h-11 items-center rounded-full border border-[#243832]/20 bg-white px-4 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8F6662]"
                    >
                      취소
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={restoreLatestCombo}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-[#36534E] px-4 text-xs font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8F6662]"
                  >
                    최근 저장 조합 불러오기
                  </button>
                )}
              </div>
            </section>
          ) : null}

        <div className="mt-6 flex flex-col gap-1.5 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
          <div>
            <p className="text-sm text-[#243832]/75"><strong className="font-bold text-[#243832]">{filtered.length}</strong>개 업체</p>
            {!preview ? (
              <p className="mt-1 max-w-2xl text-xs leading-5 text-[#243832]/70">
                이름이 같거나 같은 업체로 확인된 표기는 한 카드로 모았어요. 지점·동명 업체로 확인된 표기는 따로 보여드려요.
              </p>
            ) : null}
          </div>
          {debouncedSearch ? <p className="max-w-full truncate text-xs text-[#243832]/50 sm:max-w-[35%]">‘{debouncedSearch}’ 검색 결과</p> : null}
        </div>

        {displayVendors.length > 0 ? (
          <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
            {displayVendors.map((vendor) => (
              <PriceVendorCard
                key={vendor.id}
                vendor={vendor}
                agencyOrder={cardAgencyOrder}
                activeRegionCode={regionCode || undefined}
                isWishlisted={wishlistedIds.has(vendor.id)}
                wishlistBusy={preview || wishlistHydrationStatus !== "ready" || wishlistBusyIds.has(vendor.id)}
                onToggleWishlist={toggleWishlist}
                onOpenCombo={preview ? undefined : setComboVendor}
                preview={preview}
              />
            ))}
          </div>
        ) : (
          <div className="mt-4">
            <PriceEmptyState
              category={category}
              regionCode={regionCode || undefined}
              hasOtherFilters={Boolean(debouncedSearch || minimumManwon || maximumManwon || wishlistOnly || agencyIds.length > 0)}
              surface={surface}
              preview={preview}
              onResetFilters={hasRecoverableFilters ? () => {
                setSearchInput("");
                setDebouncedSearch("");
                resetFilters();
              } : undefined}
            />
          </div>
        )}

        <div ref={loadMoreRef} className="flex min-h-16 items-center justify-center" aria-hidden={visibleCount >= filtered.length}>
          {visibleCount < filtered.length ? (
            <button type="button" onClick={() => setVisibleCount((count) => Math.min(count + PAGE_SIZE, filtered.length))} className="min-h-11 rounded-full border border-[#243832]/15 bg-white px-5 text-sm font-bold text-[#243832]">
              더 보기
            </button>
          ) : null}
        </div>

        <PriceDisclosureFooter />
      </section>

      {!preview ? (
        <>
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
        </>
      ) : null}
      <p className="sr-only" role="status" aria-live="polite">{feedback}</p>
      {feedback ? <div className="fixed bottom-40 left-1/2 z-[105] max-w-[calc(100vw-2rem)] -translate-x-1/2 rounded-full bg-[#2B423E] px-4 py-2.5 text-center text-xs font-semibold text-white shadow-xl sm:bottom-32">{feedback}</div> : null}
    </Root>
  );
}
