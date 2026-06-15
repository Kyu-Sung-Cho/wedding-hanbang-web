"use client";

import { useState, useCallback } from "react";
import {
  Plus,
  Trash2,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { COST_SHARE_CATEGORIES } from "@/constants/communityCategories";
import type {
  CostShareData,
  CostShareCategory,
} from "@/types/community.types";

interface CostShareEditorProps {
  data: CostShareData;
  onChange: (data: CostShareData) => void;
}

const REGIONS = [
  "서울",
  "경기",
  "부산",
  "대구",
  "대전",
  "광주",
  "인천",
  "기타",
];

// 빈 카테고리 행 생성
function emptyCategoryRow(key: string, label: string): CostShareCategory {
  return { key, label, cost: 0, vendor: "", contractCost: 0, extraCost: 0, notes: "" };
}

export default function CostShareEditor({
  data,
  onChange,
}: CostShareEditorProps) {
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  // 카테고리 합계
  const categoryTotal = data.categories.reduce((sum, c) => sum + (c.cost || 0), 0);
  const hasMismatch =
    data.totalCost > 0 && categoryTotal > 0 && data.totalCost !== categoryTotal;

  // 필드 업데이트 헬퍼
  const updateField = useCallback(
    <K extends keyof CostShareData>(key: K, value: CostShareData[K]) => {
      onChange({ ...data, [key]: value });
    },
    [data, onChange]
  );

  // 카테고리 행 업데이트
  const updateCategory = useCallback(
    (index: number, field: keyof CostShareCategory, value: string | number) => {
      const newCategories = [...data.categories];
      newCategories[index] = { ...newCategories[index], [field]: value };
      onChange({ ...data, categories: newCategories });
    },
    [data, onChange]
  );

  // 카테고리 행 추가
  const addCategory = useCallback(
    (key: string, label: string) => {
      onChange({
        ...data,
        categories: [...data.categories, emptyCategoryRow(key, label)],
      });
    },
    [data, onChange]
  );

  // 카테고리 행 삭제
  const removeCategory = useCallback(
    (index: number) => {
      const newCategories = data.categories.filter((_, i) => i !== index);
      onChange({ ...data, categories: newCategories });
      setExpandedRows((prev) => {
        const next = new Set<number>();
        prev.forEach((i) => {
          if (i < index) next.add(i);
          else if (i > index) next.add(i - 1);
        });
        return next;
      });
    },
    [data, onChange]
  );

  const toggleExpand = (index: number) => {
    setExpandedRows((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  // 추가 가능한 카테고리 목록
  const usedKeys = new Set(data.categories.map((c) => c.key));
  const availableCategories = COST_SHARE_CATEGORIES.filter(
    (c) => !usedKeys.has(c.key)
  );

  // 숫자 입력 핸들러 (만원 단위)
  const numInput = (
    value: number,
    onChangeVal: (v: number) => void,
    placeholder: string
  ) => (
    <input
      type="number"
      min={0}
      max={999999}
      value={value || ""}
      onChange={(e) => onChangeVal(Math.min(Number(e.target.value) || 0, 999999))}
      placeholder={placeholder}
      className="w-full px-3 py-2 text-sm text-[#1A1A1F] bg-[#FAF8F5] border border-[#F5F2ED] rounded-xl placeholder:text-[#B5ADA3] focus:outline-none focus:border-[#36534E] focus:ring-1 focus:ring-[#36534E]/30 transition-colors [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
    />
  );

  return (
    <div className="space-y-5">
      {/* 기본 정보 */}
      <div className="bg-white border border-[#F5F2ED] rounded-2xl p-4 sm:p-5 space-y-4">
        <h4 className="text-sm font-medium text-[#1A1A1F]">
          기본 정보
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* 총 비용 */}
          <div>
            <label className="block text-xs font-medium text-[#928980] mb-1.5">
              총 비용 (만원)
            </label>
            {numInput(data.totalCost, (v) => updateField("totalCost", v), "예: 3000")}
          </div>

          {/* 지역 */}
          <div>
            <label className="block text-xs font-medium text-[#928980] mb-1.5">
              지역
            </label>
            <select
              value={data.region}
              onChange={(e) => updateField("region", e.target.value)}
              className="w-full px-3 py-2 text-sm text-[#1A1A1F] bg-[#FAF8F5] border border-[#F5F2ED] rounded-xl focus:outline-none focus:border-[#36534E] focus:ring-1 focus:ring-[#36534E]/30 transition-colors appearance-none"
            >
              <option value="">선택하세요</option>
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </div>

          {/* 하객 수 */}
          <div>
            <label className="block text-xs font-medium text-[#928980] mb-1.5">
              하객 수
            </label>
            {numInput(data.guestCount, (v) => updateField("guestCount", v), "예: 200")}
          </div>

          {/* 결혼 시기 */}
          <div>
            <label className="block text-xs font-medium text-[#928980] mb-1.5">
              결혼 시기
            </label>
            <input
              type="month"
              value={data.weddingDate}
              onChange={(e) => updateField("weddingDate", e.target.value)}
              className="w-full px-3 py-2 text-sm text-[#1A1A1F] bg-[#FAF8F5] border border-[#F5F2ED] rounded-xl focus:outline-none focus:border-[#36534E] focus:ring-1 focus:ring-[#36534E]/30 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* 카테고리별 비용 */}
      <div className="bg-white border border-[#F5F2ED] rounded-2xl p-4 sm:p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-medium text-[#1A1A1F]">
            항목별 비용
          </h4>
          <div className="text-xs text-[#928980]">
            소계:{" "}
            <span className="font-medium text-emerald-600">
              {categoryTotal.toLocaleString()}만원
            </span>
          </div>
        </div>

        {/* 합계 불일치 경고 */}
        {hasMismatch && (
          <div className="flex items-center gap-2 px-3 py-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              총 비용({data.totalCost.toLocaleString()}만원)과 항목 합계(
              {categoryTotal.toLocaleString()}만원)가 다릅니다.
            </span>
          </div>
        )}

        {/* 카테고리 행들 */}
        <div className="space-y-2">
          {data.categories.map((cat, i) => (
            <div
              key={`${cat.key}-${i}`}
              className="border border-[#F5F2ED] rounded-xl overflow-hidden"
            >
              {/* 행 헤더 */}
              <div className="flex items-center gap-3 px-4 py-3 bg-[#FAF8F5]">
                <button
                  type="button"
                  onClick={() => toggleExpand(i)}
                  className="p-0.5 text-[#B5ADA3] hover:text-[#928980] transition-colors"
                >
                  {expandedRows.has(i) ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
                <span className="text-sm font-medium text-[#1A1A1F] min-w-[80px]">
                  {cat.label}
                </span>
                <div className="flex-1">
                  {numInput(
                    cat.cost,
                    (v) => updateCategory(i, "cost", v),
                    "비용 (만원)"
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => removeCategory(i)}
                  className="p-1.5 text-[#B5ADA3] hover:text-red-500 transition-colors"
                  aria-label={`${cat.label} 삭제`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {/* 상세 필드 (확장 시) */}
              {expandedRows.has(i) && (
                <div className="px-4 py-3 space-y-3 bg-white">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-[#B5ADA3] mb-1">
                        업체명
                      </label>
                      <input
                        type="text"
                        value={cat.vendor || ""}
                        onChange={(e) =>
                          updateCategory(i, "vendor", e.target.value)
                        }
                        placeholder="업체명"
                        className="w-full px-3 py-2 text-sm text-[#1A1A1F] bg-[#FAF8F5] border border-[#F5F2ED] rounded-xl placeholder:text-[#B5ADA3] focus:outline-none focus:border-[#36534E] focus:ring-1 focus:ring-[#36534E]/30 transition-colors"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#B5ADA3] mb-1">
                        계약금 (만원)
                      </label>
                      {numInput(
                        cat.contractCost || 0,
                        (v) => updateCategory(i, "contractCost", v),
                        "계약금"
                      )}
                    </div>
                    <div>
                      <label className="block text-xs text-[#B5ADA3] mb-1">
                        추가금 (만원)
                      </label>
                      {numInput(
                        cat.extraCost || 0,
                        (v) => updateCategory(i, "extraCost", v),
                        "추가금"
                      )}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-[#B5ADA3] mb-1">
                      메모
                    </label>
                    <input
                      type="text"
                      value={cat.notes || ""}
                      onChange={(e) =>
                        updateCategory(i, "notes", e.target.value)
                      }
                      placeholder="참고사항"
                      className="w-full px-3 py-2 text-sm text-[#1A1A1F] bg-[#FAF8F5] border border-[#F5F2ED] rounded-xl placeholder:text-[#B5ADA3] focus:outline-none focus:border-[#36534E] focus:ring-1 focus:ring-[#36534E]/30 transition-colors"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* 카테고리 추가 */}
        {availableCategories.length > 0 && (
          <div className="relative group">
            <button
              type="button"
              className="flex items-center gap-2 px-4 py-2.5 text-sm text-[#928980] bg-[#FAF8F5] border border-dashed border-[#F5F2ED] rounded-xl hover:border-[#36534E] hover:text-[#36534E] transition-colors w-full justify-center"
            >
              <Plus className="w-4 h-4" />
              항목 추가
            </button>
            {/* 드롭다운 */}
            <div className="hidden group-focus-within:block absolute z-10 mt-1 w-full max-h-52 overflow-y-auto bg-white border border-[#F5F2ED] rounded-xl shadow-lg">
              {availableCategories.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => addCategory(c.key, c.label)}
                  className="w-full text-left px-4 py-2.5 text-sm text-[#1A1A1F] hover:bg-[#FAF8F5] transition-colors"
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 소감 */}
      <div className="bg-white border border-[#F5F2ED] rounded-2xl p-4 sm:p-5 space-y-4">
        <h4 className="text-sm font-medium text-[#1A1A1F]">
          소감 (선택)
        </h4>

        <div>
          <label className="block text-xs font-medium text-[#928980] mb-1.5">
            후회한 점
          </label>
          <textarea
            value={data.regretPoints || ""}
            onChange={(e) => updateField("regretPoints", e.target.value)}
            placeholder="돌이켜 보면 아쉬웠던 점..."
            rows={3}
            className="w-full px-4 py-3 text-sm text-[#1A1A1F] bg-[#FAF8F5] border border-[#F5F2ED] rounded-xl placeholder:text-[#B5ADA3] focus:outline-none focus:border-[#36534E] focus:ring-1 focus:ring-[#36534E]/30 transition-colors resize-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[#928980] mb-1.5">
            잘한 점
          </label>
          <textarea
            value={data.goodPoints || ""}
            onChange={(e) => updateField("goodPoints", e.target.value)}
            placeholder="만족했던 선택이나 결정..."
            rows={3}
            className="w-full px-4 py-3 text-sm text-[#1A1A1F] bg-[#FAF8F5] border border-[#F5F2ED] rounded-xl placeholder:text-[#B5ADA3] focus:outline-none focus:border-[#36534E] focus:ring-1 focus:ring-[#36534E]/30 transition-colors resize-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-[#928980] mb-1.5">
            예비 부부에게 조언
          </label>
          <textarea
            value={data.advice || ""}
            onChange={(e) => updateField("advice", e.target.value)}
            placeholder="예비 신랑신부에게 해주고 싶은 말..."
            rows={3}
            className="w-full px-4 py-3 text-sm text-[#1A1A1F] bg-[#FAF8F5] border border-[#F5F2ED] rounded-xl placeholder:text-[#B5ADA3] focus:outline-none focus:border-[#36534E] focus:ring-1 focus:ring-[#36534E]/30 transition-colors resize-none"
          />
        </div>
      </div>
    </div>
  );
}
