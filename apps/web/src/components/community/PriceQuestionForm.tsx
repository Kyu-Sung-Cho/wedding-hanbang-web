"use client";

import { useState, useEffect } from "react";
import { ChevronDown, HelpCircle } from "lucide-react";
import { COHORT_CONTRACT_CATEGORIES } from "@/constants/communityCategories";
import type { PriceData, CohortContractCategory } from "@/types/community.types";

interface PriceQuestionFormProps {
  onChange: (priceData: PriceData | null) => void;
}

export default function PriceQuestionForm({ onChange }: PriceQuestionFormProps) {
  const [enabled, setEnabled] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [vendorCategory, setVendorCategory] = useState<CohortContractCategory>("studio");
  const [basePrice, setBasePrice] = useState<string>("");
  const [extraPrice, setExtraPrice] = useState<string>("");
  const [vendorName, setVendorName] = useState("");
  const [region, setRegion] = useState("");
  const [details, setDetails] = useState("");

  useEffect(() => {
    if (!enabled) {
      onChange(null);
      return;
    }
    const base = parseFloat(basePrice);
    if (isNaN(base) || base <= 0) {
      onChange(null);
      return;
    }
    const extra = parseFloat(extraPrice);
    const data: PriceData = {
      vendor_category: vendorCategory,
      base_price: base,
      extra_price: !isNaN(extra) && extra > 0 ? extra : undefined,
      vendor_name: vendorName.trim() || undefined,
      region: region.trim() || undefined,
      details: details.trim() || undefined,
    };
    onChange(data);
  }, [enabled, vendorCategory, basePrice, extraPrice, vendorName, region, details, onChange]);

  return (
    <div className="bg-white border border-[#F0EFED] rounded-2xl p-5">
      <button
        type="button"
        onClick={() => {
          const nextEnabled = !enabled;
          setEnabled(nextEnabled);
          if (!nextEnabled) setShowDetails(false);
        }}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <HelpCircle size={18} className="text-[#C4967E]" />
          <span className="text-sm font-medium text-[#1A1A1F]">
            이 글은 가격 질문이에요
          </span>
        </div>
        <div
          className={`w-10 h-6 rounded-full transition-colors relative ${
            enabled ? "bg-[#9d6f36]" : "bg-[#F0EFED]"
          }`}
        >
          <div
            className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
              enabled ? "translate-x-[18px]" : "translate-x-0.5"
            }`}
          />
        </div>
      </button>

      {enabled && (
        <div className="mt-5 space-y-4">
          <p className="text-sm leading-relaxed text-[#928980]">
            가격 비교에 필요한 최소 정보만 먼저 적어도 충분해요. 업체명과 세부 조건은 필요할 때만 추가하세요.
          </p>

          <div>
            <label className="text-sm font-medium text-[#1A1A1F] mb-2 block">카테고리</label>
            <select
              value={vendorCategory}
              onChange={(e) => setVendorCategory(e.target.value as CohortContractCategory)}
              className="w-full px-4 py-3 border border-[#F0EFED] rounded-xl focus:border-[#C4967E] focus:outline-none bg-white"
            >
              {COHORT_CONTRACT_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium text-[#1A1A1F] mb-2 block">
                기본금 (만원) *
              </label>
              <input
                type="number"
                value={basePrice}
                onChange={(e) => setBasePrice(e.target.value)}
                placeholder="예: 300"
                className="w-full px-4 py-3 border border-[#F0EFED] rounded-xl focus:border-[#C4967E] focus:outline-none"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-[#1A1A1F] mb-2 block">
                추가금 (만원)
              </label>
              <input
                type="number"
                value={extraPrice}
                onChange={(e) => setExtraPrice(e.target.value)}
                placeholder="예: 50"
                className="w-full px-4 py-3 border border-[#F0EFED] rounded-xl focus:border-[#C4967E] focus:outline-none"
              />
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowDetails((value) => !value)}
            aria-expanded={showDetails}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[#795252] hover:text-[#9d6f36]"
          >
            업체명·지역·상세 내역 추가
            <ChevronDown
              size={16}
              className={`transition-transform ${showDetails ? "rotate-180" : ""}`}
              aria-hidden="true"
            />
          </button>

          {showDetails && (
            <div className="space-y-4 rounded-2xl bg-[#FDFCFA] p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="text-sm font-medium text-[#1A1A1F] mb-2 block">업체명</label>
                  <input
                    type="text"
                    value={vendorName}
                    onChange={(e) => setVendorName(e.target.value)}
                    placeholder="선택 사항"
                    className="w-full px-4 py-3 border border-[#F0EFED] rounded-xl focus:border-[#C4967E] focus:outline-none"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium text-[#1A1A1F] mb-2 block">지역</label>
                  <input
                    type="text"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    placeholder="예: 서울 강남"
                    className="w-full px-4 py-3 border border-[#F0EFED] rounded-xl focus:border-[#C4967E] focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm font-medium text-[#1A1A1F] mb-2 block">상세 내역</label>
                <textarea
                  value={details}
                  onChange={(e) => setDetails(e.target.value)}
                  rows={3}
                  placeholder="포함 내역, 조건 등 (선택)"
                  className="w-full px-4 py-3 border border-[#F0EFED] rounded-xl focus:border-[#C4967E] focus:outline-none resize-none text-sm"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
