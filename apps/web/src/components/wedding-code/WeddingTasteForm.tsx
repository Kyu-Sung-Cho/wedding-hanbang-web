"use client";

import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import Button from "@/components/ui/Button";
import {
  createEmptyWeddingTasteDraft, parseWeddingTasteDraft, selectedTasteDomains,
  TASTE_AVOID_OPTIONS, TASTE_DOMAIN_OPTIONS, TASTE_DOMAIN_QUESTIONS,
  TASTE_MOOD_OPTIONS, TASTE_NEGOTIABILITY_OPTIONS, TASTE_STATUS_LABELS,
  type TasteDomain, type TasteSelection, type TasteUnansweredStatus, type WeddingTasteDraftV1,
} from "@/lib/weddingCode/taste";

export interface WeddingTasteFormProps {
  onComplete: (draft: WeddingTasteDraftV1) => void;
  initialDraft?: WeddingTasteDraftV1;
}
type Step = { kind: "priorities" | "mood" | "avoids" | "negotiability" } | { kind: "detail"; domain: TasteDomain };

function Choices<T extends string>({ value, options, max, onChange, statusLabels }: {
  value: TasteSelection<T>; options: readonly { value: T; label: string }[]; max: number;
  onChange: (value: TasteSelection<T>) => void; statusLabels?: Partial<Record<TasteUnansweredStatus, string>>;
}) {
  const selected = value.status === "answered" ? value.values : [];
  function toggle(option: T) {
    const next = selected.includes(option) ? selected.filter(item => item !== option)
      : max === 1 ? [option] : selected.length < max ? [...selected, option] : selected;
    onChange(next.length ? { status: "answered", values: next } : { status: "skipped" });
  }
  return (
    <div>
      <p className="mb-3 text-[13px] text-[var(--hb-text-muted)]">{max === 1 ? "한 가지를 고르거나 아래에서 현재 상태를 알려주세요." : "최대 " + max + "개 · 다시 누르면 선택을 지울 수 있어요."}</p>
      <div className="space-y-2">
        {options.map(option => (
          <Button key={option.value} variant="secondary" size="lg" fullWidth
            aria-pressed={selected.includes(option.value)}
            disabled={max > 1 && selected.length >= max && !selected.includes(option.value)}
            onClick={() => toggle(option.value)}
            className={selected.includes(option.value) ? "min-h-16 border-[var(--hb-success)] bg-[var(--hb-surface-hover)]" : "min-h-16"}>
            <span className="flex-1 whitespace-normal text-left leading-relaxed">{option.label}</span>
            {selected.includes(option.value) ? <Check aria-hidden="true" className="size-5 shrink-0 text-[var(--hb-success)]" /> : null}
          </Button>
        ))}
      </div>
      <div className="mt-5 space-y-1 border-t border-[var(--hb-hairline)] pt-3">
        {(["undecided", "no_preference", "not_applicable", "skipped"] as const).map(status => (
          <Button key={status} variant="ghost" fullWidth aria-pressed={value.status === status && status !== "skipped"}
            onClick={() => onChange({ status })} className="justify-start">
            <span className="whitespace-normal text-left">{statusLabels?.[status] ?? TASTE_STATUS_LABELS[status]}</span>
            {value.status === status && status !== "skipped" ? <Check aria-hidden="true" className="size-4 shrink-0" /> : null}
          </Button>
        ))}
      </div>
    </div>
  );
}

