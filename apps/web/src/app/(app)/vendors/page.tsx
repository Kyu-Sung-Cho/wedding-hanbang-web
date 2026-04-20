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
  }, [activeCategory, searchQuery]);

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
  const aiRecommendedIds = useMemo(() => {
    const prefs = ((journey?.progress ?? {}) as Record<string, unknown>)?.__preferences as
      | {
          weddingStyle?: string | null;
          priorities?: string[];
          budgetAttitude?: string | null;
          guestCount?: string | null;
        }
      | undefined;

    // 선호도 없으면 AI 추천 뱃지 미표시
    if (!prefs || (!prefs.weddingStyle && !prefs.priorities && !prefs.budgetAttitude)) {
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
  }, [vendors, journey]);

  return (
    <div className="min-h-screen bg-[#fcf9f8]">
      <div className="max-w-7xl mx-auto px-6 lg:px-12 py-10">
        {/* Hero Banner */}
        <section className="relative rounded-2xl overflow-hidden aspect-[16/5] mb-8 animate-fade-in">
          <div
            className="absolute inset-0"
            style={{
              background: `
                radial-gradient(circle at 20% 50%, rgba(201, 169, 110, 0.4) 0%, transparent 55%),
                radial-gradient(circle at 75% 40%, rgba(121, 82, 82, 0.3) 0%, transparent 55%),
                linear-gradient(135deg, #fcf9f8 0%, #f6f3f2 50%, #dee6c4 100%)
              `,
            }}
          />
          <div className="relative h-full flex items-center px-10 lg:px-16">
            <div>
              <p className="text-xs tracking-widest uppercase text-[#795252] mb-3 font-medium">VENDORS</p>
              <h1 className="font-serif-kr text-5xl lg:text-6xl text-[#1b1c1c] mb-4 leading-tight font-light">
                업체 탐색
              </h1>
              <p className="text-xl text-[#504444] font-light italic">
                당신의 완벽한 결혼을 위한 큐레이션
              </p>
            </div>
          </div>
        </section>

        {/* Stats Row */}
        <div className="grid md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-2xl p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden animate-fade-in">
            <Sparkles className="absolute top-6 right-6 w-6 h-6 text-[#C9A96E]/30" />
            <p className="text-xs tracking-widest uppercase text-[#795252] mb-4 font-medium">
              TOTAL VENDORS
            </p>
            <p className="font-serif-kr text-[72px] leading-none text-[#1b1c1c] mb-2 font-light">
              {totalCount}
            </p>
            <p className="text-base text-[#504444]">등록된 업체</p>
          </div>

          <div className="bg-white rounded-2xl p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden animate-fade-in">
            <Heart className="absolute top-6 right-6 w-6 h-6 text-[#795252]/30" />
            <p className="text-xs tracking-widest uppercase text-[#5a6147] mb-4 font-medium">
              FAVORITES
            </p>
            <p className="font-serif-kr text-[72px] leading-none text-[#1b1c1c] mb-2 font-light">
              {favoritesCount}
            </p>
            <p className="text-base text-[#504444]">찜한 업체</p>
            <Link
              href="/vendors/favorites"
              className="text-[#795252] hover:text-[#946a6a] text-base inline-flex items-center gap-1 mt-2"
            >
              보기 <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <div className="bg-white rounded-2xl p-10 shadow-[0_8px_30px_rgb(0,0,0,0.04)] relative overflow-hidden animate-fade-in">
            <TrendingUp className="absolute top-6 right-6 w-6 h-6 text-[#C9A96E]/30" />
            <p className="text-xs tracking-widest uppercase text-[#C9A96E] mb-4 font-medium">
              NEW THIS WEEK
            </p>
            <p className="font-serif-kr text-[72px] leading-none text-[#1b1c1c] mb-2 font-light">
              {newVendorsCount || "—"}
            </p>
            <p className="text-base text-[#504444]">이번 주 신규</p>
          </div>
        </div>

        {/* AI 추천 안내 배너 — 선호도 없으면 설정 유도 */}
        {aiRecommendedIds.size === 0 && (
          <div className="bg-gradient-to-r from-[#f6f3f2] to-[#fcf9f8] rounded-2xl p-6 mb-8 flex items-center justify-between gap-4 animate-fade-in">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#795252] to-[#946a6a] flex items-center justify-center shrink-0">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div>
                <h3 className="text-lg font-medium text-[#1b1c1c] mb-1">
                  AI 맞춤 추천을 받아보세요
                </h3>
                <p className="text-base text-[#504444]">
                  예산과 웨딩 스타일을 알려주시면 어울리는 업체에 ✨ AI 추천 뱃지가 표시돼요
                </p>
              </div>
            </div>
            <Link
              href="/settings"
              className="shrink-0 inline-flex items-center gap-2 px-5 py-3 rounded-xl bg-gradient-to-br from-[#795252] to-[#946a6a] text-white text-base font-medium shadow-[0_4px_14px_0_rgba(121,82,82,0.2)] hover:shadow-[0_6px_20px_rgba(121,82,82,0.23)] transition-all whitespace-nowrap"
            >
              설정하기
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        )}

        {/* Search + Category Filter Bar */}
        <div className="bg-white rounded-2xl p-6 shadow-[0_8px_30px_rgb(0,0,0,0.04)] mb-8 animate-fade-in">
          {/* Search */}
          <div className="relative mb-6">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 w-5 h-5 text-[#504444]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="업체명, 스타일, 지역으로 검색..."
              className="w-full bg-[#f6f3f2] rounded-xl pl-14 pr-28 py-4 text-base text-[#1b1c1c] outline-none focus:ring-2 focus:ring-[#795252]/30 placeholder:text-[#B5ADA3]"
            />
            <button
              onClick={() => {
                setFilterToast(true);
                setTimeout(() => setFilterToast(false), 3000);
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1.5 px-4 py-2 rounded-full bg-white text-sm text-[#504444] hover:bg-[#EDE7E5] transition-colors"
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
                className={`px-5 py-2.5 rounded-full text-base font-medium transition-colors ${
                  activeCategory === cat
                    ? "bg-[#795252] text-white"
                    : "bg-[#f6f3f2] text-[#504444] hover:bg-[#e4e2e1]"
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
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {vendors.map((vendor) => {
              const hasSlots = vendor.timeSlots.some((s) => s.available);
              const isFav = favoriteIds.has(vendor.id);
              return (
                <Link
                  key={vendor.id}
                  href={`/vendors/${vendor.id}`}
                  className="group animate-fade-in"
                >
                  <article className="bg-white rounded-2xl overflow-hidden shadow-[0_8px_30px_rgb(0,0,0,0.04)] hover:shadow-[0_12px_40px_rgb(0,0,0,0.08)] transition-all duration-300 h-full flex flex-col">
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
                          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-[#5a6147] text-white text-sm font-medium shadow-lg">
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
                    <div className="p-6 flex-1 flex flex-col">
                      <p className="text-xs tracking-widest uppercase text-[#795252] mb-2 font-medium">
                        {vendor.category}
                      </p>
                      <h3 className="font-serif-kr text-2xl text-[#1b1c1c] mb-2 group-hover:text-[#795252] transition-colors line-clamp-1 font-light">
                        {vendor.name}
                      </h3>

                      <div className="flex items-center gap-1.5 text-[#504444] mb-4">
                        <MapPin className="w-4 h-4 text-[#B5ADA3]" />
                        <span className="text-base line-clamp-1">{vendor.location}</span>
                      </div>

                      {/* Rating + Price */}
                      <div className="flex items-center justify-between mt-auto">
                        <div className="flex items-center gap-1.5 text-[#1b1c1c]">
                          <Star className="w-5 h-5 fill-[#C9A96E] text-[#C9A96E]" />
                          <span className="text-base font-medium">{vendor.rating}</span>
                          <span className="text-sm text-[#504444]">({vendor.reviewCount})</span>
                        </div>
                        <span className="text-base font-medium text-[#795252]">
                          {vendor.priceRange}
                        </span>
                      </div>

                      {/* Tags */}
                      {vendor.tags && vendor.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-4">
                          {vendor.tags.slice(0, 3).map((tag) => (
                            <span
                              key={tag}
                              className="px-2.5 py-1 rounded-md bg-[#f6f3f2] text-sm text-[#504444]"
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
          <div className="bg-white rounded-2xl p-16 shadow-[0_8px_30px_rgb(0,0,0,0.04)] text-center mb-8 animate-fade-in">
            <p className="font-serif-kr text-2xl text-[#1b1c1c] mb-2 font-light">검색 결과가 없습니다</p>
            <p className="text-base text-[#504444]">다른 키워드나 카테고리를 시도해보세요</p>
          </div>
        )}

        {/* AI Spotlight */}
        <div className="relative rounded-2xl overflow-hidden bg-gradient-to-br from-[#1a1a1a] to-[#3a2a2a] p-10 mb-8 animate-fade-in">
          <div
            className="absolute inset-0 opacity-40"
            style={{
              background: `radial-gradient(circle at 80% 20%, rgba(201, 169, 110, 0.25) 0%, transparent 50%)`,
            }}
          />
          <div className="relative max-w-xl">
            <p className="text-xs tracking-widest uppercase text-[#C9A96E] mb-3 font-medium">
              AI CURATION
            </p>
            <h3 className="font-serif-kr text-3xl text-white mb-3 font-light">
              내 예산과 스타일에 맞는 업체 찾기
            </h3>
            <p className="text-base text-white/70 mb-6 leading-relaxed">
              예산, 지역, 스타일을 알려주시면 AI 아모라가 딱 맞는 업체 3곳을 추천해드려요
            </p>
            <Link
              href="/chat"
              className="inline-flex items-center gap-2 text-base font-medium text-white border-b border-white/30 hover:border-white pb-1 transition-colors"
            >
              맞춤 추천 받기
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
