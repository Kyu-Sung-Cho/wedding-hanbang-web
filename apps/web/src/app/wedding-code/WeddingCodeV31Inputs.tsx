"use client";

import { BookHeart, Check, ChevronRight, Clock3, Flower2, HeartHandshake, Music2, UsersRound } from "lucide-react";
import { useId, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import { DETAIL_SCENES } from "@/components/wedding-code/tasteScenes";
import {
  WEDDING_CODE_V31_OPTIONS,
  type V31Choice, type V31Option, type V31Response, type V31TasteKey,
} from "@/constants/weddingCodeV31";
import { V31_PRIORITY_NO_PREFERENCE_LABEL, V31_PRIORITY_UNDECIDED_LABEL } from "@/lib/weddingCode/v31";

export const v31Surface = "rounded-xl border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)]";
export const v31Body = "text-sm leading-relaxed text-[var(--hb-text-body)]";
export const v31Title = "font-semibold text-[var(--hb-text-strong)]";

const escapeOptions = [
  { value: "undecided", label: "아직 모르겠어요" },
  { value: "not_applicable", label: "해당하지 않아요" },
  { value: "skipped", label: "지금 답하지 않을게요" },
] as const;

/** 가운데 답과 반대쪽 답을 고르는 법. 평정 흐름의 첫 화면에서만 보여준다. */
export const v31RatingGuide = "가운데 ‘어느 쪽도 아니에요’는 좋지도 싫지도 않거나 상황에 따라 다를 때 골라 주세요. 원하지 않는 내용이면 ‘그렇지 않은 편이에요’나 ‘전혀 그렇지 않아요’를 고르면 돼요.";
export const v31EscapeFoldLabel = "답하기 어려워요";

export function V31RatingInput({ value, onChange, showGuide = false, compact = false, questionLabel }: {
  value: V31Response | undefined; onChange: (value: V31Response) => void; showGuide?: boolean;
  compact?: boolean; questionLabel?: string;
}) {
  const name = useId();
  const escapeChosen = escapeOptions.find(option => option.value === value);
  if (compact) return <fieldset>
    <legend className="sr-only">{questionLabel ?? "지금 내 생각에 가까운 정도"}</legend>
    <div className="grid grid-cols-5 gap-0.5 min-[360px]:gap-1 sm:gap-2">
      {WEDDING_CODE_V31_OPTIONS.map(option => <label key={option.value}
        className={`flex min-h-24 min-w-0 cursor-pointer flex-col items-center gap-2 rounded-lg border py-3 text-center min-[360px]:px-0.5 focus-within:ring-2 focus-within:ring-[var(--hb-focus-ring)] focus-within:ring-offset-2 ${value === option.value ? "border-[var(--hb-selected-line)] bg-[var(--hb-selected-bg)]" : "border-paper-outline bg-[var(--hb-surface-raised)]"}`}>
        <span className="inline-flex items-center gap-1">
          <input type="radio" name={name} value={option.value} checked={value === option.value}
            onChange={() => onChange(option.value)} data-answer={option.value} className="size-4 shrink-0 accent-[var(--hb-action)]" />
          <span aria-hidden="true" className="text-xs tabular-nums text-[var(--hb-text-muted)]">{option.value}</span>
        </span>
        <span className={`w-full break-keep text-xs leading-4 sm:text-sm sm:leading-5 ${v31Title}`}>{option.label}</span>
      </label>)}
    </div>
    {/*
      접힌 세 보기는 다섯 칸과 이름이 다른 라디오 묶음이다. 같은 묶음이면 Tab 이 묶음 안의 고른 칸 하나에만 서서,
      ‘답하기 어려워요’를 펼친 뒤 Tab 을 눌러도 세 보기를 건너뛰었다. 따로 묶어 펼친 뒤 Tab 으로 바로 들어가게 한다.
      고른 답은 value 로 제어하므로 두 묶음에 동시에 켜지지 않는다. 이미 고른 문장은 펼친 채로 두고, 접어도 고른 답을
      요약 줄에 적어 답이 사라진 것처럼 보이지 않게 한다.
    */}
    <details data-escape-options open={escapeChosen ? true : undefined} className="group mt-2">
      <summary className="flex min-h-11 cursor-pointer items-center gap-1 text-sm text-[var(--hb-text-body)] underline underline-offset-4">
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 transition-transform group-open:rotate-90" />
        <span>{escapeChosen ? `${v31EscapeFoldLabel}: ${escapeChosen.label}` : v31EscapeFoldLabel}</span>
      </summary>
      <div className="mt-1 grid grid-cols-3 gap-1.5 sm:gap-2">
        {escapeOptions.map(option => <label key={option.value}
          className={`flex min-h-11 min-w-0 cursor-pointer flex-col items-center gap-2 rounded-lg border px-2 py-3 text-center text-xs leading-4 focus-within:ring-2 focus-within:ring-[var(--hb-focus-ring)] focus-within:ring-offset-2 ${value === option.value ? "border-[var(--hb-selected-line)] bg-[var(--hb-selected-bg)]" : "border-[var(--hb-hairline)]"}`}>
          <input type="radio" name={`${name}-escape`} value={option.value} checked={value === option.value}
            onChange={() => onChange(option.value)} className="size-4 shrink-0 accent-[var(--hb-action)]" />
          <span className="w-full text-[var(--hb-text-body)]">{option.label}</span>
        </label>)}
      </div>
    </details>
  </fieldset>;
  return <fieldset>
    <legend className="sr-only">{questionLabel ?? "지금 내 생각에 가까운 정도"}</legend>
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
    {showGuide ? <p className={`mt-3 rounded-lg bg-[var(--hb-surface-hover)] p-3 ${v31Body}`}>{v31RatingGuide} 아직 모르겠거나 해당하지 않는 내용이면 아래에서 따로 골라 주세요.</p> : null}
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
    { value: "undecided", label: kind === "priorities" ? V31_PRIORITY_UNDECIDED_LABEL : "아직 모르겠어요" },
    { value: "no_preference", label: kind === "spending" ? "더 쓰고 싶은 곳은 지금 없어요" : kind === "avoidances" ? "따로 피하고 싶은 것은 없어요" : kind === "priorities" ? V31_PRIORITY_NO_PREFERENCE_LABEL : "어느 것이든 괜찮아요" },
    { value: "no_match", label: "맞는 보기가 없어요" },
    { value: "not_applicable", label: "해당하지 않아요" },
    { value: "skipped", label: "지금 답하지 않을게요" },
  ];
  const leadingStatuses = kind === "spending" ? [statuses[1], statuses[0]] : [];
  // 우선순위는 아래 고정 버튼(‘고르지 않고 결과 보기’)이 같은 답(건너뜀)을 남기므로 같은 뜻의 보기를 두 번 두지 않는다.
  // ‘해당하지 않아요’도 이 화면에서는 뜻이 겹쳐 빼되, 전에 그렇게 답한 사람에게는 눌린 채로 보여준다.
  const remainingStatuses = kind === "spending" ? statuses.slice(2)
    : kind === "priorities" ? statuses.filter(option => option.value !== "skipped" && (option.value !== "not_applicable" || value?.status === "not_applicable"))
      : statuses;
  const statusButton = (option: (typeof statuses)[number]) => <Button key={option.value} variant="ghost" fullWidth
    onClick={() => onChange({ status: option.value })} aria-pressed={value?.status === option.value}
    className={`min-h-11! justify-start! whitespace-normal! px-3 text-left text-sm ${value?.status === option.value ? "bg-[var(--hb-selected-bg)]" : ""}`}>
    <span className="flex-1">{option.label}</span>{value?.status === option.value ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
  </Button>;
  return <div>
    {leadingStatuses.length ? <div className="mb-4 space-y-1 border-b border-[var(--hb-hairline)] pb-3">{leadingStatuses.map(statusButton)}</div> : null}
    {/* 피하고 싶은 것 페이지는 위쪽 안내(여러 개 골라도 되고 다시 누르면 풀린다는 말까지)가 이미 한 문단으로 말해서 같은 요청을 한 번 더 하지 않는다. */}
    {kind === "avoidances" ? null : <p className={`mb-3 ${v31Body}`}>{max === 1 ? "하나를 골라 주세요. 이미 정해진 것이 있어도 내가 바라는 것을 고르면 돼요." : tasteKey === "attire" || tasteKey === "ceremony" ? "해당하는 것을 골라 주세요. 여러 개 골라도 되고, 다시 누르면 선택이 풀려요." : `최대 ${max}개까지 고를 수 있어요. 고른 순서대로 결과에 적어요. 다시 누르면 선택이 풀려요.`}</p>}
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
    </div> : <p className="rounded-lg bg-[var(--hb-surface-hover)] p-4 text-sm leading-relaxed text-[var(--hb-text-body)]">아직 고를 수 있는 것이 없어요. ‘그런 편이에요’ 이상으로 답한 문장, 직접 고른 취향, 피하고 싶은 것이 있어야 여기에 나와요. 지금은 아래에서 내 생각에 맞는 칸을 골라 주세요.</p>}
    <div className="mt-5 space-y-1 border-t border-[var(--hb-hairline)] pt-2">
      {remainingStatuses.map(statusButton)}
    </div>
  </div>;
}

/**
 * 주 행동은 고르기다. 고르지 않고 넘어가기는 목록 아래 보조 버튼이 아니라 화면 아래 고정 버튼이 맡는다
 * (아무것도 고르지 않았으면 그 버튼이 ‘고르지 않고 결과 보기’로 바뀐다). 비활성 버튼과 넘어가기 버튼을 겹쳐 두지 않는다.
 */
export function V31PriorityInput({ value, options, onChange }: {
  value: V31Choice | undefined; options: readonly V31Option[];
  onChange: (value: V31Choice | undefined) => void;
}) {
  return <div>
    <V31ChoiceInput value={value} options={options} max={3} onChange={onChange} kind="priorities" />
    {/* 건너뜀은 보기로 두지 않아 눌린 버튼이 없다. 전에 넘어갔다는 사실만 알린다. */}
    {value?.status === "skipped" ? <p className={`mt-4 ${v31Body}`} data-priority-skipped-note>이 질문은 고르지 않고 넘어간 상태예요.</p> : null}
  </div>;
}
