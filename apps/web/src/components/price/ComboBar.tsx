"use client";

import { ChevronDown, ChevronUp, Save, Share2, Trash2 } from "lucide-react";
import { useState } from "react";

import { krwToManwonLabel } from "@/lib/format/krw";
import type { ComboCategory, ComboSelections } from "@/lib/price/comboStore";

type ComboBarProps = {
  selections: ComboSelections;
  totalKrw: number;
  saving?: boolean;
  onClear(category: ComboCategory): void;
  onSave(): void;
  onShare(): void;
};

const SLOT_LABELS: Record<ComboCategory, string> = {
  studio: "스튜디오",
  dress: "드레스",
  makeup: "메이크업",
};

export function ComboBar({
  selections,
  totalKrw,
  saving = false,
  onClear,
  onSave,
  onShare,
}: ComboBarProps) {
  const [expanded, setExpanded] = useState(true);
  const count = Object.values(selections).filter(Boolean).length;
  if (count === 0) return null;

  return (
    <aside className="fixed inset-x-0 bottom-0 z-[90] border-t border-[var(--hb-primary)]/12 bg-[var(--hb-surface-page)]/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-12px_40px_rgba(36,56,50,0.12)] backdrop-blur-xl" aria-label="사진·드레스·메이크업 조합">
      <div className="mx-auto max-w-6xl px-3 py-3 sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded} className="flex min-h-11 min-w-0 items-center gap-2 rounded-lg text-left text-[var(--hb-text-strong)] focus-visible:outline-2 focus-visible:outline-[#B89785]">
            <span className="min-w-0">
              <span className="block text-[11px] font-bold text-[var(--color-rose-700)]">사진·드레스·메이크업 조합 · {count}/3</span>
              <strong className="block truncate text-base tabular-nums">총 {krwToManwonLabel(totalKrw)}</strong>
            </span>
            {expanded ? <ChevronDown aria-hidden="true" className="size-4 shrink-0" /> : <ChevronUp aria-hidden="true" className="size-4 shrink-0" />}
          </button>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onShare} className="grid size-11 place-items-center rounded-full border border-[var(--hb-primary)]/15 bg-white text-[var(--hb-text-strong)]" aria-label="조합 공유하기">
              <Share2 aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              aria-busy={saving}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-[var(--hb-primary)] px-4 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-65"
            >
              <Save aria-hidden="true" className="size-4" />
              {saving ? "저장 중" : "저장"}
            </button>
          </div>
        </div>

        {expanded ? (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {(Object.keys(SLOT_LABELS) as ComboCategory[]).map((category) => {
              const selection = selections[category];
              return (
                <div key={category} className="min-w-0 rounded-xl border border-[var(--hb-primary)]/10 bg-white px-3 py-2.5">
                  <p className="text-[10px] font-bold text-[var(--hb-text-muted)]">{SLOT_LABELS[category]}</p>
                  {selection ? (
                    <div className="mt-1 flex items-center gap-1">
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--hb-text-strong)]">{selection.vendorName}</span>
                      <button type="button" onClick={() => onClear(category)} aria-label={`${selection.vendorName} 빼기`} className="grid size-7 shrink-0 place-items-center rounded-full text-[#8F6662] hover:bg-[#F5ECE4]">
                        <Trash2 aria-hidden="true" className="size-3.5" />
                      </button>
                    </div>
                  ) : <p className="mt-1 text-xs text-[var(--hb-text-muted)]">비어 있음</p>}
                </div>
              );
            })}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
