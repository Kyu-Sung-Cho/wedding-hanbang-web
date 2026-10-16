"use client";

// wc64 묶음 안내 카드와 문장 화면. 원본(page6-shell.html renderTake)과 같은 순서와 문구를 쓴다.
import { useRef, type KeyboardEvent } from "react";
import Button from "@/components/ui/Button";
import { WC64_BANK } from "@/lib/weddingCode/wc64/bank";
import type { Wc64Answer, Wc64Item, Wc64Rating, Wc64Section } from "@/lib/weddingCode/wc64/types";
import {
  wc64Card, wc64Choice, wc64Meta, wc64Note, wc64Primary, wc64ProgressFill, wc64ProgressTrack, wc64Quiet,
  wc64Secondary, wc64Tag,
} from "./styles";

export interface Progress64Props { done: number; total: number }

/** 진행 막대. 숫자는 지금 보이는 문장만 센다. */
export function Progress64({ done, total }: Progress64Props) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-1.5" data-wc64-progress data-done={done} data-left={total - done}>
      <span className={wc64ProgressTrack} aria-hidden="true">
        <i className={wc64ProgressFill} style={{ width: `${pct}%` }} />
      </span>
      <p className={`flex justify-between gap-3 tabular-nums ${wc64Meta}`}>
        <span>답한 문장 {done}</span>
        <span>남은 문장 {total - done}</span>
      </p>
    </div>
  );
}

export interface Section64Props {
  section: Wc64Section;
  /** 이 묶음에서 보여 줄 문장 수 */
  count: number;
  /** 식을 안 올리는 사람에게 다른 자리 안내를 보여 줄지 */
  showAlt: boolean;
  progress: Progress64Props;
  onBack: () => void;
  onStart: () => void;
  /** 묶음 전체 넘기기(skip_all 이나 다른 자리 없음). 없으면 버튼을 그리지 않는다. */
  onSkipAll?: () => void;
}

/** 묶음 안내 카드 */
export function Section64({ section: s, count, showAlt, progress, onBack, onStart, onSkipAll }: Section64Props) {
  const skipLabel = showAlt ? "그런 자리도 없어요" : s.skip_all;
  return (
    <section className={`mt-3 ${wc64Card}`} data-wc64-screen="section" data-wc64-section={s.id}>
      <Progress64 {...progress} />
      <p className={wc64Tag}>{s.group_label}</p>
      <h2 data-wc64-focus tabIndex={-1} className="text-xl font-semibold leading-8 outline-none">{s.title}</h2>
      <p className={wc64Meta}>{count}문장</p>
      {s.intro ? <p className={wc64Note}>{s.intro}</p> : null}
      {showAlt ? <p className={wc64Note}>{s.noceremony_alt}</p> : null}
      {/* 폰 폭: 시작(꽉 찬 폭) → 넘기기 → 이전을 한 줄씩. 넓은 화면: 왼쪽 이전, 오른쪽 넘기기·시작. */}
      <div className="flex flex-col gap-2 sm:flex-row-reverse sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row-reverse sm:items-center">
          <Button type="button" variant="primary" size="lg" onClick={onStart} className={`${wc64Primary} w-full sm:w-auto`} data-wc64-begin>
            {showAlt ? "그 자리로 답할게요" : "시작"}
          </Button>
          {onSkipAll && skipLabel ? (
            <Button type="button" variant="secondary" size="md" onClick={onSkipAll} className={`${wc64Quiet} w-full sm:w-auto`} data-wc64-skip-all>
              {skipLabel}
            </Button>
          ) : null}
        </div>
        <Button type="button" variant="secondary" size="md" onClick={onBack} className={`${wc64Secondary} w-full sm:w-auto`}>이전</Button>
      </div>
    </section>
  );
}

export interface Question64Props {
  item: Wc64Item;
  section: Wc64Section;
  answer: Wc64Answer | undefined;
  /** 고른 칸이 눌린 것을 보여 준 뒤 다음으로 넘어가는 동안 true */
  locked: boolean;
  progress: Progress64Props;
  onPick: (value: Wc64Rating) => void;
  onNotApplicable: () => void;
  onBack: () => void;
}

/** 한 화면에 한 문장. 다섯 칸은 세로로 놓고, '해당 없음'은 skip_tag 가 있는 문장에만 둔다. */
export default function Question64({ item, section, answer, locked, progress, onPick, onNotApplicable, onBack }: Question64Props) {
  const scale = WC64_BANK.meta.scale;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const stmtId = `wc64-stmt-${item.id}`;

  function moveFocus(event: KeyboardEvent<HTMLButtonElement>, position: number) {
    let next: number;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") next = (position + 1) % scale.length;
    else if (event.key === "ArrowUp" || event.key === "ArrowLeft") next = (position + scale.length - 1) % scale.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = scale.length - 1;
    else return;
    event.preventDefault();
    refs.current[next]?.focus();
  }

  return (
    <section className={`mt-3 ${wc64Card}`} data-wc64-screen="item" data-wc64-item={item.id}>
      <Progress64 {...progress} />
      <p className={wc64Tag}>{section.title}</p>
      <h2 id={stmtId} data-wc64-focus tabIndex={-1}
        className="min-h-[3em] text-xl font-semibold leading-8 outline-none sm:text-[21px]">
        {item.text}
      </h2>
      <div role="group" aria-labelledby={stmtId} className="flex flex-col gap-2">
        {scale.map((label, k) => {
          const value = (k + 1) as Wc64Rating;
          const selected = answer === value;
          return (
            <Button key={value} type="button" variant={selected ? "primary" : "secondary"} size="lg"
              ref={(el) => { refs.current[k] = el; }}
              aria-pressed={selected} data-v={value}
              onClick={() => { if (!locked) onPick(value); }}
              onKeyDown={(e) => moveFocus(e, k)}
              className={wc64Choice(selected)}>
              <span className={`w-5 shrink-0 tabular-nums ${selected ? "text-white" : "text-[#6E5A54]"}`}>{value}</span>
              <span>{label}</span>
            </Button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="secondary" size="md" onClick={() => { if (!locked) onBack(); }} className={wc64Secondary}>이전</Button>
        {item.skip_tag ? (
          <Button type="button" variant="secondary" size="md" onClick={() => { if (!locked) onNotApplicable(); }}
            aria-pressed={answer === 0} data-wc64-na className={wc64Quiet}>
            해당 없음
          </Button>
        ) : null}
      </div>
    </section>
  );
}
