"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import Button from "@/components/ui/Button";
import { DETAIL_SCENES, MOOD_SCENES, PRIORITY_SCENES } from "./tasteScenes";
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

type ChoiceOption<T extends string> = { value: T; label: string; description?: string };

/**
 * 그림 칸의 배치. 칸 수마다 **한 줄에 몇 개가 읽히는가**로 정했다.
 *
 * - 분위기 4개: 360px 폰부터 2×2. 그보다 좁으면 그림을 왼쪽에 둔 가로줄로 쌓는다
 *   (320px 에서는 칸 폭이 약 119px 라 "간결한 분위기" 가 두 줄로 부서진다).
 * - 공간 3개: 640px 부터 한 줄에 셋. 그 아래에서 셋을 나란히 두면 "실내와 야외를 함께
 *   쓰는 곳" 이 세 줄이 되므로 가로줄로 쌓는다.
 * - 주제·하객 규모 6개: 360px 폰부터 2열×3줄, 640px 부터 3열×2줄. 2열일 때 그림을 2:1 로
 *   낮춘다 — 390px 에서 칸 높이가 약 120px 라 세 줄(약 376px)이 글자 버튼 여섯 줄
 *   (6×64px + 간격 = 424px)보다 낮다. 360px 보다 좁으면 다른 칸처럼 가로줄로 쌓는다.
 */
const TILE_LAYOUT = {
  grid: { 3: "grid-cols-1 sm:grid-cols-3", 4: "grid-cols-1 min-[360px]:grid-cols-2", 6: "grid-cols-1 min-[360px]:grid-cols-2 sm:grid-cols-3" },
  tile: { 3: "flex-row sm:flex-col", 4: "flex-row min-[360px]:flex-col", 6: "flex-row min-[360px]:flex-col" },
  scene: {
    3: "w-28 border-r sm:w-full sm:border-r-0 sm:border-b",
    4: "w-28 border-r min-[360px]:w-full min-[360px]:border-r-0 min-[360px]:border-b",
    6: "w-28 border-r min-[360px]:w-full min-[360px]:border-r-0 min-[360px]:border-b min-[360px]:aspect-[2/1]",
  },
} as const;
type TileColumns = keyof typeof TILE_LAYOUT.grid;

