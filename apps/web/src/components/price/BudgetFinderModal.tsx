"use client";

import { Search, X } from "lucide-react";
import { useState } from "react";

import { track } from "@/lib/analytics/track";
import { krwToManwonLabel } from "@/lib/format/krw";
import { useAccessibleModal } from "@/hooks/useAccessibleModal";
import {
  findBudgetCombinations,
  type BudgetCombination,
} from "@/lib/price/budgetFinder";
import type { PriceVendor } from "@/lib/price/catalog";

type BudgetFinderModalProps = {
  open: boolean;
  catalog: Record<"studio" | "dress" | "makeup", readonly PriceVendor[]>;
  agencies: ReadonlyArray<{ id: string; name: string }>;
  onClose(): void;
  onChoose(combination: BudgetCombination): void;
};

function budgetBand(krw: number): "under_200" | "200_300" | "300_400" | "over_400" {
  if (krw < 2_000_000) return "under_200";
  if (krw < 3_000_000) return "200_300";
  if (krw < 4_000_000) return "300_400";
  return "over_400";
}

export function BudgetFinderModal({
  open,
  catalog,
  agencies,
  onClose,
  onChoose,
}: BudgetFinderModalProps) {
  const [budgetManwon, setBudgetManwon] = useState("300");
  const [agencyId, setAgencyId] = useState("");
  const [results, setResults] = useState<BudgetCombination[] | null>(null);
  const dialogRef = useAccessibleModal({ open, onClose });

  if (!open) return null;

  const search = () => {
    const manwon = Number(budgetManwon);
    if (!Number.isFinite(manwon) || manwon <= 0 || manwon > 10_000) {
      setResults([]);
      return;
    }
    const maximumKrw = Math.round(manwon * 10_000);
    setResults(findBudgetCombinations({
      catalogs: catalog,
      budgetMaximumKrw: maximumKrw,
      ...(agencyId ? { agencyIds: [agencyId] } : {}),
      limit: 20,
    }));
    track("budget_search", {
      surface: "combo",
      context: { budget_band: budgetBand(maximumKrw) },
    });
  };

  return (
    <div
      className="fixed inset-0 z-[115] flex items-end justify-center bg-[#2B423E]/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-[28px] bg-[#FBF8F2] p-5 shadow-2xl sm:rounded-[28px] sm:p-7"
        role="dialog"
        aria-modal="true"
        aria-labelledby="budget-finder-title"
        aria-describedby="budget-finder-disclaimer"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[0.12em] text-[#8F6662]">BUDGET FINDER</p>
            <h2 id="budget-finder-title" className="mt-1 text-2xl font-bold tracking-normal text-[#243832]">
              내 예산으로 조합 찾기
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="grid size-11 shrink-0 place-items-center rounded-full text-[#243832] hover:bg-white">
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        <form
          className="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            search();
          }}
        >
          <label className="text-sm font-semibold text-[#243832]">
            최대 예산
            <span className="mt-2 flex min-h-12 items-center rounded-xl border border-[#243832]/15 bg-white px-4 focus-within:ring-2 focus-within:ring-[#B89785]">
              <input
                value={budgetManwon}
                onChange={(event) => setBudgetManwon(event.target.value.replace(/[^0-9.]/g, ""))}
                inputMode="decimal"
                aria-label="최대 예산(만원)"
                className="min-w-0 flex-1 bg-transparent text-base font-bold tabular-nums outline-none"
              />
              <span className="text-sm text-[#243832]/75">만원</span>
            </span>
          </label>
          <label className="text-sm font-semibold text-[#243832]">
            대행사
            <select
              value={agencyId}
              onChange={(event) => setAgencyId(event.target.value)}
              className="mt-2 min-h-12 w-full rounded-xl border border-[#243832]/15 bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-[#B89785]"
            >
              <option value="">전체 대행사</option>
              {agencies.map((agency) => <option key={agency.id} value={agency.id}>{agency.name}</option>)}
            </select>
          </label>
          <button type="submit" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#36534E] px-5 text-sm font-bold text-white hover:bg-[#2B423E]">
            <Search aria-hidden="true" className="size-4" />
            조합 찾기
          </button>
        </form>

        <p id="budget-finder-disclaimer" className="mt-4 rounded-xl bg-[#F5ECE4] px-4 py-3 text-xs leading-5 text-[#243832]/75">
          공시 최저가 기준의 참고 조합이에요. 옵션·날짜·계약 조건에 따라 실제 금액은 달라질 수 있어요.
        </p>

        {results !== null ? (
          <div className="mt-5 space-y-3" aria-live="polite">
            {results.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-[#243832]/20 bg-white px-5 py-8 text-center text-sm text-[#243832]/70">
                조건 안에서 찾은 조합이 없어요. 예산이나 대행사 조건을 넓혀보세요.
              </p>
            ) : results.map((result, index) => (
              <article key={`${result.studio.vendorId}:${result.dress.vendorId}:${result.makeup.vendorId}`} className="rounded-2xl border border-[#243832]/12 bg-white p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-bold text-[#8F6662]">추천 {index + 1}</p>
                  <p className="font-bold tabular-nums text-[#243832]">{krwToManwonLabel(result.totalKrw)}</p>
                </div>
                <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
                  {(["studio", "dress", "makeup"] as const).map((category) => (
                    <div key={category} className="rounded-xl bg-[#FBF8F2] p-3">
                      <dt className="text-[11px] font-bold text-[#243832]/50">{category === "studio" ? "스튜디오" : category === "dress" ? "드레스" : "메이크업"}</dt>
                      <dd className="mt-1 truncate font-semibold text-[#243832]">{result[category].vendorName}</dd>
                    </div>
                  ))}
                </dl>
                <button type="button" onClick={() => onChoose(result)} className="mt-3 min-h-11 w-full rounded-full border border-[#243832]/18 text-sm font-bold text-[#243832] hover:bg-[#F5ECE4]">
                  이 조합 담기
                </button>
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
