"use client";

import { Check } from "lucide-react";
import { useId, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import { DETAIL_SCENES } from "@/components/wedding-code/tasteScenes";
import {
  WEDDING_CODE_V30_OPTIONS,
  type V30Choice, type V30Option, type V30Response, type V30TasteKey,
} from "@/constants/weddingCodeV30";

export const v30Surface = "rounded-xl border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)]";
export const v30Body = "text-sm leading-relaxed text-[var(--hb-text-body)]";
export const v30Title = "font-semibold text-[var(--hb-text-strong)]";

const escapeOptions = [
  { value: "undecided", label: "아직 모르겠어요" },
  { value: "not_applicable", label: "이번 계획에는 없어요" },
  { value: "skipped", label: "지금 답하지 않을게요" },
] as const;

export function V30RatingInput({ value, onChange }: {
  value: V30Response | undefined; onChange: (value: V30Response) => void;
}) {
  const name = useId();
  return <fieldset>
    <legend className="sr-only">지금 내 생각에 가까운 정도</legend>
    <div className="space-y-2">
      {WEDDING_CODE_V30_OPTIONS.map(option => <label key={option.value}
        className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 focus-within:ring-2 focus-within:ring-[var(--hb-focus-ring)] focus-within:ring-offset-2 ${value === option.value ? "border-[var(--hb-selected-line)] bg-[var(--hb-selected-bg)]" : "border-paper-outline bg-[var(--hb-surface-raised)]"}`}>
        <input type="radio" name={name} value={option.value} checked={value === option.value}
          onChange={() => onChange(option.value)} data-answer={option.value}
          className="size-5 shrink-0 accent-[var(--hb-action)]" />
        <span className={`flex-1 text-sm ${v30Title}`}>{option.label}</span>
        <span aria-hidden="true" className="text-xs tabular-nums text-[var(--hb-text-muted)]">{option.value}</span>
      </label>)}
    </div>
    <p className="mt-3 text-xs leading-relaxed text-[var(--hb-text-muted)]">가운데 답은 ‘어느 쪽도 아님’이에요. 아직 모르거나 해당하지 않으면 아래에서 골라 주세요.</p>
    <div className="mt-3 border-t border-[var(--hb-hairline)] pt-2">
      {escapeOptions.map(option => <label key={option.value}
        className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm focus-within:ring-2 focus-within:ring-[var(--hb-focus-ring)] ${value === option.value ? "bg-[var(--hb-selected-bg)]" : ""}`}>
        <input type="radio" name={name} value={option.value} checked={value === option.value}
          onChange={() => onChange(option.value)} className="size-4 shrink-0 accent-[var(--hb-action)]" />
        <span className="text-[var(--hb-text-body)]">{option.label}</span>
      </label>)}
    </div>
  </fieldset>;
}

function tasteScene(key: V30TasteKey, value: string): ReactNode {
  const scenes: Readonly<Record<string, () => ReactNode>> = DETAIL_SCENES[key];
  return scenes[value]?.() ?? null;
}

export function V30ChoiceInput({ value, options, max, onChange, tasteKey, kind = "taste" }: {
  value: V30Choice | undefined; options: readonly V30Option[]; max: number;
  onChange: (value: V30Choice | undefined) => void; tasteKey?: V30TasteKey;
  kind?: "taste" | "priorities" | "spending";
}) {
  const selected = value?.status === "answered" ? value.values : [];
  function toggle(item: string) {
    const next = selected.includes(item) ? selected.filter(entry => entry !== item)
      : max === 1 ? [item] : [...selected, item].slice(0, max);
    onChange(next.length ? { status: "answered", values: next } : undefined);
  }
  const statuses: { value: Exclude<V30Choice["status"], "answered">; label: string }[] = [
    { value: "undecided", label: kind === "priorities" ? "아직 우선순위를 정하지 못했어요" : "아직 모르겠어요" },
    { value: "no_preference", label: kind === "spending" ? "더 쓰고 싶은 곳은 지금 없어요" : kind === "priorities" ? "특히 지킬 것을 따로 고르지 않을게요" : "어느 쪽도 괜찮아요" },
    { value: "no_match", label: "맞는 보기가 없어요" },
    { value: "not_applicable", label: "이번 계획에는 없어요" },
    { value: "skipped", label: "지금 답하지 않을게요" },
  ];
  return <div>
    <p className={`mb-3 ${v30Body}`}>{max === 1 ? "하나를 골라 주세요." : `최대 ${max}개까지 고를 수 있어요. 다시 누르면 선택이 풀려요.`}</p>
    {options.length ? <div className={tasteKey ? "grid grid-cols-1 gap-3 min-[360px]:grid-cols-2" : "space-y-2"}>
      {options.map(option => <Button key={option.value} variant="secondary" fullWidth
        aria-pressed={selected.includes(option.value)} data-choice={option.value}
        disabled={max > 1 && selected.length >= max && !selected.includes(option.value)}
        onClick={() => toggle(option.value)}
        className={`relative min-h-12! justify-start! overflow-hidden whitespace-normal! border-paper-outline! text-left ${tasteKey ? "p-0!" : "px-4 py-3"} ${selected.includes(option.value) ? "border-[var(--hb-selected-line)]! bg-[var(--hb-selected-bg)]!" : ""}`}>
        {tasteKey ? <span className="flex w-full flex-col">
          <span className="relative block aspect-[2/1] w-full border-b border-[var(--hb-hairline)]">{tasteScene(tasteKey, option.value)}</span>
          <span className="flex min-h-14 items-center gap-2 px-3 py-3 text-sm leading-relaxed">
            <span className="flex-1">{option.label}</span>
            {selected.includes(option.value) ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
          </span>
        </span> : <><span className="flex-1 text-sm leading-relaxed">{option.label}</span>{selected.includes(option.value) ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}</>}
      </Button>)}
    </div> : <p className="rounded-lg bg-[var(--hb-surface-hover)] p-4 text-sm leading-relaxed text-[var(--hb-text-body)]">앞에서 원한다고 답한 내용이나 직접 고른 취향이 아직 없어요. 이전 질문에서 답을 바꾸거나, 아래에서 지금 생각을 골라도 괜찮아요.</p>}
    <div className="mt-5 space-y-1 border-t border-[var(--hb-hairline)] pt-2">
      {statuses.map(option => <Button key={option.value} variant="ghost" fullWidth
        onClick={() => onChange({ status: option.value })} aria-pressed={value?.status === option.value}
        className={`min-h-11! justify-start! whitespace-normal! px-3 text-left text-sm ${value?.status === option.value ? "bg-[var(--hb-selected-bg)]" : ""}`}>
        <span className="flex-1">{option.label}</span>{value?.status === option.value ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
      </Button>)}
    </div>
  </div>;
}
