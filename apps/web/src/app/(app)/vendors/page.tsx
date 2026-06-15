"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Search,
  Star,
  MapPin,
  Sparkles,
  Filter,
  Clock,
  Loader2,
  Heart,
  TrendingUp,
  ArrowRight,
  Image as ImageIcon,
} from "lucide-react";
import Link from "next/link";
import type { Vendor } from "@/types/vendor.types";
import { useEventTracker } from "@/hooks/useEventTracker";
import { useAuthStore } from "@/stores/authStore";
import AmoraDirector from "@/components/app/AmoraDirector";
import { weddingPath } from "@/lib/weddingPaths";

const categories = ["전체", "스튜디오", "드레스", "메이크업", "예식장", "한복", "예물", "신혼여행"];

export default function VendorsPage() {
  const [activeCategory, setActiveCategory] = useState("전체");
  const [searchQuery, setSearchQuery] = useState("");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set());
  const [filterToast, setFilterToast] = useState(false);
  const { trackEvent } = useEventTracker();
  const lastTrackedSearch = useRef("");

  // 즐겨찾기 목록 로드
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/favorites");
        if (res.ok) {
          const data = await res.json();
          setFavoriteIds(new Set(data.vendorIds ?? []));
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const toggleFavorite = async (e: React.MouseEvent, vendorId: string) => {
    e.preventDefault();
    e.stopPropagation();
    const wasFavorite = favoriteIds.has(vendorId);
    // 낙관적 업데이트
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (wasFavorite) next.delete(vendorId);
      else next.add(vendorId);
      return next;
    });
    trackEvent(wasFavorite ? "favorite_remove" : "favorite_add", { vendorId });
    try {
      await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendorId }),
      });
    } catch {
      // 실패 시 롤백
      setFavoriteIds((prev) => {
        const next = new Set(prev);
        if (wasFavorite) next.add(vendorId);
        else next.delete(vendorId);
        return next;
      });
    }
  };

  const fetchVendors = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (activeCategory !== "전체") params.set("category", activeCategory);
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    params.set("limit", "40");

    try {
      const res = await fetch(`/api/vendors?${params}`);
      if (res.ok) {
        const data = await res.json();
        const list = data.vendors ?? [];
        setVendors(list);

        // 검색 이벤트 추적
        const q = searchQuery.trim();
        if (q && q !== lastTrackedSearch.current) {
          lastTrackedSearch.current = q;
          trackEvent("search", {
            metadata: {
              query: q,
              category: activeCategory !== "전체" ? activeCategory : undefined,
              resultCount: list.length,
            },
          });
        }
      }
    } catch (err) {
      console.error("Fetch vendors error:", err);
    } finally {
      setLoading(false);
    }
  }, [activeCategory, searchQuery, trackEvent]);

  useEffect(() => {
    const timer = setTimeout(fetchVendors, searchQuery ? 300 : 0);
    return () => clearTimeout(timer);
  }, [fetchVendors, searchQuery]);

  // 통계치 (현재 로드된 목록 기반)
  const totalCount = vendors.length;
  const favoritesCount = favoriteIds.size;
  const newVendorsCount = useMemo(() => {
    return vendors.filter((v) => v.aiRecommend).length;
  }, [vendors]);

  // AI 추천 로직: 유저 선호도 매칭 기반 TOP 3
  const { journey } = useAuthStore();
  const userPrefs = useMemo(() => {
    return ((journey?.progress ?? {}) as Record<string, unknown>)?.__preferences as
      | {
          weddingStyle?: string | null;
          priorities?: string[];
          budgetAttitude?: string | null;
          guestCount?: string | null;
        }
      | undefined;
  }, [journey]);

  const hasUserPreferences = useMemo(() => {
    return !!(userPrefs && (userPrefs.weddingStyle || (userPrefs.priorities && userPrefs.priorities.length > 0) || userPrefs.budgetAttitude));
  }, [userPrefs]);

  const aiRecommendedIds = useMemo(() => {
    const prefs = userPrefs;

    if (!hasUserPreferences || !prefs) {
      return new Set<string>();
    }

    // 각 업체에 매칭 점수 부여
    const scored = vendors.map((v) => {
      let score = 0;

      // 1. 카테고리 우선순위 매칭 (+3)
      if (prefs.priorities && prefs.priorities.length > 0) {
        const catKeyMap: Record<string, string> = {
          스튜디오: "studio", 드레스: "dress", 메이크업: "makeup",
          예식장: "venue", 한복: "hanbok", 예물: "ring", 신혼여행: "honeymoon",
        };
        const catKey = catKeyMap[v.category ?? ""] ?? v.category;
        if (prefs.priorities.includes(catKey)) score += 3;
      }

      // 2. 평점 높을수록 (+최대 2)
      if (v.rating >= 4.5) score += 2;
      else if (v.rating >= 4.0) score += 1;

      // 3. ai_recommend flag (시드 기본 추천, +1)
      if (v.aiRecommend) score += 1;

      // 4. 예산 성향 매칭 (+2)
      // premium → 고가 업체, 절약 → 저가 업체
      // 가격은 상품 기준이라 간단히 패스

      return { id: v.id, score };
    });

    // 점수 높은 순 TOP 3
    const top = scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);

    return new Set(top.map((t) => t.id));
  }, [vendors, userPrefs, hasUserPreferences]);

  return (
    <div className="min-h-screen bg-[#fcf9f8]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 py-5 sm:py-6">
        {/* Page Header */}
        <section className="mb-5 rounded-[18px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] animate-fade-in sm:p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#36534E]">
            WEDDING HANBANG
          </p>
          <h1 className="mt-1 font-serif-kr text-[26px] font-medium leading-tight text-[#071629] sm:text-[30px]">
            업체 탐색
          </h1>
          <p className="mt-2 text-[13px] font-medium leading-[1.65] text-[#5d6879]">
            예산과 스타일에 맞는 후보를 차분히 비교하고, 마음에 드는 업체를 저장해보세요.
          </p>
        </section>

        {/* Stats Row */}
        <div className="grid grid-cols-1 gap-3 mb-5 sm:grid-cols-2 md:grid-cols-3">
          <div className="relative overflow-hidden rounded-[16px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] animate-fade-in md:p-5">
            <Sparkles className="absolute top-4 right-4 h-5 w-5 text-[#36534E]/25" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#36534E]">
              TOTAL VENDORS
            </p>
            <p className="mt-3 font-serif-kr text-[28px] font-medium leading-none text-[#071629] sm:text-[31px]">
              {totalCount}
            </p>
            <p className="mt-2 text-[13px] font-medium text-[#5d6879]">등록된 업체</p>
          </div>

          <div className="relative overflow-hidden rounded-[16px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] animate-fade-in md:p-5">
            <Heart className="absolute top-4 right-4 h-5 w-5 text-[#36534E]/25" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#36534E]">
              FAVORITES
            </p>
            <p className="mt-3 font-serif-kr text-[28px] font-medium leading-none text-[#071629] sm:text-[31px]">
              {favoritesCount}
            </p>
            <p className="mt-2 text-[13px] font-medium text-[#5d6879]">찜한 업체</p>
            <Link
              href={weddingPath("/vendors/favorites")}
              className="mt-2 inline-flex items-center gap-1 text-[13px] font-semibold text-[#36534E] hover:text-[#2d4642]"
            >
              보기 <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="relative overflow-hidden rounded-[16px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] animate-fade-in sm:col-span-2 md:col-span-1 md:p-5">
            <TrendingUp className="absolute top-4 right-4 h-5 w-5 text-[#36534E]/25" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#36534E]">
              NEW THIS WEEK
            </p>
            <p className="mt-3 font-serif-kr text-[28px] font-medium leading-none text-[#071629] sm:text-[31px]">
              {newVendorsCount || "—"}
            </p>
            <p className="mt-2 text-[13px] font-medium text-[#5d6879]">이번 주 신규</p>
          </div>
        </div>

        {/* AI 추천 안내 배너 — 선호도 없으면 설정 유도 */}
        {aiRecommendedIds.size === 0 && (
          <div className="mb-5 flex flex-col items-start justify-between gap-4 rounded-[18px] border border-[#eadfc9] bg-[#fffdf7]/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] animate-fade-in sm:flex-row sm:items-center sm:p-5">
            <div className="flex items-start sm:items-center gap-4 min-w-0">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#eef4ef] text-[#36534E]">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h3 className="text-[14px] font-semibold text-[#071629]">
                  AI 맞춤 추천을 받아보세요
                </h3>
                <p className="mt-1 text-[13px] font-medium leading-[1.6] text-[#5d6879]">
                  예산과 웨딩 스타일을 알려주시면 어울리는 업체에 ✨ AI 추천 뱃지가 표시돼요
                </p>
              </div>
            </div>
            <Link
              href={weddingPath("/settings")}
              className="inline-flex shrink-0 items-center gap-2 rounded-full bg-[#36534E] px-4 py-2.5 text-[13px] font-semibold text-white shadow-[0_10px_24px_rgba(54,83,78,0.14)] transition-colors hover:bg-[#2d4642]"
            >
              설정하기
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}

        {/* Search + Category Filter Bar */}
        <div className="mb-5 rounded-[18px] border border-[#eadfc9] bg-white/90 p-4 shadow-[0_8px_24px_rgba(8,22,38,0.035)] animate-fade-in md:p-5">
          {/* Search */}
          <div className="relative mb-6">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-[#36534E]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="업체명, 스타일, 지역으로 검색..."
              className="w-full rounded-[14px] border border-[#eadfc9] bg-[#fffdf7] py-3 pl-12 pr-24 text-[14px] font-medium text-[#071629] outline-none placeholder:text-[#9b8f84] focus:ring-2 focus:ring-[#36534E]/20"
            />
            <button
              onClick={() => {
                setFilterToast(true);
                setTimeout(() => setFilterToast(false), 3000);
              }}
              className="absolute right-2.5 top-1/2 flex -translate-y-1/2 items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-[13px] font-semibold text-[#36534E] transition-colors hover:bg-[#eef4ef]"
            >
              <Filter className="w-4 h-4" />
              필터
            </button>
          </div>

          {/* 필터 토스트 */}
          {filterToast && (
            <div className="bg-[#fdf6e6] rounded-xl px-5 py-3.5 mb-4 animate-fade-in">
              <p className="text-sm text-[#7a5a2a]">상세 필터 기능은 준비 중입니다.</p>
            </div>
          )}

          {/* Category Filter */}
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${
                  activeCategory === cat
                    ? "bg-[#36534E] text-white"
                    : "border border-[#eadfc9] bg-white text-[#5d6879] hover:bg-[#fff8ec] hover:text-[#36534E]"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* 로딩 */}
        {loading && (
          <div className="flex justify-center py-20">
            <Loader2 className="w-8 h-8 text-[#795252] animate-spin" />
          </div>
        )}

        {/* Editorial Vendor Grid */}
        {!loading && vendors.length > 0 && (
          <div className="grid grid-cols-1 gap-4 mb-6 sm:grid-cols-2 lg:grid-cols-3">
            {vendors.map((vendor) => {
              const hasSlots = vendor.timeSlots.some((s) => s.available);
              const isFav = favoriteIds.has(vendor.id);
              return (
                <Link
                  key={vendor.id}
                  href={weddingPath(`/vendors/${vendor.id}`)}
                  className="group animate-fade-in"
                >
                  <article className="flex h-full flex-col overflow-hidden rounded-[18px] border border-[#eadfc9] bg-white/90 shadow-[0_8px_24px_rgba(8,22,38,0.035)] transition-all duration-300 hover:shadow-[0_12px_32px_rgba(8,22,38,0.07)]">
                    {/* Image */}
                    <div className="aspect-[4/3] overflow-hidden relative bg-[#f6f3f2]">
                      <div className="w-full h-full flex items-center justify-center text-[#B5ADA3]">
                        <ImageIcon className="w-12 h-12" />
                      </div>

                      {/* 좌상단 뱃지 */}
                      <div className="absolute top-4 left-4 flex gap-2">
                        {aiRecommendedIds.has(vendor.id) && (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-gradient-to-br from-[#795252] to-[#946a6a] text-white text-sm font-medium shadow-lg">
                            <Sparkles className="w-3.5 h-3.5" />
                            AI 추천
                          </span>
                        )}
                        {hasSlots && (
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-sage-500 text-white text-sm font-medium shadow-lg">
                            <Clock className="w-3.5 h-3.5" />
                            예약 가능
                          </span>
                        )}
                      </div>

                      {/* 즐겨찾기 버튼 */}
                      <button
                        onClick={(e) => toggleFavorite(e, vendor.id)}
                        className="absolute top-4 right-4 w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center hover:bg-white transition-colors shadow-sm"
                        aria-label={isFav ? "찜 해제" : "찜하기"}
                      >
                        <Heart
                          className={`w-5 h-5 transition-colors ${
                            isFav ? "text-[#946a6a] fill-[#946a6a]" : "text-[#B5ADA3]"
                          }`}
                        />
                      </button>
                    </div>

                    {/* Content */}
                    <div className="flex flex-1 flex-col min-w-0 p-4">
                      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#36534E]">
                        {vendor.category}
                      </p>
                      <h3 className="font-serif-kr text-[18px] font-medium leading-snug text-[#071629] mb-2 group-hover:text-[#36534E] transition-colors line-clamp-1">
                        {vendor.name}
                      </h3>

                      <div className="mb-3 flex items-center gap-1.5 text-[#5d6879]">
                        <MapPin className="w-4 h-4 text-[#B5ADA3]" />
                        <span className="text-[13px] font-medium line-clamp-1">{vendor.location}</span>
                      </div>

                      {/* Rating + Price */}
                      <div className="flex items-center justify-between mt-auto">
                        <div className="flex items-center gap-1.5 text-[#1b1c1c]">
                          <Star className="h-4 w-4 fill-[#C9A96E] text-[#C9A96E]" />
                          <span className="text-[13px] font-semibold">{vendor.rating}</span>
                          <span className="text-[12px] text-[#5d6879]">({vendor.reviewCount})</span>
                        </div>
                        <span className="text-[13px] font-semibold text-[#36534E]">
                          {vendor.priceRange}
                        </span>
                      </div>

                      {/* Tags */}
                      {vendor.tags && vendor.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-4">
                          {vendor.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="rounded-md bg-[#f7f3ec] px-2.5 py-1 text-[12px] font-medium text-[#5d6879]"
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </article>
                </Link>
              );
            })}
          </div>
        )}

        {/* 빈 상태 */}
        {!loading && vendors.length === 0 && (
          <div className="mb-6 rounded-[18px] border border-[#eadfc9] bg-white/90 p-8 text-center shadow-[0_8px_24px_rgba(8,22,38,0.035)] animate-fade-in">
            {searchQuery.trim() || activeCategory !== "전체" ? (
              <>
                <p className="font-serif-kr text-[22px] font-medium text-[#071629] mb-2">검색 결과가 없습니다</p>
                <p className="text-[13px] font-medium text-[#5d6879]">다른 키워드나 카테고리를 시도해보세요</p>
              </>
            ) : (
              <>
                <p className="font-serif-kr text-[22px] font-medium text-[#071629] mb-2">곧 만날 수 있어요</p>
                <p className="mb-4 text-[13px] font-medium leading-[1.65] text-[#5d6879]">
                  믿을 수 있는 업체만 엄선해서 모시는 중이에요. 등록 직후 알려드릴게요.
                </p>
                <Link
                  href={weddingPath("/chat")}
                  className="inline-flex items-center gap-2 text-[13px] font-semibold text-[#36534E] transition-all hover:gap-3"
                >
                  아모라에게 미리 추천 요청하기
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </>
            )}
          </div>
        )}

        {/* AI Spotlight */}
        <div className="mb-6 rounded-[18px] border border-[#36534E]/20 bg-[#36534E] p-5 shadow-[0_10px_28px_rgba(54,83,78,0.16)] animate-fade-in sm:p-6">
          <div className="max-w-xl">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">
              AMORA CURATION
            </p>
            <h3 className="mt-1 font-serif-kr text-[22px] font-medium leading-tight text-white sm:text-[24px]">
              내 예산과 스타일에 맞는 업체 찾기
            </h3>
            <p className="mt-2 mb-5 text-[13px] font-medium leading-[1.65] text-white/75">
              예산, 지역, 스타일을 알려주시면 AI 아모라가 딱 맞는 업체 3곳을 추천해드려요
            </p>
            <Link
              href={weddingPath("/chat")}
              className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-[13px] font-semibold text-[#36534E] transition-colors hover:bg-[#f7f3ec]"
            >
              맞춤 추천 받기
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>

      {/* 아모라 플로팅 디렉터 */}
      <AmoraDirector
        context="vendors"
        categoryName={activeCategory}
        favoriteCount={favoritesCount}
        hasPreferences={hasUserPreferences}
      />
    </div>
  );
}