function SceneTile({ option, visual, selected, disabled, columns, onToggle }: {
  option: ChoiceOption<string>; visual: ReactNode; selected: boolean; disabled: boolean; columns: TileColumns; onToggle: () => void;
}) {
  const id = useId();
  return (
    <Button variant="secondary" fullWidth data-taste-tile={option.value}
      aria-pressed={selected} aria-labelledby={id + "-label"} aria-describedby={option.description ? id + "-description" : undefined}
      disabled={disabled} onClick={onToggle}
      className={"relative h-full overflow-hidden px-0! " + (selected ? "border-[var(--hb-success)]! bg-[var(--hb-surface-hover)]!" : "")}>
      <span className={"flex w-full self-stretch whitespace-normal " + TILE_LAYOUT.tile[columns]}>
        <span className={"relative aspect-[8/5] shrink-0 border-[var(--hb-hairline)] sm:aspect-[2/1] " + TILE_LAYOUT.scene[columns]}>
          {visual}
          {selected ? <span className="absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-full bg-[var(--hb-success)] text-[var(--hb-on-primary)]">
            <Check aria-hidden="true" className="size-4" strokeWidth={2.5} />
          </span> : null}
        </span>
        <span className="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2.5 text-left">
          <span id={id + "-label"} data-choice-label="" className="break-keep text-[15px] font-semibold leading-snug text-[var(--hb-text-strong)]">{option.label}</span>
          {option.description ? <span id={id + "-description"} data-choice-description="" className="break-keep text-[13px] font-normal leading-snug text-[var(--hb-text-body)]">{option.description}</span> : null}
        </span>
      </span>
      {/* 버튼 자기 테두리(1px) 안쪽에 1px 을 더 둘러 선택 테두리를 2px 로 읽히게 한다. 레이아웃은 밀지 않는다. */}
      {selected ? <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[5px] border border-[var(--hb-success)]" /> : null}
    </Button>
  );
}

function Choices<T extends string>({ value, options, max, onChange, statusLabels, visuals }: {
  value: TasteSelection<T>; options: readonly ChoiceOption<T>[]; max: number;
  onChange: (value: TasteSelection<T>) => void; statusLabels?: Partial<Record<TasteUnansweredStatus, string>>;
  /** 값마다 그릴 분위기 그림. 주면 글자 버튼 대신 그림 칸으로 보인다. 칸은 3·4·6개만 배치가 정해져 있다. */
  visuals?: Record<NoInfer<T>, () => ReactNode>;
}) {
  const selected = value.status === "answered" ? value.values : [];
  function toggle(option: T) {
    const next = selected.includes(option) ? selected.filter(item => item !== option)
      : max === 1 ? [option] : selected.length < max ? [...selected, option] : selected;
    onChange(next.length ? { status: "answered", values: next } : { status: "skipped" });
  }
  const columns: TileColumns | null = options.length === 3 || options.length === 4 || options.length === 6 ? options.length : null;
  return (
    <div>
      <p className="mb-3 text-[13px] text-[var(--hb-text-muted)]">{max === 1 ? "하나만 골라 주세요. 딱 맞는 게 없으면 아래에서 골라도 돼요." : "최대 " + max + "개까지 고를 수 있어요. 다시 누르면 선택이 풀려요."}</p>
      {visuals && columns ? <div className={"grid gap-2 sm:gap-3 " + TILE_LAYOUT.grid[columns]}>
        {options.map(option => {
          const drawScene = visuals[option.value];
          return <SceneTile key={option.value} option={option} visual={drawScene()} columns={columns}
            selected={selected.includes(option.value)}
            disabled={max > 1 && selected.length >= max && !selected.includes(option.value)}
            onToggle={() => toggle(option.value)} />;
        })}
      </div> : <div className="space-y-2">
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
      </div>}
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
    if (!parsed) { setError("고른 내용을 정리하지 못했어요. 앞 질문으로 돌아가 다시 골라 주세요."); return; }
    onComplete(parsed);
  }
  const title = step.kind === "priorities" ? "원하는 결혼식, 뭐부터 이야기해 볼까요?"
    : step.kind === "mood" ? "어떤 분위기의 결혼식이 좋아요?"
    : step.kind === "detail" ? TASTE_DOMAIN_QUESTIONS[step.domain].question
    : step.kind === "avoids" ? "꼭 피하고 싶은 게 있나요?"
    : "둘의 생각이 다르면 어떻게 하고 싶나요?";
  return (
    <section aria-labelledby="wedding-taste-question" className="rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)]">
      <div className="border-b border-[var(--hb-hairline)] bg-[var(--hb-surface-hover)] px-5 py-6 sm:px-7">
        <p className="text-[13px] font-semibold text-[var(--hb-success)]" aria-live="polite">질문 {index + 1} · 전체 질문은 최대 6개</p>
        <h2 ref={heading} id="wedding-taste-question" tabIndex={-1} className="mt-3 text-[22px] font-semibold leading-relaxed text-[var(--hb-text-strong)] focus:outline-none">{title}</h2>
        <p className="mt-3 text-[14px] leading-relaxed text-[var(--hb-text-body)]">
          {step.kind === "priorities" ? "고른 주제는 뒤에서 조금 더 자세히 물어볼게요. 안 고른 건 나중에 이야기해도 돼요."
            : step.kind === "negotiability" ? "앞에서 고른 주제만 물어볼게요. 다른 안도 볼 수 있다고 해서 양보하겠다는 뜻은 아니에요."
            : step.kind === "avoids" ? "내가 피하고 싶은 것만 골라 주세요."
            : "상대 생각 말고 내 취향대로 골라 주세요."}
        </p>
      </div>
      <div className="px-5 py-6 sm:px-7">
        {step.kind === "priorities" ? <Choices value={draft.priorityDomains} options={TASTE_DOMAIN_OPTIONS} max={2} onChange={changePriorities}
          statusLabels={{ no_preference: "딱히 먼저 할 이야기는 없어요" }} visuals={PRIORITY_SCENES} /> : null}
        {step.kind === "mood" ? <Choices value={draft.mood} options={TASTE_MOOD_OPTIONS} max={2} onChange={mood => setDraft(previous => ({ ...previous, mood }))}
          visuals={MOOD_SCENES} /> : null}
        {step.kind === "detail" ? <Choices value={draft.details[step.domain] ?? { status: "skipped" }} options={TASTE_DOMAIN_QUESTIONS[step.domain].options}
          max={TASTE_DOMAIN_QUESTIONS[step.domain].max} onChange={value => changeDetail(step.domain, value)}
          visuals={DETAIL_SCENES[step.domain]} /> : null}
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
        <p className="mt-3 text-[12px] leading-relaxed text-[var(--hb-text-muted)]">건너뛴 질문은 빈칸으로 남아요. 여기서 고른 건 아직 어디에도 저장되지 않아요.</p>
      </div>
    </section>
  );
}
