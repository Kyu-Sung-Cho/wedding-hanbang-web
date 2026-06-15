"use client";

import { useState } from "react";
import { getRegionalCosts, REGION_LABELS, type RegionKey } from "@/constants/marketPrices";

interface RegionalCostTableProps {
  periodId: string;
}

type SortKey = "total" | "meal" | "sdm" | "rental" | "decoration";

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
          <p className="mb-4 font-serif-kr text-[30px] font-medium leading-none text-[#071629]">
            {formatMan(selectedCost.total)}
          </p>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: "식대", value: selectedCost.meal },
              { label: "스드메", value: selectedCost.sdm },
              { label: "대관료", value: selectedCost.rental },
              { label: "꽃장식", value: selectedCost.decoration },
            ].map(item => (
              <div key={item.label} className="rounded-[12px] border border-[#eadfc9]/70 bg-white p-3 text-center max-sm:col-span-2">
                <p className="mb-1 text-[11px] font-semibold text-[#7a8290]">{item.label}</p>
                <p className="text-[13px] font-semibold text-[#071629]">
                  {formatMan(item.value)}
                </p>
              </div>
            ))}
          </div>
          {/* 전국 평균 대비 바 */}
          <div className="mt-4">
            <div className="mb-1 flex justify-between text-[11px] font-medium text-[#7a8290]">
              <span>전국 평균 대비</span>
              <span>{Math.round((selectedCost.total / (costs.reduce((s, c) => s + c.total, 0) / costs.length)) * 100)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[#efe6d7]">
              <div
                className="h-full rounded-full bg-[#36534E] transition-all duration-500"
                style={{ width: `${Math.min((selectedCost.total / maxTotal) * 100, 100)}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* 테이블 */}
      <div className="overflow-x-auto rounded-[16px] border border-[#eadfc9] bg-white">
        <table className="w-full min-w-[620px] text-[12px]">
          <thead>
            <tr className="border-b border-[#eadfc9]/70 bg-[#fffdf7]">
              <th className="px-3 py-3 text-left text-[11px] font-semibold text-[#7a8290]">지역</th>
              <th className="text-right py-3 px-2"><SortHeader label="총비용" field="total" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} /></th>
              <th className="text-right py-3 px-2"><SortHeader label="식대" field="meal" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} /></th>
              <th className="text-right py-3 px-2"><SortHeader label="스드메" field="sdm" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} /></th>
              <th className="text-right py-3 px-2"><SortHeader label="대관료" field="rental" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} /></th>
              <th className="text-right py-3 px-2 max-md:hidden"><SortHeader label="꽃장식" field="decoration" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} /></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((c, i) => (
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
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-4 text-[10px] text-[#9a9188]">{i + 1}</span>
                    {REGION_LABELS[c.region]}
                  </span>
                </td>
                <td className="px-2 py-3 text-right font-semibold text-[#071629]">
                  {formatMan(c.total)}
                </td>
                <td className="px-2 py-3 text-right font-medium text-[#5d6879]">
                  {formatMan(c.meal)}
                </td>
                <td className="px-2 py-3 text-right font-medium text-[#5d6879]">
                  {formatMan(c.sdm)}
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
