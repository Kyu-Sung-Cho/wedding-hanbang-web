"use client";

import { useState } from "react";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { AD_DISCLOSURE_OPTIONS } from "@/constants/communityCategories";
import type { AdDisclosure } from "@/types/community.types";

interface AdDisclosureModalProps {
  onSelect: (result: { adDisclosure: AdDisclosure; sponsorshipDetail?: string }) => void;
}

export default function AdDisclosureModal({ onSelect }: AdDisclosureModalProps) {
  const [selected, setSelected] = useState<AdDisclosure | null>(null);
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = () => {
    if (!selected) {
      setError("유형을 선택해주세요.");
      return;
    }
    if (selected === "sponsored") {
      if (!detail.trim() || detail.trim().length < 5) {
        setError("협찬 내용을 5자 이상 입력해주세요.");
        return;
      }
      onSelect({ adDisclosure: "sponsored", sponsorshipDetail: detail.trim() });
      return;
    }
    onSelect({ adDisclosure: selected });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl p-8 shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-2xl font-serif text-[#1A1A1F] mb-2" style={{ fontFamily: "'Paperlogy', sans-serif" }}>
          이 글은 어떤 유형인가요?
        </h2>
        <p className="text-sm text-[#878680] mb-6">
          정직한 표시는 신뢰의 시작이에요. 건너뛸 수 없어요.
        </p>

        <div className="space-y-3">
          {AD_DISCLOSURE_OPTIONS.map((opt) => {
            const isSelected = selected === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => {
                  setSelected(opt.key as AdDisclosure);
                  setError(null);
                }}
                className={`w-full text-left p-4 rounded-xl border-2 transition-all flex items-start gap-3 ${
                  isSelected ? "border-[#1A1A1F]" : "border-[#F0EFED] hover:border-[#B5ADA3]"
                }`}
                style={{
                  backgroundColor: isSelected ? opt.bgColor : "#FFFFFF",
                  borderLeftWidth: 6,
                  borderLeftColor: opt.color,
                }}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-[#1A1A1F]">{opt.label}</span>
                    {isSelected && <CheckCircle2 size={18} style={{ color: opt.color }} />}
                  </div>
                  <p className="text-sm text-[#878680]">{opt.description}</p>
                </div>
              </button>
            );
          })}
        </div>

        {selected === "sponsored" && (
          <div className="mt-5">
            <label className="text-sm font-medium text-[#1A1A1F] mb-2 block">
              어떤 혜택을 받았나요?
            </label>
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="예: 드레스 피팅 1회 무료 제공받음"
              rows={3}
              className="w-full px-4 py-3 border border-[#F0EFED] rounded-xl focus:border-[#36534E] focus:outline-none resize-none text-sm"
            />
          </div>
        )}

        {selected === "ad" && (
          <div className="mt-5 p-4 rounded-xl bg-[#F1F5F9] border border-[#CBD5E1] flex gap-2">
            <AlertTriangle size={18} className="text-[#334155] flex-shrink-0 mt-0.5" />
            <p className="text-sm text-[#334155]">
              광고는 추천/검색 알고리즘에 반영되지 않습니다.
            </p>
          </div>
        )}

        {error && <p className="mt-4 text-sm text-[#EF4444]">{error}</p>}

        <button
          type="button"
          onClick={handleSubmit}
          className="mt-6 w-full bg-[#36534E] text-white rounded-xl py-3 font-medium hover:bg-[#2B423E] transition-colors"
        >
          확인
        </button>
      </div>
    </div>
  );
}
