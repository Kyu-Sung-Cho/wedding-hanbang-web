"use client";

import { BookHeart, Check, Clock3, Flower2, HeartHandshake, Music2, UsersRound } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import { DETAIL_SCENES } from "@/components/wedding-code/tasteScenes";
import {
  WEDDING_CODE_V31_OPTIONS,
  type V31Choice, type V31Option, type V31Response, type V31TasteKey,
} from "@/constants/weddingCodeV31";

export const v31Surface = "rounded-xl border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)]";
export const v31Body = "text-sm leading-relaxed text-[var(--hb-text-body)]";
export const v31Title = "font-semibold text-[var(--hb-text-strong)]";

const escapeOptions = [
  { value: "undecided", label: "아직 모르겠어요" },
  { value: "not_applicable", label: "이번 계획에는 없어요" },
  { value: "skipped", label: "지금 답하지 않을게요" },
] as const;

export function V31RatingInput({ value, onChange, showScopeHint = false }: {
  value: V31Response | undefined; onChange: (value: V31Response) => void; showScopeHint?: boolean;
}) {
  const name = useId();
  return <fieldset>
    <legend className="sr-only">지금 내 생각에 가까운 정도</legend>
    <div className="space-y-2">
      {WEDDING_CODE_V31_OPTIONS.map(option => <label key={option.value}
        className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 focus-within:ring-2 focus-within:ring-[var(--hb-focus-ring)] focus-within:ring-offset-2 ${value === option.value ? "border-[var(--hb-selected-line)] bg-[var(--hb-selected-bg)]" : "border-paper-outline bg-[var(--hb-surface-raised)]"}`}>
        <input type="radio" name={name} value={option.value} checked={value === option.value}
          onChange={() => onChange(option.value)} data-answer={option.value}
          className="size-5 shrink-0 accent-[var(--hb-action)]" />
        <span className={`flex-1 text-sm ${v31Title}`}>{option.label}</span>
        <span aria-hidden="true" className="text-xs tabular-nums text-[var(--hb-text-muted)]">{option.value}</span>
      </label>)}
    </div>
    <p className="mt-3 text-xs leading-relaxed text-[var(--hb-text-muted)]">가운데 답은 ‘어느 쪽도 아님’이에요. 아직 모르거나 해당하지 않으면 아래에서 골라 주세요.</p>
    {showScopeHint ? <p className={`mt-2 rounded-lg bg-[var(--hb-surface-hover)] p-3 ${v31Body}`}>원하지 않는 내용이면 ‘그렇지 않아요’ 쪽을 골라요. 이번 결혼 준비에 해당하지 않는 내용은 ‘이번 계획에는 없어요’를 골라 주세요.</p> : null}
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

function tasteScene(key: V31TasteKey, value: string): ReactNode {
  if (key === "ceremony") {
    const icons: Readonly<Record<string, typeof Clock3>> = {
      short: Clock3, simple: Clock3, our_story: BookHeart, thanks: HeartHandshake,
      participatory: UsersRound, performance: Music2, traditional: Flower2,
    };
    const Icon = icons[value];
    return Icon ? <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center bg-[var(--hb-surface-hover)]"><Icon className="size-12! text-[var(--hb-success)]" strokeWidth={1.25} /></span> : null;
  }
  const scenes: Readonly<Record<string, () => ReactNode>> = DETAIL_SCENES[key];
  return scenes[value]?.() ?? null;
}

export function V31ChoiceInput({ value, options, max, onChange, tasteKey, kind = "taste" }: {
  value: V31Choice | undefined; options: readonly V31Option[]; max: number;
  onChange: (value: V31Choice | undefined) => void; tasteKey?: V31TasteKey;
  kind?: "taste" | "avoidances" | "priorities" | "spending";
}) {
  const selected = value?.status === "answered" ? value.values : [];
  function toggle(item: string) {
    const next = selected.includes(item) ? selected.filter(entry => entry !== item)
      : max === 1 ? [item] : [...selected, item].slice(0, max);
    onChange(next.length ? { status: "answered", values: next } : undefined);
  }
  const statuses: { value: Exclude<V31Choice["status"], "answered">; label: string }[] = [
    { value: "undecided", label: kind === "priorities" ? "아직 우선순위를 정하지 못했어요" : "아직 모르겠어요" },
    { value: "no_preference", label: kind === "spending" ? "더 쓰고 싶은 곳은 지금 없어요" : kind === "avoidances" ? "따로 피하고 싶은 것은 없어요" : kind === "priorities" ? "특히 지킬 것을 따로 고르지 않을게요" : "어느 쪽도 괜찮아요" },
    { value: "no_match", label: "맞는 보기가 없어요" },
    { value: "not_applicable", label: "이번 계획에는 없어요" },
    { value: "skipped", label: "지금 답하지 않을게요" },
  ];
  const leadingStatuses = kind === "spending" ? [statuses[1], statuses[0]] : [];
  const remainingStatuses = kind === "spending" ? statuses.slice(2) : statuses;
  const statusButton = (option: (typeof statuses)[number]) => <Button key={option.value} variant="ghost" fullWidth
    onClick={() => onChange({ status: option.value })} aria-pressed={value?.status === option.value}
    className={`min-h-11! justify-start! whitespace-normal! px-3 text-left text-sm ${value?.status === option.value ? "bg-[var(--hb-selected-bg)]" : ""}`}>
    <span className="flex-1">{option.label}</span>{value?.status === option.value ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
  </Button>;
  return <div>
    {leadingStatuses.length ? <div className="mb-4 space-y-1 border-b border-[var(--hb-hairline)] pb-3">{leadingStatuses.map(statusButton)}</div> : null}
    <p className={`mb-3 ${v31Body}`}>{max === 1 ? "하나를 골라 주세요." : kind === "avoidances" || tasteKey === "attire" || tasteKey === "ceremony" ? "해당하는 것을 모두 골라 주세요. 다시 누르면 선택이 풀려요." : `최대 ${max}개까지 고를 수 있어요. 다시 누르면 선택이 풀려요.`}</p>
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
    </div> : <p className="rounded-lg bg-[var(--hb-surface-hover)] p-4 text-sm leading-relaxed text-[var(--hb-text-body)]">앞에서 원한다고 답한 내용이나 직접 고른 취향, 피하고 싶은 것이 아직 없어요. 이전 질문에서 답을 바꾸거나, 아래에서 지금 생각을 골라도 괜찮아요.</p>}
    <div className="mt-5 space-y-1 border-t border-[var(--hb-hairline)] pt-2">
      {remainingStatuses.map(statusButton)}
    </div>
  </div>;
}

export function V31PriorityInput({ value, options, onChange, onSkip }: {
  value: V31Choice | undefined; options: readonly V31Option[];
  onChange: (value: V31Choice | undefined) => void; onSkip: () => void;
}) {
  const [expanded, setExpanded] = useState(value?.status === "answered");
  const optionsId = useId();
  const previousAnswer = value?.status === "answered" ? `우선순위 ${value.values.length}개를 골랐어요.`
    : value?.status === "undecided" ? "아직 우선순위를 정하지 못했어요."
      : value?.status === "no_preference" ? "특히 지킬 것을 따로 고르지 않았어요."
        : value?.status === "skipped" ? "이 질문은 넘어갔어요."
          : value?.status === "not_applicable" ? "이번 계획에는 없어요."
            : value?.status === "no_match" ? "맞는 보기가 없어요." : "";
  return <div>
    <Button variant="primary" fullWidth onClick={onSkip} className="min-h-12! whitespace-normal!">지금은 넘어갈게요</Button>
    {value?.status === "answered" ? <p className={`mt-2 ${v31Body}`}>넘어가면 이전에 고른 우선순위는 지워져요.</p> : null}
    <Button variant="secondary" fullWidth onClick={() => setExpanded(current => !current)} aria-expanded={expanded} aria-controls={optionsId}
      className="mt-3 min-h-12! whitespace-normal!">{expanded ? "우선순위 고르기 접기" : "우선순위도 골라볼게요 (선택)"}</Button>
    {!expanded && previousAnswer ? <p className={`mt-3 ${v31Body}`}>{previousAnswer} 고른 내용은 다시 펼쳐서 바꿀 수 있어요.</p> : null}
    {expanded ? <div id={optionsId} className="mt-5">
      <p className={`mb-2 ${v31Body}`}>1개만 골라도 괜찮아요.</p>
      <V31ChoiceInput value={value} options={options} max={3} onChange={onChange} kind="priorities" />
    </div> : null}
  </div>;
}
