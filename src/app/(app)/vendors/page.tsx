"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Search, Star, MapPin, Sparkles, Filter } from "lucide-react";

const fadeIn = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
};

const categories = ["전체", "스튜디오", "드레스", "메이크업", "예식장", "한복", "예물", "신혼여행"];

interface Vendor {
  name: string;
  category: string;
  location: string;
  priceRange: string;
  rating: number;
  reviewCount: number;
  aiRecommend: boolean;
  tags: string[];
}

const vendors: Vendor[] = [
  {
    name: "로즈스튜디오",
    category: "스튜디오",
    location: "서울 강남구",
    priceRange: "250~350만원",
    rating: 4.8,
    reviewCount: 124,
    aiRecommend: true,
    tags: ["자연광 전문", "보정 퀄리티"],
  },
  {
    name: "블룸 웨딩 스튜디오",
    category: "스튜디오",
    location: "서울 서초구",
    priceRange: "200~300만원",
    rating: 4.6,
    reviewCount: 89,
    aiRecommend: false,
    tags: ["다양한 컨셉", "야외촬영"],
  },
  {
    name: "라비앙로즈 드레스",
    category: "드레스",
    location: "서울 강남구",
    priceRange: "150~250만원",
    rating: 4.9,
    reviewCount: 201,
    aiRecommend: true,
    tags: ["수입 드레스", "피팅 전문"],
  },
  {
    name: "그레이스 드레스샵",
    category: "드레스",
    location: "서울 종로구",
    priceRange: "100~200만원",
    rating: 4.5,
    reviewCount: 67,
    aiRecommend: false,
    tags: ["합리적 가격", "커스텀 가능"],
  },
  {
    name: "뷰티풀 메이크업",
    category: "메이크업",
    location: "서울 강남구",
    priceRange: "80~150만원",
    rating: 4.7,
    reviewCount: 156,
    aiRecommend: true,
    tags: ["본식 전문", "리허설 포함"],
  },
  {
    name: "더 베뉴 웨딩홀",
    category: "예식장",
    location: "서울 송파구",
    priceRange: "400~600만원",
    rating: 4.4,
    reviewCount: 312,
    aiRecommend: false,
    tags: ["대형 홀", "주차 편리"],
  },
  {
    name: "아뜰리에 메이크업",
    category: "메이크업",
    location: "서울 마포구",
    priceRange: "60~120만원",
    rating: 4.6,
    reviewCount: 93,
    aiRecommend: false,
    tags: ["자연스러운 스타일", "출장 가능"],
  },
  {
    name: "소담한복",
    category: "한복",
    location: "서울 종로구",
    priceRange: "50~150만원",
    rating: 4.8,
    reviewCount: 78,
    aiRecommend: true,
    tags: ["맞춤 한복", "양가 어머니"],
  },
];

export default function VendorsPage() {
  const [activeCategory, setActiveCategory] = useState("전체");
  const [searchQuery, setSearchQuery] = useState("");

  const filtered = vendors.filter((v) => {
    const matchCategory = activeCategory === "전체" || v.category === activeCategory;
    const matchSearch = v.name.includes(searchQuery) || v.tags.some((t) => t.includes(searchQuery));
    return matchCategory && matchSearch;
  });

  return (
    <div className="max-w-[1100px] mx-auto">
      {/* 검색바 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5 }}
        className="bg-white rounded-2xl border border-black/[0.04] p-4 mb-6 flex items-center gap-3"
      >
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
      </motion.div>

      {/* 카테고리 탭 */}
      <motion.div
        {...fadeIn}
        transition={{ duration: 0.5, delay: 0.05 }}
        className="flex gap-2 overflow-x-auto pb-4 scrollbar-hide mb-6"
      >
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
      </motion.div>

      {/* 업체 그리드 */}
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        {filtered.map((vendor, i) => (
          <motion.div
            key={vendor.name}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.05 }}
            className="bg-white rounded-2xl border border-black/[0.04] overflow-hidden hover:-translate-y-1 hover:shadow-[0_12px_40px_rgba(0,0,0,0.06)] transition-all duration-300 cursor-pointer group"
          >
            {/* 이미지 플레이스홀더 */}
            <div className="h-[160px] bg-gradient-to-br from-ivory-deep to-ivory-warm relative">
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-[14px] text-taupe-400 font-light">{vendor.category} 사진</span>
              </div>
              {vendor.aiRecommend && (
                <div className="absolute top-3 left-3 flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500 text-white text-[11px] font-medium">
                  <Sparkles className="w-3 h-3" />
                  AI 추천
                </div>
              )}
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
          </motion.div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-20">
          <p className="text-[14px] text-taupe-400">검색 결과가 없습니다</p>
        </div>
      )}
    </div>
  );
}