export default function WeddingTasteForm({ onComplete, initialDraft }: WeddingTasteFormProps) {
  const [draft, setDraft] = useState(() => parseWeddingTasteDraft(initialDraft) ?? createEmptyWeddingTasteDraft());
  const [index, setIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const domains = selectedTasteDomains(draft);
  const answeredDomains = domains.filter(domain => draft.details[domain]?.status === "answered");
  const steps: Step[] = [
    { kind: "priorities" }, { kind: "mood" }, ...domains.map(domain => ({ kind: "detail" as const, domain })),
    { kind: "avoids" }, ...(answeredDomains.length ? [{ kind: "negotiability" as const }] : []),
  ];
  const step = steps[Math.min(index, steps.length - 1)];
  const last = index >= steps.length - 1;
  useEffect(() => { heading.current?.focus(); }, [index]);

  function changePriorities(priorityDomains: WeddingTasteDraftV1["priorityDomains"]) {
    setDraft(previous => {
      const keep = priorityDomains.status === "answered" ? priorityDomains.values : [];
      const details: WeddingTasteDraftV1["details"] = {};
      const negotiability: WeddingTasteDraftV1["negotiability"] = {};
      for (const domain of keep) {
        if (previous.details[domain]) details[domain] = previous.details[domain];
        if (previous.negotiability[domain]) negotiability[domain] = previous.negotiability[domain];
      }
      return { ...previous, priorityDomains, details, negotiability };
    });
  }
  function changeDetail(domain: TasteDomain, response: TasteSelection) {
    setDraft(previous => {
      const negotiability = { ...previous.negotiability };
      // 방향이 바뀌면 이전 답에 대한 협의 의사를 새 답으로 옮기지 않는다.
      delete negotiability[domain];
      return { ...previous, details: { ...previous.details, [domain]: response }, negotiability };
    });
  }
  function next() {
    setError(null);
    if (!last) { setIndex(value => value + 1); return; }
    const parsed = parseWeddingTasteDraft(draft);
    if (!parsed) { setError("선택한 내용을 확인하지 못했어요. 이전 질문에서 다시 확인해주세요."); return; }
    onComplete(parsed);
  }
  const title = step.kind === "priorities" ? "내 결혼식에서 특히 중요하게 생각하는 것은 무엇인가요?"
    : step.kind === "mood" ? "원하는 결혼식 분위기는 어떤 쪽인가요?"
    : step.kind === "detail" ? TASTE_DOMAIN_QUESTIONS[step.domain].question
    : step.kind === "avoids" ? "이번 준비에서 피하고 싶은 것이 있나요?"
    : "서로 생각이 다르면 어느 정도 맞춰보고 싶나요?";
  return (
    <section aria-labelledby="wedding-taste-question" className="rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)]">
      <div className="border-b border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] px-5 py-6 sm:px-7">
        <p className="text-[13px] font-semibold text-[var(--hb-success)]" aria-live="polite">질문 {index + 1} · 선택한 주제에 따라 최대 6개</p>
        <h2 ref={heading} id="wedding-taste-question" tabIndex={-1} className="mt-3 text-[22px] font-semibold leading-relaxed text-[var(--hb-text-strong)] focus:outline-none">{title}</h2>
        <p className="mt-3 text-[14px] leading-relaxed text-[var(--hb-text-body)]">
          {step.kind === "priorities" ? "지금 먼저 이야기할 것 두 가지만 골라도 돼요. 다른 항목이 덜 중요하다는 뜻은 아니에요."
            : step.kind === "negotiability" ? "방금 직접 고른 방향만 확인해요. 다른 안을 함께 보는 것은 양보 약속이 아니에요."
            : step.kind === "avoids" ? "해당하는 것만 골라주세요. 피하고 싶은 것이 곧 두 사람의 합의나 계약 조건은 아니에요."
            : "상대의 생각을 대신 고르지 않고, 지금 내가 원하는 만큼만 답해주세요."}
        </p>
      </div>
      <div className="px-5 py-6 sm:px-7">
        {step.kind === "priorities" ? <Choices value={draft.priorityDomains} options={TASTE_DOMAIN_OPTIONS} max={2} onChange={changePriorities}
          statusLabels={{ no_preference: "지금 우선순위를 나누지 않을게요" }} /> : null}
        {step.kind === "mood" ? <Choices value={draft.mood} options={TASTE_MOOD_OPTIONS} max={2} onChange={mood => setDraft(previous => ({ ...previous, mood }))} /> : null}
        {step.kind === "detail" ? <Choices value={draft.details[step.domain] ?? { status: "skipped" }} options={TASTE_DOMAIN_QUESTIONS[step.domain].options}
          max={TASTE_DOMAIN_QUESTIONS[step.domain].max} onChange={value => changeDetail(step.domain, value)} /> : null}
        {step.kind === "avoids" ? <Choices value={draft.avoids} options={TASTE_AVOID_OPTIONS} max={3} onChange={avoids => setDraft(previous => ({ ...previous, avoids }))}
          statusLabels={{ no_preference: "특별히 피하고 싶은 것은 없어요", not_applicable: "이번 계획에는 해당하지 않아요" }} /> : null}
        {step.kind === "negotiability" ? <div className="space-y-6">
          {answeredDomains.map(domain => (
            <fieldset key={domain}>
              <legend className="mb-3 text-[15px] font-semibold text-[var(--hb-text-strong)]">{TASTE_DOMAIN_OPTIONS.find(option => option.value === domain)?.label}</legend>
              <div className="space-y-2">
                {TASTE_NEGOTIABILITY_OPTIONS.map(option => (
                  <Button key={option.value} variant="secondary" fullWidth aria-pressed={draft.negotiability[domain] === option.value}
                    onClick={() => setDraft(previous => {
                      const negotiability = { ...previous.negotiability };
                      if (negotiability[domain] === option.value) delete negotiability[domain];
                      else negotiability[domain] = option.value;
                      return { ...previous, negotiability };
                    })}>
                    <span className="flex-1 whitespace-normal text-left">{option.label}</span>
                    {draft.negotiability[domain] === option.value ? <Check aria-hidden="true" className="size-4 shrink-0 text-[var(--hb-success)]" /> : null}
                  </Button>
                ))}
              </div>
            </fieldset>
          ))}
        </div> : null}
        {error ? <p role="alert" className="mt-4 text-[14px] text-[var(--hb-text-strong)]">{error}</p> : null}
        <div className="mt-6 flex gap-3 border-t border-[var(--hb-hairline)] pt-5">
          <Button variant="secondary" disabled={index === 0} onClick={() => { setError(null); setIndex(value => Math.max(0, value - 1)); }}>이전</Button>
          <Button variant="primary" className="flex-1" onClick={next}>{last ? "내 선택 보기" : "다음"}</Button>
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-[var(--hb-text-muted)]">답하지 않은 항목은 비워둬요. 선택만으로 계정이나 아모라에 저장되지 않아요.</p>
      </div>
    </section>
  );
}
