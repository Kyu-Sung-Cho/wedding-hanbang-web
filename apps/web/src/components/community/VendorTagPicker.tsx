"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Image from "next/image";
import { Search, X, Store } from "lucide-react";
import type { VendorTagInfo } from "@/types/community.types";

interface VendorTagPickerProps {
  vendorIds: string[];
  onChange: (ids: string[]) => void;
}

export default function VendorTagPicker({
  vendorIds,
  onChange,
}: VendorTagPickerProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<VendorTagInfo[]>([]);
  const [selectedVendors, setSelectedVendors] = useState<VendorTagInfo[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const MAX_VENDORS = 5;

  // 기존 vendorIds에 해당하는 벤더 정보 로드
  useEffect(() => {
    if (vendorIds.length === 0) return;
    // 이미 선택된 벤더 정보가 있으면 스킵
    if (selectedVendors.length === vendorIds.length) return;

    Promise.all(
      vendorIds.map(async (id) => {
        try {
          const res = await fetch(`/api/vendors?id=${id}`);
          if (!res.ok) return null;
          const data = await res.json();
          return data as VendorTagInfo;
        } catch {
          return null;
        }
      })
    ).then((vendors) => {
      setSelectedVendors(vendors.filter((v): v is VendorTagInfo => v !== null));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 디바운스 검색
  const searchVendors = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(
        `/api/vendors?search=${encodeURIComponent(q)}`
      );
      if (!res.ok) throw new Error();
      const data = await res.json();
      const list: VendorTagInfo[] = Array.isArray(data)
        ? data
        : data.vendors ?? [];
      setResults(list);
      setIsOpen(true);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const handleQueryChange = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchVendors(value), 300);
  };

  // 외부 클릭 감지
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const addVendor = (vendor: VendorTagInfo) => {
    if (vendorIds.includes(vendor.id)) return;
    if (vendorIds.length >= MAX_VENDORS) return;
    setSelectedVendors((prev) => [...prev, vendor]);
    onChange([...vendorIds, vendor.id]);
    setQuery("");
    setResults([]);
    setIsOpen(false);
  };

  const removeVendor = (id: string) => {
    setSelectedVendors((prev) => prev.filter((v) => v.id !== id));
    onChange(vendorIds.filter((vid) => vid !== id));
  };

  return (
    <div className="space-y-3">
      {/* 선택된 벤더 배지 */}
      {selectedVendors.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedVendors.map((v) => (
            <span
              key={v.id}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm bg-white border border-[#F5F2ED] rounded-xl"
            >
              {v.thumbnail_url ? (
                <Image
                  src={v.thumbnail_url}
                  alt=""
                  width={20}
                  height={20}
                  className="w-5 h-5 rounded-full object-cover"
                />
              ) : (
                <Store className="w-4 h-4 text-[#B5ADA3]" />
              )}
              <span className="text-[#1A1A1F]">{v.business_name}</span>
              <span className="text-xs text-[#B5ADA3]">{v.category}</span>
              <button
                type="button"
                onClick={() => removeVendor(v.id)}
                className="p-0.5 text-[#B5ADA3] hover:text-[#36534E] transition-colors"
                aria-label={`${v.business_name} 제거`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* 검색 입력 */}
      {vendorIds.length < MAX_VENDORS && (
        <div ref={containerRef} className="relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#B5ADA3]" />
            <input
              type="text"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              onFocus={() => {
                if (results.length > 0) setIsOpen(true);
              }}
              placeholder="업체명 검색 (2글자 이상)"
              className="w-full pl-10 pr-4 py-2.5 text-sm text-[#1A1A1F] bg-[#FAF8F5] border border-[#F5F2ED] rounded-xl placeholder:text-[#B5ADA3] focus:outline-none focus:border-[#36534E] focus:ring-1 focus:ring-[#36534E]/30 transition-colors"
            />
          </div>

          {/* 드롭다운 결과 */}
          {isOpen && (
            <div className="absolute z-20 mt-1 w-full max-h-60 overflow-y-auto bg-white border border-[#F5F2ED] rounded-xl shadow-lg">
              {loading ? (
                <div className="px-4 py-3 text-sm text-[#B5ADA3]">
                  검색 중...
                </div>
              ) : results.length === 0 ? (
                <div className="px-4 py-3 text-sm text-[#B5ADA3]">
                  검색 결과가 없습니다
                </div>
              ) : (
                results.map((vendor) => {
                  const isSelected = vendorIds.includes(vendor.id);
                  return (
                    <button
                      key={vendor.id}
                      type="button"
                      onClick={() => addVendor(vendor)}
                      disabled={isSelected}
                      className={`flex items-center gap-3 w-full px-4 py-3 text-left hover:bg-[#FAF8F5] transition-colors ${
                        isSelected ? "opacity-40 cursor-not-allowed" : ""
                      }`}
                    >
                      {vendor.thumbnail_url ? (
                        <Image
                          src={vendor.thumbnail_url}
                          alt=""
                          width={32}
                          height={32}
                          className="w-8 h-8 rounded-lg object-cover bg-[#F5F2ED]"
                        />
                      ) : (
                        <div className="w-8 h-8 rounded-lg bg-[#F5F2ED] flex items-center justify-center">
                          <Store className="w-4 h-4 text-[#B5ADA3]" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[#1A1A1F] truncate">
                          {vendor.business_name}
                        </p>
                        <p className="text-xs text-[#B5ADA3]">
                          {vendor.category}
                          {vendor.rating != null &&
                            ` / ${vendor.rating.toFixed(1)}점`}
                        </p>
                      </div>
                      {isSelected && (
                        <span className="ml-auto text-xs text-[#36534E]">
                          선택됨
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      <p className="text-xs text-[#B5ADA3]">
        {vendorIds.length}/{MAX_VENDORS}개 업체 태그
      </p>
    </div>
  );
}
