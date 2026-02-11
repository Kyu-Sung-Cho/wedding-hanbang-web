"use client";

import { useState, useEffect } from "react";
import {
  Search, MapPin, Star, Filter, X, ChevronDown,
} from "lucide-react";
import {
  Vendor,
  VendorCategory,
  VendorFilter,
  CATEGORY_LABELS,
  REGIONS,
  STYLE_TAGS,
} from "@/types/vendor.types";
import Card from "@/components/ui/Card";
import Input from "@/components/ui/Input";
import Button from "@/components/ui/Button";

const VENDOR_CATEGORIES: { value: VendorCategory; label: string }[] =
  Object.entries(CATEGORY_LABELS).map(([key, label]) => ({
    value: key as VendorCategory,
    label,
  }));

export default function VendorsPage() {
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [loading, setLoading] = useState(false);
  const [total, setTotal] = useState(0);
  const [keyword, setKeyword] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const [filter, setFilter] = useState<VendorFilter>({});
  const [selectedCategory, setSelectedCategory] = useState<
    VendorCategory | ""
  >("");
  const [selectedRegion, setSelectedRegion] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);

  // 업체 검색
  const fetchVendors = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedCategory) params.set("category", selectedCategory);
      if (selectedRegion) params.set("region", selectedRegion);
      if (keyword) params.set("keyword", keyword);
      if (selectedTags.length > 0)
        params.set("styleTags", selectedTags.join(","));

      const res = await fetch(`/api/vendors?${params.toString()}`);
      const data = await res.json();

      if (data.vendors) {
        setVendors(data.vendors);
        setTotal(data.total);
      }
    } catch (error) {
      console.error("업체 검색 실패:", error);
    } finally {
      setLoading(false);
    }
  };

  // 초기 로드 + 필터 변경 시
  useEffect(() => {
    fetchVendors();
  }, [selectedCategory, selectedRegion, selectedTags]);

  // 검색 핸들러
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    fetchVendors();
  };

  // 태그 토글
  const toggleTag = (tag: string) => {
    setSelectedTags((prev) =>
      prev.includes(tag)
        ? prev.filter((t) => t !== tag)
        : [...prev, tag]
    );
  };

  // 필터 초기화
  const clearFilters = () => {
    setSelectedCategory("");
    setSelectedRegion("");
    setSelectedTags([]);
    setKeyword("");
  };

  const hasActiveFilters =
    selectedCategory || selectedRegion || selectedTags.length > 0 || keyword;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* 검색바 */}
      <form onSubmit={handleSearch} className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-taupe-400" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="업체명 또는 키워드로 검색..."
            className="w-full rounded-xl border border-platinum bg-white py-3 pl-11 pr-4 text-sm text-noir-800 placeholder:text-taupe-400 focus:border-rose-500 focus:outline-none focus:ring-2 focus:ring-rose-500/20"
          />
        </div>
        <Button type="submit">검색</Button>
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className={`flex items-center gap-2 rounded-xl border px-4 py-3 text-sm transition-colors ${
            showFilters || hasActiveFilters
              ? "border-rose-500 bg-rose-glow text-rose-500"
              : "border-platinum bg-white text-taupe-500 hover:bg-ivory-50"
          }`}
        >
          <Filter className="h-4 w-4" />
          필터
          {hasActiveFilters && (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] text-white">
              {[selectedCategory, selectedRegion, ...selectedTags].filter(
                Boolean
              ).length}
            </span>
          )}
        </button>
      </form>

      {/* 필터 패널 */}
      {showFilters && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-noir-800">필터</h3>
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 text-xs text-rose-500 hover:underline"
              >
                <X className="h-3 w-3" />
                초기화
              </button>
            )}
          </div>

          {/* 카테고리 */}
          <div className="mb-4">
            <label className="mb-2 block text-xs font-medium text-taupe-500">
              카테고리
            </label>
            <div className="flex flex-wrap gap-2">
              {VENDOR_CATEGORIES.map((cat) => (
                <button
                  key={cat.value}
                  onClick={() =>
                    setSelectedCategory(
                      selectedCategory === cat.value ? "" : cat.value
                    )
                  }
                  className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                    selectedCategory === cat.value
                      ? "bg-rose-500 text-white"
                      : "bg-ivory-100 text-taupe-500 hover:bg-ivory-200"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* 지역 */}
          <div className="mb-4">
            <label className="mb-2 block text-xs font-medium text-taupe-500">
              지역
            </label>
            <div className="flex flex-wrap gap-2">
              {REGIONS.map((region) => (
                <button
                  key={region}
                  onClick={() =>
                    setSelectedRegion(
                      selectedRegion === region ? "" : region
                    )
                  }
                  className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                    selectedRegion === region
                      ? "bg-rose-500 text-white"
                      : "bg-ivory-100 text-taupe-500 hover:bg-ivory-200"
                  }`}
                >
                  {region}
                </button>
              ))}
            </div>
          </div>

          {/* 스타일 태그 */}
          <div>
            <label className="mb-2 block text-xs font-medium text-taupe-500">
              스타일
            </label>
            <div className="flex flex-wrap gap-2">
              {STYLE_TAGS.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`rounded-full px-3 py-1.5 text-xs transition-colors ${
                    selectedTags.includes(tag)
                      ? "bg-rose-500 text-white"
                      : "bg-ivory-100 text-taupe-500 hover:bg-ivory-200"
                  }`}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        </Card>
      )}

      {/* 결과 수 */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-taupe-500">
          {loading ? "검색 중..." : `${total}개 업체`}
        </p>
      </div>

      {/* 업체 목록 */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-rose-500 border-t-transparent" />
        </div>
      ) : vendors.length === 0 ? (
        <Card>
          <div className="py-12 text-center">
            <p className="text-lg text-taupe-400">검색 결과가 없습니다</p>
            <p className="mt-2 text-sm text-taupe-400">
              다른 검색어나 필터를 시도해보세요
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {vendors.map((vendor) => (
            <VendorListCard key={vendor.id} vendor={vendor} />
          ))}
        </div>
      )}
    </div>
  );
}

// 업체 카드 컴포넌트
function VendorListCard({ vendor }: { vendor: Vendor }) {
  return (
    <Card hover padding="none" className="overflow-hidden">
      {/* 썸네일 */}
      <div className="relative h-48 bg-ivory-200">
        {vendor.thumbnail_url ? (
          <img
            src={vendor.thumbnail_url}
            alt={vendor.name}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-4xl">
            🏪
          </div>
        )}
        {vendor.is_verified && (
          <span className="absolute left-3 top-3 rounded-full bg-green-500 px-2 py-0.5 text-[10px] font-medium text-white">
            인증
          </span>
        )}
      </div>

      {/* 정보 */}
      <div className="p-4">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="text-sm font-medium text-noir-800">
              {vendor.name}
            </h3>
            <p className="mt-0.5 text-xs text-taupe-400">
              {CATEGORY_LABELS[vendor.category as VendorCategory] ||
                vendor.category}
            </p>
          </div>
          {vendor.rating != null && (
            <div className="flex items-center gap-1">
              <Star className="h-3.5 w-3.5 fill-gold text-gold" />
              <span className="text-sm font-medium text-noir-800">
                {vendor.rating.toFixed(1)}
              </span>
              {vendor.review_count != null && (
                <span className="text-xs text-taupe-400">
                  ({vendor.review_count})
                </span>
              )}
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center gap-1 text-xs text-taupe-400">
          <MapPin className="h-3 w-3" />
          {vendor.region}
          {vendor.address && ` · ${vendor.address}`}
        </div>

        {vendor.style_tags && vendor.style_tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {vendor.style_tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-ivory-100 px-2 py-0.5 text-[10px] text-taupe-500"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {vendor.is_fixed_price && (
          <div className="mt-2">
            <span className="rounded bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-600">
              정찰제
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}
