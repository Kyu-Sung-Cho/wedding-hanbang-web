"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Star, MapPin, Sparkles, Filter, Clock, Loader2 } from "lucide-react";
import Link from "next/link";
import type { Vendor } from "@/types/vendor.types";

const categories = ["전체", "스튜디오", "드레스", "메이크업", "예식장", "한복", "예물", "신혼여행"];

export default function VendorsPage() {
  const [activeCategory, setActiveCategory] = useState("전체");
  const [searchQuery, setSearchQuery] = useState("");
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(true);

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
        setVendors(data.vendors ?? []);
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

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* 검색바 */}
      <div className="bg-white rounded-2xl border border-black/[0.04] p-4 mb-6 flex items-center gap-3 animate-fade-in">
        <Search className="w-5 h-5 text-taupe-400 flex-shrink-0" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="업체명, 스타일, 지역으로 검색..."
          className="flex-1 text-[14px] text-noir-800 placeholder:text-taupe-400 bg-transparent outline-none"
        />
        <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-ivory-warm text-[12px] text-charcoal hover:bg-ivory-deep transition-colors">
          <Filter className="w-3.5 h-3.5" />
          필터
        </button>
      </div>

      {/* 카테고리 탭 */}
      <div className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide mb-6 animate-fade-in">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`flex-shrink-0 px-4 py-2 rounded-full text-[13px] font-medium transition-colors ${
              activeCategory === cat
                ? "bg-noir-800 text-white"
                : "bg-white text-charcoal border border-black/[0.06] hover:border-rose-500 hover:text-rose-500"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* 로딩 */}
      {loading && (
        <div className="flex justify-center py-20">
          <Loader2 className="w-6 h-6 text-taupe-400 animate-spin" />
        </div>
      )}

      {/* 업체 그리드 */}
      {!loading && (
        <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
          {vendors.map((vendor) => {
            const hasSlots = vendor.timeSlots.some((s) => s.available);
            return (
              <div key={vendor.id} className="animate-fade-in">
                <Link
                  href={`/vendors/${vendor.id}`}
                  className="block bg-white rounded-2xl border border-black/[0.04] overflow-hidden hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.06)] transition-all duration-300 group"
                >
                  {/* 이미지 플레이스홀더 */}
                  <div className="h-[160px] bg-gradient-to-br from-ivory-deep to-ivory-warm relative">
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[14px] text-taupe-400 font-light">{vendor.category} 사진</span>
                    </div>
                    <div className="absolute top-3 left-3 flex gap-2">
                      {vendor.aiRecommend && (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500 text-white text-[11px] font-medium">
                          <Sparkles className="w-3 h-3" />
                          AI 추천
                        </span>
                      )}
                      {hasSlots && (
                        <span className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-[#2E7D5A] text-white text-[11px] font-medium">
                          <Clock className="w-3 h-3" />
                          예약 가능
                        </span>
                      )}
                    </div>
                  </div>

                  {/* 콘텐츠 */}
                  <div className="p-5">
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="text-[15px] font-medium text-noir-800 group-hover:text-rose-500 transition-colors">
                        {vendor.name}
                      </h3>
                      <div className="flex items-center gap-1">
                        <Star className="w-3.5 h-3.5 text-gold fill-gold" />
                        <span className="text-[13px] font-medium text-noir-800">{vendor.rating}</span>
                        <span className="text-[11px] text-taupe-400">({vendor.reviewCount})</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 mb-3">
                      <MapPin className="w-3.5 h-3.5 text-taupe-400" />
                      <span className="text-[12px] text-taupe-500">{vendor.location}</span>
                      <span className="text-[12px] text-taupe-400 mx-1">·</span>
                      <span className="text-[12px] text-rose-500 font-medium">{vendor.priceRange}</span>
                    </div>

                    <div className="flex gap-1.5 flex-wrap">
                      {vendor.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2.5 py-1 rounded-full bg-ivory-warm text-[11px] text-charcoal font-medium"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      )}

      {!loading && vendors.length === 0 && (
        <div className="text-center py-20">
          <p className="text-[14px] text-taupe-400">검색 결과가 없습니다</p>
        </div>
      )}
    </div>
  );
}
