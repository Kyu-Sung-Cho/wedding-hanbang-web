"use client";

// wc64 시작 화면과 식 질문 화면. 문구는 문항 은행(meta)의 문장을 그대로 쓴다.
import { useEffect, useState, type ReactNode } from "react";
import Button from "@/components/ui/Button";
import { WC64_BANK, WC64_ORDER, wc64SectionAskedCount } from "@/lib/weddingCode/wc64/bank";
import type { Wc64Plan } from "@/lib/weddingCode/wc64/types";
import {
  wc64Body, wc64Chip, wc64Choice, wc64Eyebrow, wc64Meta, wc64Notice, wc64Primary, wc64Quiet, wc64Secondary, wc64Title,
} from "./styles";

/** 시작 화면과 결과 화면에 한 번씩 두는 고지 */
export const WC64_UNTESTED_NOTICE = "아직 실제 사람에게 확인하지 않은 새 질문이에요.";

/**
 * 이 브라우저의 64문항 답을 지우는 버튼 이름. 시작·식 질문·문장 화면과 결과 화면이 같은 이름을 쓰고,
 * 누르면 여는 확인 창 제목(WC64_CLEAR_CONFIRM_TITLE)과 같은 말로 맞춘다.
 * 이 버튼은 64문항 기록(clearWc64Draft)만 지우므로 이름도 '64문항 답'으로 좁힌다(2026-10-17 상품 심사 M3).
 * 예전 이름 '이 브라우저의 답 모두 지우기'는 v3.1·36문항 답이 남는데도 모두 지운다고 읽혔다.
 */
export const WC64_CLEAR_ANSWERS_LABEL = "이 브라우저의 64문항 답 지우기";
export const WC64_CLEAR_CONFIRM_TITLE = "이 브라우저의 64문항 답을 지울까요?";

/** 36문항 저장 키(storage36 의 LATEST 와 개인 이어 하기 키). 키가 있을 때만 36문항 모듈을 불러와 확인한다. */
const WC36_HINT_KEYS = ["wc36:latest", "wc36:draft:individual"] as const;
/**
 * v3.1 이어 하기 키(lib/weddingCode/v31LocalProgress 의 LOCAL_KEY). 그 모듈은 v3.1 문항 은행을 싣기 때문에
 * 64문항 화면에서 가져오지 않고 글자만 둔다. 같은 값인지는 flow.test.tsx 가 본다.
 */
export const WC64_V31_PROGRESS_KEY = "hanbang:wedding-code:v3.1:progress";

function hasKey(kinds: readonly ("localStorage" | "sessionStorage")[], keys: readonly string[]): boolean {
  for (const kind of kinds) {
    try {
      const store = window[kind];
      if (keys.some((k) => store.getItem(k) !== null)) return true;
    } catch { /* 이 저장소를 못 쓰면 다른 저장소를 본다. */ }
  }
  return false;
}

function hasWc36Hint(): boolean {
  return hasKey(["localStorage", "sessionStorage"], WC36_HINT_KEYS);
}

/**
 * 이 브라우저에 64문항 밖의 웨딩코드 기록(36문항, v3.1)이 남아 있는지. 64문항 지우기는 그 기록을 건드리지 않으므로
 * 지우기 확인 창과 상태 줄이 그 사실을 함께 말할 때만 쓴다. 키만 보고, 읽거나 지우지 않는다.
 */
export function hasOtherWeddingCodeRecords(): boolean {
  return hasWc36Hint() || hasKey(["localStorage"], [WC64_V31_PROGRESS_KEY]);
}

/** 식 없이 하면 묻는 문장 수(식을 전제한 '예식' 문장을 뺀 수). 은행에서 센다. */
const NO_CEREMONY_COUNT = WC64_ORDER.reduce((n, sid) => n + wc64SectionAskedCount(sid, "none"), 0);

type Previous36 = { kind: "result"; href: string } | { kind: "draft"; href: string };

/**
 * 맨 주소가 64문항으로 바뀌기 전에 36문항을 하던 사람에게 돌아갈 길을 하나 둔다.
 * 36문항 은행이 64문항 화면에 실리지 않도록, 저장 키가 있을 때만 늦게 불러온다.
 */
function usePrevious36(enabled: boolean): Previous36 | null {
  const [previous, setPrevious] = useState<Previous36 | null>(null);
  useEffect(() => {
    // 라운지 안(embedded)에서는 36문항 기록을 읽지도 않고 링크도 두지 않는다. 누르면 앱 밖 공개 화면으로 나가기 때문이다.
    if (!enabled || !hasWc36Hint()) return;
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
  }, [enabled]);
  return previous;
}

export interface Intro64Props {
  /** 이어 할 기록이 있을 때 답한 문장 수와 전체 문장 수. finished 는 그 기록이 결과 화면까지 간 것인지. */
  saved: { done: number; total: number; finished?: boolean } | null;
  /** 새로 시작. 이어 할 기록이 있으면 부르는 쪽이 확인 창을 먼저 띄운다. */
  onStart: () => void;
  onResume: () => void;
  /** 라운지 안에 넣었을 때. WEDDING CODE 표기와 36문항 링크를 두지 않고, 제목은 h2 로 둔다(라운지의 h1 은 앱 껍데기 것). */
  embedded?: boolean;
  /** 버튼 열 끝에 덧붙일 것(라운지의 이전 판 버튼). 시작 화면에만 보인다. */
  extra?: ReactNode;
}

