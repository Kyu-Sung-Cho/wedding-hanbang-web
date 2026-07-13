"use client";

import { useState } from "react";
import { getRegionalCosts, REGION_LABELS, type RegionKey } from "@/constants/marketPrices";

interface RegionalCostTableProps {
  periodId: string;
}

type SortKey = "venueAverage" | "meal" | "sdm" | "rental" | "decoration";

function formatMan(value: number) {
  return `${value.toLocaleString()}만원`;
}

function SortHeader({
  label,
  field,
  sortKey,
  sortAsc,
  onSort,
}: {
  label: string;
  field: SortKey;
  sortKey: SortKey;
  sortAsc: boolean;
  onSort: (key: SortKey) => void;
}) {
  return (
    <button
      onClick={() => onSort(field)}
      className={`flex items-center justify-end gap-1 text-right text-[11px] font-semibold ${
        sortKey === field ? "text-[#36534E]" : "text-[#7a8290]"
      }`}
    >
      {label}
      {sortKey === field && (
        <span className="text-[9px]">{sortAsc ? "▲" : "▼"}</span>
      )}
    </button>
  );
}

export default function RegionalCostTable({ periodId }: RegionalCostTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("venueAverage");
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<RegionKey | null>(null);

  const costs = getRegionalCosts(periodId).map(cost => ({
    ...cost,
    venueAverage: Math.round((cost.meal + cost.rental + cost.decoration) * 10) / 10,
  }));
  const sorted = [...costs].sort((a, b) => {
    const diff = a[sortKey] - b[sortKey];
    return sortAsc ? diff : -diff;
  });

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  const selectedCost = selectedRegion ? costs.find(c => c.region === selectedRegion) : null;

  return (
    <div className="space-y-4">
      {/* 지역 선택 Pills */}
      <div className="flex flex-wrap gap-2">
        {costs.map(c => (
          <button
            key={c.region}
            onClick={() => setSelectedRegion(selectedRegion === c.region ? null : c.region)}
            className={`rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
              selectedRegion === c.region
                ? "border-[#36534E] bg-[#36534E] text-white"
                : "border-[#eadfc9] bg-white text-[#5d6879] hover:bg-[#fff8ec] hover:text-[#36534E]"
            }`}
          >
            {REGION_LABELS[c.region]}
          </button>
        ))}
      </div>

      {/* 선택된 지역 상세 카드 */}
      {selectedCost && (
        <div className="rounded-[16px] border border-[#eadfc9] bg-[#fffdf7] p-4">
          <h4 className="mb-2 font-serif-kr text-[20px] font-medium text-[#071629]">
            {REGION_LABELS[selectedCost.region]}
          </h4>
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-[12px] border border-[#eadfc9]/70 bg-white p-3">
              <p className="mb-1 text-[11px] font-semibold text-[#7a8290]">예식장 평균 계약금액</p>
              <p className="font-serif-kr text-[24px] font-medium text-[#071629]">{formatMan(selectedCost.venueAverage)}</p>
            </div>
            <div className="rounded-[12px] border border-[#eadfc9]/70 bg-white p-3">
              <p className="mb-1 text-[11px] font-semibold text-[#7a8290]">스드메 평균 계약금액</p>
              <p className="font-serif-kr text-[24px] font-medium text-[#071629]">{formatMan(selectedCost.sdm)}</p>
            </div>
          </div>
          <p className="mb-2 text-[11px] font-semibold text-[#7a8290]">예식장 평균 구성</p>
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "식대", value: selectedCost.meal },
              { label: "대관료", value: selectedCost.rental },
              { label: "기본 장식", value: selectedCost.decoration },
            ].map(item => (
              <div key={item.label} className="rounded-[12px] border border-[#eadfc9]/70 bg-white p-3 text-center max-sm:col-span-3">
                <p className="mb-1 text-[11px] font-semibold text-[#7a8290]">{item.label}</p>
                <p className="text-[13px] font-semibold text-[#071629]">
                  {formatMan(item.value)}
                </p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[11px] font-medium leading-[1.6] text-[#7a8290]">
            예식장과 스드메는 별도 조사 항목입니다. 두 금액을 합산하지 않고 각각 확인하세요.
          </p>
        </div>
      )}

      {/* 테이블 */}
      <div className="overflow-x-auto rounded-[16px] border border-[#eadfc9] bg-white">
        <table className="w-full min-w-[660px] text-[12px]">
          <thead>
            <tr className="border-b border-[#eadfc9]/70 bg-[#fffdf7]">
              <th className="px-3 py-3 text-left text-[11px] font-semibold text-[#7a8290]">지역</th>
              <th className="text-right py-3 px-2"><SortHeader label="예식장 평균" field="venueAverage" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} /></th>
              <th className="text-right py-3 px-2"><SortHeader label="스드메 평균" field="sdm" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} /></th>
              <th className="text-right py-3 px-2"><SortHeader label="식대" field="meal" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} /></th>
              <th className="text-right py-3 px-2"><SortHeader label="대관료" field="rental" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} /></th>
              <th className="text-right py-3 px-2 max-md:hidden"><SortHeader label="기본 장식" field="decoration" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} /></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map(c => (
              <tr
                key={c.region}
                onClick={() => setSelectedRegion(selectedRegion === c.region ? null : c.region)}
                className={`cursor-pointer border-b border-[#eadfc9]/60 transition-colors last:border-b-0 ${
                  selectedRegion === c.region
                    ? "bg-[#fff8ec]"
                    : "hover:bg-[#fffdf7]"
                }`}
              >
                <td className="px-3 py-3 font-semibold text-[#071629]">
                  {REGION_LABELS[c.region]}
                </td>
                <td className="px-2 py-3 text-right font-semibold text-[#071629]">
                  {formatMan(c.venueAverage)}
                </td>
                <td className="px-2 py-3 text-right font-medium text-[#5d6879]">
                  {formatMan(c.sdm)}
                </td>
                <td className="px-2 py-3 text-right font-medium text-[#5d6879]">
                  {formatMan(c.meal)}
                </td>
                <td className="px-2 py-3 text-right font-medium text-[#5d6879]">
                  {formatMan(c.rental)}
                </td>
                <td className="px-2 py-3 text-right font-medium text-[#7a8290] max-md:hidden">
                  {formatMan(c.decoration)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
