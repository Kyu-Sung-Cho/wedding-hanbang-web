"use client";

import { Info, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { krwRangeLabel, krwToManwonLabel } from "@/lib/format/krw";
import type { PriceOption, PriceVendor } from "@/lib/price/catalog";
import type { ComboCategory, ComboSelection } from "@/lib/price/comboStore";
import { useAccessibleModal } from "@/hooks/useAccessibleModal";

import { loadVendorOptions } from "./vendorOptionsClient";

type AddToComboModalProps = {
  vendor: PriceVendor | null;
  onClose(): void;
  onAdd(category: ComboCategory, selection: ComboSelection): void;
};

export function AddToComboModal({ vendor, onClose, onAdd }: AddToComboModalProps) {
  const firstPricedOffer = vendor?.offers.find((offer) => offer.minimumKrw !== null) ?? vendor?.offers[0];
  const [offerId, setOfferId] = useState(firstPricedOffer?.id ?? "");
  const [customManwon, setCustomManwon] = useState("");
  const [selectedOptionIds, setSelectedOptionIds] = useState<Set<string>>(new Set());
  const open = vendor !== null && vendor.category !== "hall";
  const dialogRef = useAccessibleModal({ open, onClose });

  // 슬림 카탈로그: 옵션 본문이 비어 오면 모달이 열릴 때 지연 로드해 채운다.
  const [hydratedOptions, setHydratedOptions] = useState<Map<string, PriceOption[]> | null>(null);
  useEffect(() => {
    if (!open || !vendor) return;
    const needsLoad = vendor.offers.some(
      (value) => value.options.length === 0 && (value.optionCount ?? 0) > 0,
    );
    if (!needsLoad) return;
    let cancelled = false;
    loadVendorOptions(vendor)
      .then((resolved) => { if (!cancelled) setHydratedOptions(resolved); })
      .catch(() => undefined); // 옵션 없이도 기본가 담기는 가능 — 조용히 계속
    return () => { cancelled = true; };
  }, [open, vendor]);

  const rawOffer = vendor?.offers.find((value) => value.id === offerId) ?? firstPricedOffer;
  const offer = rawOffer && rawOffer.options.length === 0 && hydratedOptions?.get(rawOffer.id)?.length
    ? { ...rawOffer, options: hydratedOptions.get(rawOffer.id)! }
    : rawOffer;
  const customManwonValue = /^\d+(?:\.\d+)?$/.test(customManwon.trim())
    ? Number(customManwon)
    : Number.NaN;
  const customKrw = customManwon.trim() === "" ? null : Math.round(customManwonValue * 10_000);
  const validCustomKrw = customKrw !== null && Number.isSafeInteger(customKrw) && customKrw >= 0 && customKrw <= 1_000_000_000
    ? customKrw
    : null;
  const customInputError = customManwon.trim() !== "" && validCustomKrw === null;
  const options = useMemo(() => offer?.options.filter(({ id }) => selectedOptionIds.has(id)) ?? [], [offer, selectedOptionIds]);
  const optionMinimumTotal = options.reduce((sum, option) => sum + (option.minimumKrw ?? 0), 0);
  const optionMaximumTotal = options.every((option) => option.maximumKrw !== null)
    ? options.reduce((sum, option) => sum + (option.maximumKrw ?? 0), 0)
    : null;
  const baseMinimumKrw = validCustomKrw ?? offer?.minimumKrw ?? 0;
  const baseMaximumKrw = validCustomKrw ?? offer?.maximumKrw ?? null;
  const totalMinimumKrw = baseMinimumKrw + optionMinimumTotal;
  const totalMaximumKrw = baseMaximumKrw !== null && optionMaximumTotal !== null
    ? baseMaximumKrw + optionMaximumTotal
    : null;

  if (!vendor || vendor.category === "hall") return null;
  const comboCategory: ComboCategory = vendor.category;

  const add = () => {
    if (customInputError || !offer || (offer.minimumKrw === null && validCustomKrw === null)) return;
    onAdd(comboCategory, {
      vendorId: vendor.id,
      vendorSlug: vendor.slug,
      vendorName: vendor.name,
      agencyId: offer.agencyId,
      agencyName: offer.agencyName,
      baseKrw: offer.minimumKrw ?? 0,
      selectedOptions: options.map((option) => ({
        name: option.name,
        krw: option.minimumKrw ?? 0,
      })),
      customKrw: validCustomKrw,
    });
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-[#2B423E]/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-t-[28px] bg-[#FBF8F2] p-5 shadow-2xl sm:rounded-[28px] sm:p-7"
        role="dialog"
        aria-modal="true"
        aria-labelledby="combo-add-title"
        tabIndex={-1}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold tracking-[0.12em] text-[#8F6662]">조합에 담기</p>
            <h2 id="combo-add-title" className="mt-1 text-2xl font-bold tracking-[-0.03em] text-[#243832]">{vendor.name}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="닫기" className="grid size-11 shrink-0 place-items-center rounded-full text-[#243832] hover:bg-white">
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        <fieldset className="mt-6 space-y-2">
          <legend className="text-sm font-bold text-[#243832]">공시 가격 선택</legend>
          {vendor.offers.map((candidate) => (
            <label key={candidate.id} className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 ${offerId === candidate.id ? "border-[#8F6662] bg-white" : "border-[#243832]/12 bg-white/55"}`}>
              <input type="radio" name="offer" value={candidate.id} checked={offerId === candidate.id} onChange={() => {
                setOfferId(candidate.id);
                setSelectedOptionIds(new Set());
              }} className="mt-1 accent-[#243832]" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-[#243832]">{candidate.agencyName}</span>
                  <span className="font-bold tabular-nums text-[#243832]">{krwRangeLabel(candidate.minimumKrw, candidate.maximumKrw)}</span>
                </span>
                {candidate.baseSpec ? <span className="mt-1 block text-xs leading-5 text-[#243832]/65">{candidate.baseSpec}</span> : null}
              </span>
            </label>
          ))}
        </fieldset>

        <label className="mt-5 block text-sm font-bold text-[#243832]">
          내가 받은 기본 견적이 있다면
          <span className="mt-2 flex min-h-12 items-center rounded-xl border border-[#243832]/15 bg-white px-4 focus-within:ring-2 focus-within:ring-[#B89785]">
            <input
              value={customManwon}
              onChange={(event) => setCustomManwon(event.target.value)}
              inputMode="decimal"
              placeholder="공시가 그대로 사용"
              aria-label="직접 입력한 기본 견적(만원)"
              aria-invalid={customInputError}
              aria-describedby={customInputError ? "combo-custom-quote-error" : undefined}
              className="min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            <span className="text-sm text-[#243832]/60">만원</span>
          </span>
          {customInputError ? (
            <span id="combo-custom-quote-error" role="alert" className="mt-2 block text-xs font-medium text-[#A13D3D]">
              0~10억원 범위의 금액을 만원 단위 숫자로 입력해 주세요.
            </span>
          ) : null}
        </label>

        {offer && offer.options.length > 0 ? (
          <fieldset className="mt-5 space-y-2">
            <legend className="text-sm font-bold text-[#243832]">추가 옵션</legend>
            {offer.options.map((option) => (
              <label key={option.id} className="flex cursor-pointer items-start gap-3 rounded-xl bg-white px-4 py-3">
                <input
                  type="checkbox"
                  checked={selectedOptionIds.has(option.id)}
                  onChange={() => setSelectedOptionIds((current) => {
                    const next = new Set(current);
                    if (next.has(option.id)) next.delete(option.id);
                    else next.add(option.id);
                    return next;
                  })}
                  className="mt-1 accent-[#243832]"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap justify-between gap-2 text-sm font-semibold text-[#243832]">
                    <span>{option.name}</span>
                    <span
                      className="inline-flex items-center gap-1 tabular-nums"
                      title={option.maximumKrw !== null && option.maximumKrw !== option.minimumKrw ? `최대 ${krwToManwonLabel(option.maximumKrw)}` : undefined}
                    >
                      {krwRangeLabel(option.minimumKrw, option.maximumKrw)}
                      {option.maximumKrw !== null && option.maximumKrw !== option.minimumKrw ? <Info aria-hidden="true" className="size-3.5" /> : null}
                    </span>
                  </span>
                  {option.condition || option.unit ? (
                    <span className="mt-1 block text-xs leading-5 text-[#243832]/60">
                      {[option.unit, option.condition].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                  <span className="mt-1 block text-xs leading-5 text-[#243832]/60">
                    공시 원문 · {option.rawText}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}

        <div className="sticky bottom-0 -mx-5 mt-6 border-t border-[#243832]/10 bg-[#FBF8F2]/95 px-5 pb-[max(0px,env(safe-area-inset-bottom))] pt-4 backdrop-blur sm:-mx-7 sm:px-7">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-semibold text-[#243832]/65">
              {validCustomKrw === null ? "기본·옵션 공시가 합계" : "입력 견적·옵션 공시가 합계"}
            </span>
            <strong className="text-xl tabular-nums text-[#243832]">{krwRangeLabel(totalMinimumKrw, totalMaximumKrw)}</strong>
          </div>
          <button type="button" onClick={add} disabled={customInputError || !offer || (offer.minimumKrw === null && validCustomKrw === null)} className="mt-3 min-h-12 w-full rounded-full bg-[#36534E] px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-45">
            이 가격으로 담기
          </button>
        </div>
      </div>
    </div>
  );
}