export default function Intro64({ saved, onStart, onResume, embedded = false, extra }: Intro64Props) {
  const { meta } = WC64_BANK;
  const previous36 = usePrevious36(!embedded);
  const Heading = embedded ? "h2" : "h1";
  return (
    <section className="mt-3 space-y-6" data-wc64-screen="intro">
      {embedded ? null : <p className={wc64Eyebrow}>WEDDING CODE</p>}
      <Heading data-wc64-focus tabIndex={-1} className={wc64Title}>웨딩코드</Heading>
      {/* 실제 첫 질문은 식 계획이고 그다음이 이해도 묶음(KNOW)이다(2026-10-17 상품 심사 UX-3).
          결과 이름은 글자를 모두 정했을 때만 붙어서(model.ts reportName, 식 없이 하면 남는 두 글자) '정해지면'으로 쓴다(2026-10-17 파운더 결정).
          식 없이 하는 사람의 이름 말은 아래 식 없이 줄에서 되풀이하지 않는다(2026-10-17 점검: 두 문단이 같은 말을 했다). */}
      <p className={wc64Body} data-wc64-intro-lead>
        식 계획 한 가지와 결혼 준비를 얼마나 아는지부터 묻고, 고른 답을 네 글자와 %로 모아 보여 드려요. 글자가 모두 정해지면 그 조합에 붙인 이름도 함께 나와요.
      </p>
      <ul className="flex flex-wrap gap-2" aria-label="이 판 한눈에">
        {meta.facts.map((f) => (
          <li key={f.label} className={wc64Chip}>{f.label} <b className="font-semibold text-[#3A2A27]">{f.value}</b></li>
        ))}
      </ul>
      {/* 칩의 64개·네 글자·16가지는 식을 올리는 경우다. 식 없이 하면 달라지는 것을 바로 밑에 적는다(UX-2, DEC-1).
          식 없이 한 결과에도 남는 두 글자를 모두 정하면 은행 no_ceremony_names 의 이름이 붙는다(2026-10-17 파운더 결정). */}
      <p className={wc64Meta} data-wc64-noceremony-facts>
        식 없이 하면 결혼식을 전제한 문장은 빼고 {NO_CEREMONY_COUNT}문장만 물어요. 결과는 두 글자와 %로 나오고, 16가지 유형 설명은 없어요.
      </p>
      <p className={wc64Notice} data-wc64-notice>{WC64_UNTESTED_NOTICE}</p>
      <div className="flex flex-col gap-3">
        {saved ? (
          <>
            {saved.finished ? (
              <Button type="button" variant="primary" size="lg" onClick={onResume} className={`${wc64Primary} w-full`}
                data-wc64-resume="result">
                내 결과 다시 보기
              </Button>
            ) : (
              <Button type="button" variant="primary" size="lg" onClick={onResume} className={`${wc64Primary} w-full`}
                data-wc64-resume="questions">
                이어 하기
                <span className="text-sm font-normal tabular-nums">{saved.done}/{saved.total}</span>
              </Button>
            )}
            <Button type="button" variant="secondary" size="md" onClick={onStart} aria-haspopup="dialog"
              className={`${wc64Secondary} w-full`} data-wc64-new-start>
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
        {extra}
      </div>
    </section>
  );
}

export interface Plan64Props {
  plan: Wc64Plan | null;
  onPick: (plan: Wc64Plan) => void;
  onBack: () => void;
}

/**
 * 식 질문. 질문, 고르면 무엇이 바뀌는지 적은 도움말(은행 meta.plan_question.help), 보기 셋만 둔다.
 * 64문장 전체에 대한 안내는 첫 성향 묶음(PLAN)의 안내 카드가 보여 준다.
 * 도움말은 화면이 바뀌면 초점을 받는 질문 제목에만 설명으로 잇는다. 보기 묶음에도 이으면 스크린리더가 같은 글을 두 번 읽는다.
 */
export function Plan64({ plan, onPick, onBack }: Plan64Props) {
  const { plan_question: q } = WC64_BANK.meta;
  return (
    <section className="mt-3 space-y-5" data-wc64-screen="plan">
      <h2 data-wc64-focus tabIndex={-1} id="wc64-plan-q" aria-describedby="wc64-plan-help"
        className="text-xl font-semibold leading-8 outline-none">{q.q}</h2>
      <p id="wc64-plan-help" className={wc64Body} data-wc64-plan-help>{q.help}</p>
      <div role="group" aria-labelledby="wc64-plan-q" className="flex flex-col gap-2.5">
        {q.options.map((o) => (
          <Button key={o.value} type="button" variant={plan === o.value ? "primary" : "secondary"} size="lg"
            aria-pressed={plan === o.value} data-plan={o.value} onClick={() => onPick(o.value)}
            className={wc64Choice(plan === o.value)}>
            {o.label}
          </Button>
        ))}
      </div>
      <div>
        <Button type="button" variant="secondary" size="md" onClick={onBack} className={wc64Quiet}>이전</Button>
      </div>
    </section>
  );
}
