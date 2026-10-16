"use client";

// wc64 시작 화면과 식 질문 화면. 문구는 문항 은행(meta)의 문장을 그대로 쓴다.
import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import { WC64_BANK } from "@/lib/weddingCode/wc64/bank";
import type { Wc64Plan } from "@/lib/weddingCode/wc64/types";
import {
  wc64Body, wc64Chip, wc64Choice, wc64Eyebrow, wc64Meta, wc64Note, wc64Notice, wc64Primary, wc64Quiet,
  wc64Secondary, wc64Tag, wc64Title,
} from "./styles";

/** 시작 화면과 결과 화면에 한 번씩 두는 고지 */
export const WC64_UNTESTED_NOTICE = "아직 실제 사람에게 확인하지 않은 새 질문이에요.";

/** 36문항 저장 키(storage36 의 LATEST 와 개인 이어 하기 키). 키가 있을 때만 36문항 모듈을 불러와 확인한다. */
const WC36_HINT_KEYS = ["wc36:latest", "wc36:draft:individual"] as const;

function hasWc36Hint(): boolean {
  for (const kind of ["localStorage", "sessionStorage"] as const) {
    try {
      const store = window[kind];
      if (WC36_HINT_KEYS.some((k) => store.getItem(k) !== null)) return true;
    } catch { /* 이 저장소를 못 쓰면 다른 저장소를 본다. */ }
  }
  return false;
}

type Previous36 = { kind: "result"; href: string } | { kind: "draft"; href: string };

/**
 * 맨 주소가 64문항으로 바뀌기 전에 36문항을 하던 사람에게 돌아갈 길을 하나 둔다.
 * 36문항 은행이 64문항 화면에 실리지 않도록, 저장 키가 있을 때만 늦게 불러온다.
 */
function usePrevious36(): Previous36 | null {
  const [previous, setPrevious] = useState<Previous36 | null>(null);
  useEffect(() => {
    if (!hasWc36Hint()) return;
    let alive = true;
    import("@/app/wedding-code/storage36")
      .then((m) => {
        if (!alive) return;
        const result = m.readResult36();
        if (result) setPrevious({ kind: "result", href: `/wedding-code/result?v=36&rid=${result.id}` });
        else if (m.readDraft36(null)) setPrevious({ kind: "draft", href: "/wedding-code?v=36" });
      })
      .catch(() => { /* 못 불러오면 링크 없이 64문항만 보여 준다. */ });
    return () => { alive = false; };
  }, []);
  return previous;
}

export interface Intro64Props {
  /** 이어 할 기록이 있을 때 답한 문장 수와 전체 문장 수 */
  saved: { done: number; total: number } | null;
  onStart: () => void;
  onResume: () => void;
}

export default function Intro64({ saved, onStart, onResume }: Intro64Props) {
  const { meta } = WC64_BANK;
  const previous36 = usePrevious36();
  return (
    <section className="mt-3 space-y-6" data-wc64-screen="intro">
      <p className={wc64Eyebrow}>WEDDING CODE</p>
      <h1 data-wc64-focus tabIndex={-1} className={wc64Title}>웨딩코드</h1>
      <p className={wc64Body}>웨딩을 얼마나 아는지부터 묻고, 고른 답을 네 글자와 비율로 모아 보여 드려요.</p>
      <ul className="flex flex-wrap gap-2" aria-label="이 판 한눈에">
        {meta.facts.map((f) => (
          <li key={f.label} className={wc64Chip}>{f.label} <b className="font-semibold text-[#3A2A27]">{f.value}</b></li>
        ))}
      </ul>
      <p className={wc64Notice} data-wc64-notice>{WC64_UNTESTED_NOTICE}</p>
      <div className="flex flex-col gap-3">
        {saved ? (
          <>
            <Button type="button" variant="primary" size="lg" onClick={onResume} className={`${wc64Primary} w-full`}>
              이어 하기
              <span className="text-sm font-normal tabular-nums">{saved.done}/{saved.total}</span>
            </Button>
            <Button type="button" variant="secondary" size="md" onClick={onStart} className={`${wc64Secondary} w-full`}>
              새로 시작
            </Button>
          </>
        ) : (
          <Button type="button" variant="primary" size="lg" onClick={onStart} className={`${wc64Primary} w-full`}>
            시작하기
          </Button>
        )}
        {previous36 ? (
          <Button href={previous36.href} variant="secondary" size="md" className={`${wc64Secondary} w-full no-underline`}
            data-wc64-previous36={previous36.kind}>
            {previous36.kind === "result" ? "36문항 결과 다시 보기" : "36문항 이어 하기"}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

export interface Plan64Props {
  plan: Wc64Plan | null;
  onPick: (plan: Wc64Plan) => void;
  onBack: () => void;
}

/** 식 질문. 결과 계산에는 들어가지 않고, 예식 문항을 보여 줄지만 정한다. */
export function Plan64({ plan, onPick, onBack }: Plan64Props) {
  const { plan_question: q, start_note: startNote } = WC64_BANK.meta;
  return (
    <section className="mt-3 space-y-5" data-wc64-screen="plan">
      <p className={wc64Tag}>시작하기 전에</p>
      <h2 data-wc64-focus tabIndex={-1} id="wc64-plan-q" className="text-xl font-semibold leading-8 outline-none">{q.q}</h2>
      <p className={wc64Note}>{startNote}</p>
      <div role="group" aria-labelledby="wc64-plan-q" className="flex flex-col gap-2.5">
        {q.options.map((o) => (
          <Button key={o.value} type="button" variant={plan === o.value ? "primary" : "secondary"} size="lg"
            aria-pressed={plan === o.value} data-plan={o.value} onClick={() => onPick(o.value)}
            className={wc64Choice(plan === o.value)}>
            {o.label}
          </Button>
        ))}
      </div>
      <p className={wc64Meta}>{q.help}</p>
      <div>
        <Button type="button" variant="secondary" size="md" onClick={onBack} className={wc64Quiet}>이전</Button>
      </div>
    </section>
  );
}
