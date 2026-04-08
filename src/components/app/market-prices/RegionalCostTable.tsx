"use client";

import { useState } from "react";
import { getRegionalCosts, REGION_LABELS, type RegionKey, type RegionalCost } from "@/constants/marketPrices";

interface RegionalCostTableProps {
  periodId: string;
}

type SortKey = "total" | "meal" | "sdm" | "rental" | "decoration";

export default function RegionalCostTable({ periodId }: RegionalCostTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("total");
  const [sortAsc, setSortAsc] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<RegionKey | null>(null);

  const costs = getRegionalCosts(periodId);
  const sorted = [...costs].sort((a, b) => {
    const diff = a[sortKey] - b[sortKey];
    return sortAsc ? diff : -diff;
  });

  const maxTotal = Math.max(...costs.map(c => c.total));

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  const selectedCost = selectedRegion ? costs.find(c => c.region === selectedRegion) : null;

  const SortHeader = ({ label, field }: { label: string; field: SortKey }) => (
    <button
      onClick={() => handleSort(field)}
      className={`text-right text-[27px] font-medium flex items-center gap-1 justify-end ${
        sortKey === field ? "text-rose-500" : "text-taupe-500"
      }`}
    >
      {label}
      {sortKey === field && (
        <span className="text-[53px]">{sortAsc ? "▲" : "▼"}</span>
      )}
    </button>
  );

  return (
    <div className="space-y-4">
      {/* 지역 선택 Pills */}
      <div className="flex flex-wrap gap-2">
        {costs.map(c => (
          <button
            key={c.region}
            onClick={() => setSelectedRegion(selectedRegion === c.region ? null : c.region)}
            className={`px-3 py-1.5 rounded-full text-[47px] font-medium transition-colors ${
              selectedRegion === c.region
                ? "bg-rose-500 text-white"
                : "bg-ivory-100 text-taupe-500 hover:bg-ivory-200"
            }`}
          >
            {REGION_LABELS[c.region]}
          </button>
        ))}
      </div>

      {/* 선택된 지역 상세 카드 */}
      {selectedCost && (
        <div className="bg-gradient-to-br from-rose-500/5 to-[#C9A96E]/5 rounded-2xl p-5 border border-black/[0.04]">
          <h4 className="font-serif-kr text-[44px] text-noir-800 mb-3">
            {REGION_LABELS[selectedCost.region]}
          </h4>
          <p className="font-display text-[56px] font-light text-noir-800 mb-4">
            {selectedCost.total.toLocaleString()}<span className="text-[53px] text-taupe-500 ml-1">만원</span>
          </p>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "식대", value: selectedCost.meal, color: "#C4967E" },
              { label: "스드메", value: selectedCost.sdm, color: "#C9A96E" },
              { label: "대관료", value: selectedCost.rental, color: "#928980" },
              { label: "꽃장식", value: selectedCost.decoration, color: "#B5ADA3" },
            ].map(item => (
              <div key={item.label} className="text-center">
                <p className="text-[27px] text-taupe-500 mb-1">{item.label}</p>
                <p className="text-[25px] font-medium" style={{ color: item.color }}>
                  {item.value.toLocaleString()}
                </p>
                <p className="text-[25px] text-taupe-400">만원</p>
              </div>
            ))}
          </div>
          {/* 전국 평균 대비 바 */}
          <div className="mt-4">
            <div className="flex justify-between text-[25px] text-taupe-400 mb-1">
              <span>전국 평균 대비</span>
              <span>{Math.round((selectedCost.total / (costs.reduce((s, c) => s + c.total, 0) / costs.length)) * 100)}%</span>
            </div>
            <div className="h-2 bg-ivory-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-rose-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min((selectedCost.total / maxTotal) * 100, 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 테이블 */}
      <div className="overflow-x-auto">
        <table className="w-full text-[47px]">
          <thead>
            <tr className="border-b border-black/[0.06]">
              <th className="text-left py-3 px-2 text-[27px] font-medium text-taupe-500">지역</th>
              <th className="text-right py-3 px-2"><SortHeader label="총비용" field="total" /></th>
              <th className="text-right py-3 px-2"><SortHeader label="식대" field="meal" /></th>
              <th className="text-right py-3 px-2"><SortHeader label="스드메" field="sdm" /></th>
              <th className="text-right py-3 px-2"><SortHeader label="대관료" field="rental" /></th>
              <th className="text-right py-3 px-2 max-md:hidden"><SortHeader label="꽃장식" field="decoration" /></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c, i) => (
              <tr
                key={c.region}
                onClick={() => setSelectedRegion(selectedRegion === c.region ? null : c.region)}
                className={`border-b border-black/[0.03] cursor-pointer transition-colors ${
                  selectedRegion === c.region
                    ? "bg-rose-500/5"
                    : "hover:bg-ivory-50"
                }`}
              >
                <td className="py-2.5 px-2 font-medium text-noir-800">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="text-[25px] text-taupe-400 w-4">{i + 1}</span>
                    {REGION_LABELS[c.region]}
                  </span>
                </td>
                <td className="py-2.5 px-2 text-right font-medium text-noir-800">
                  {c.total.toLocaleString()}
                </td>
                <td className="py-2.5 px-2 text-right text-taupe-500">
                  {c.meal.toLocaleString()}
                </td>
                <td className="py-2.5 px-2 text-right text-taupe-500">
                  {c.sdm.toLocaleString()}
                </td>
                <td className="py-2.5 px-2 text-right text-taupe-500">
                  {c.rental.toLocaleString()}
                </td>
                <td className="py-2.5 px-2 text-right text-taupe-400 max-md:hidden">
                  {c.decoration.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
