"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { DOMAIN_DEFINITIONS, SCALE, type Answer, type Item } from "@/lib/weddingCode/likert/types";

export interface QuestionPanelProps {
  item: Item;
  answer?: Answer;
  index: number;
  total: number;
  answered: number;
  onAnswer: (answer: Answer) => void;
  onBack: () => void;
  onNext: () => void;
  onPause: () => void;
  canNext?: boolean;
}

const focusStyle =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ivory-50)]";

const otherAnswers = [
  { status: "unknown", label: "아직 모르겠어요" },
  { status: "not_applicable", label: "내 상황에 해당하지 않아요" },
] as const;

function answerLabel(answer?: Answer): string | null {
  if (!answer) return null;
  if (answer.status === "rated") {
    return `${answer.value} · ${SCALE.find((option) => option.value === answer.value)?.label ?? ""}`;
  }
  if (answer.status === "unknown") return "아직 모르겠어요";
  if (answer.status === "not_applicable") return "내 상황에 해당하지 않아요";
  return "이 문항은 건너뛰었어요";
}

function QuestionView({
  item,
  answer,
  index,
  total,
  answered,
  onAnswer,
  onBack,
  onNext,
  onPause,
  canNext,
}: QuestionPanelProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const ratingRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const skipRef = useRef<HTMLButtonElement>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const elementId = useId();
  const headingId = `${elementId}-question`;
  const contextId = `${elementId}-context`;
  const helperId = `${elementId}-scale-help`;
  const completed = Math.min(Math.max(answered, 0), total);
  const selectedLabel = answerLabel(answer);
  const domain = DOMAIN_DEFINITIONS.find((entry) => entry.id === item.domain);
  const nextEnabled = Boolean(answer) && canNext !== false;

  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    window.scrollTo({ top: 0, left: 0, behavior: reduceMotion ? "instant" : "smooth" });
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  function choose(nextAnswer: Answer) {
    setConfirmSkip(false);
    onAnswer(nextAnswer);
  }

  function moveRatingFocus(event: KeyboardEvent<HTMLButtonElement>, position: number) {
    let nextPosition: number;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextPosition = (position + 1) % SCALE.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextPosition = (position + SCALE.length - 1) % SCALE.length;
    } else if (event.key === "Home") {
      nextPosition = 0;
    } else if (event.key === "End") {
      nextPosition = SCALE.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    ratingRefs.current[nextPosition]?.focus();
  }

  return (
    <section className="mx-auto w-full max-w-3xl px-5 pb-10 pt-4 font-[family-name:var(--font-pretendard)] text-[var(--hb-text-strong)] sm:px-8 sm:pb-16 sm:pt-8">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold tabular-nums">
          질문 {index + 1} <span className="font-normal text-[var(--hb-text-body)]">/ {total}</span>
        </p>
        <button
          type="button"
          onClick={onPause}
          className={`min-h-11 rounded-lg px-3 py-2 text-sm font-medium text-[var(--hb-text-body)] underline underline-offset-4 hover:bg-[var(--ivory-100)] ${focusStyle}`}
        >
          잠시 멈추기
        </button>
      </div>
      <progress
        value={completed}
        max={Math.max(total, 1)}
        aria-label="응답 진행률"
        aria-valuetext={`${total}개 중 ${completed}개 응답 기록`}
        className="mt-3 block h-1.5 w-full overflow-hidden rounded-full border-0 bg-[var(--ivory-200)] [&::-moz-progress-bar]:bg-[var(--hb-primary)] [&::-webkit-progress-bar]:bg-[var(--ivory-200)] [&::-webkit-progress-value]:bg-[var(--hb-primary)]"
      />
      <p className="mt-2 text-right text-xs tabular-nums text-[var(--hb-text-body)]">
        응답 기록 {completed}/{total}
      </p>

      <div className="mt-7 sm:mt-10">
        <p className="text-xs font-semibold tracking-[0.04em] text-[var(--hb-selected-text)]">
          {domain?.name} · {item.sceneTitle}
        </p>
        <p id={contextId} className="mt-3 border-l-2 border-[var(--hb-summary-line)] pl-4 text-sm leading-7 text-[var(--hb-text-body)] [word-break:keep-all] sm:text-base">
          {item.context}
        </p>
        <h1
          id={headingId}
          aria-describedby={contextId}
          ref={headingRef}
          tabIndex={-1}
          className="mt-6 text-[clamp(1.45rem,3.5vw,2rem)] font-semibold leading-[1.6] tracking-[-0.035em] outline-none [word-break:keep-all] sm:mt-8"
        >
          {item.text}
        </h1>
      </div>

      <div
        role="group"
        aria-labelledby={headingId}
        aria-describedby={`${contextId} ${helperId}`}
        className="mt-7 grid gap-2 sm:mt-9 sm:grid-cols-5 sm:gap-3"
      >
        {SCALE.map((option, position) => {
          const selected = answer?.status === "rated" && answer.value === option.value;
          return (
            <button
              key={option.value}
              ref={(element) => { ratingRefs.current[position] = element; }}
              type="button"
              aria-pressed={selected}
              onClick={() => choose({ status: "rated", value: option.value })}
              onKeyDown={(event) => moveRatingFocus(event, position)}
              className={`flex min-h-14 items-center gap-4 rounded-xl border px-5 py-3 text-left transition-colors motion-reduce:transition-none sm:min-h-28 sm:flex-col sm:justify-center sm:gap-2 sm:px-2 sm:py-4 sm:text-center ${focusStyle} ${selected
                ? "border-[var(--hb-primary)] bg-[var(--hb-primary)] text-[var(--hb-on-primary)]"
                : "border-[var(--taupe-500)] bg-[var(--hb-surface-raised)] text-[var(--hb-text-strong)] hover:bg-[var(--hb-surface-hover)]"}`}
            >
              <span className="w-5 shrink-0 text-xl font-semibold tabular-nums sm:w-auto sm:text-3xl">
                {option.value}
              </span>
              <span className="text-sm font-medium leading-6 [word-break:keep-all]">
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
      <p id={helperId} className="mt-3 text-xs leading-6 text-[var(--hb-text-body)] [word-break:keep-all]">
        3은 ‘보통이다’예요. 판단하기 어렵다면 아래 ‘아직 모르겠어요’를 골라주세요.
      </p>

      <div className="mt-5 border-t border-[var(--hb-hairline)] pt-3">
        <div role="group" aria-label="숫자로 답하기 어려운 경우" className="grid gap-1 sm:grid-cols-3 sm:gap-2">
          {otherAnswers.map((option) => (
            <button
              key={option.status}
              type="button"
              aria-pressed={answer?.status === option.status}
              onClick={() => choose({ status: option.status })}
              className={`min-h-11 rounded-lg px-3 py-2.5 text-sm leading-6 underline underline-offset-4 ${focusStyle} ${answer?.status === option.status
                ? "bg-[var(--hb-selected-bg)] font-semibold text-[var(--hb-selected-text)]"
                : "text-[var(--hb-text-body)] hover:bg-[var(--ivory-100)]"}`}
            >
              {option.label}
            </button>
          ))}
          <button
            ref={skipRef}
            type="button"
            aria-pressed={answer?.status === "skipped"}
            aria-expanded={confirmSkip}
            onClick={() => setConfirmSkip(true)}
            className={`min-h-11 rounded-lg px-3 py-2.5 text-sm leading-6 underline underline-offset-4 ${focusStyle} ${answer?.status === "skipped"
              ? "bg-[var(--hb-selected-bg)] font-semibold text-[var(--hb-selected-text)]"
              : "text-[var(--hb-text-body)] hover:bg-[var(--ivory-100)]"}`}
          >
            이 문항 건너뛰기
          </button>
        </div>
        {confirmSkip && (
          <div role="group" aria-label="건너뛰기 확인" className="mt-3 border-l-2 border-[var(--hb-primary)] pl-4">
            <p className="text-sm leading-7 [word-break:keep-all]">
              이 문항은 답하지 않고 건너뛴 것으로 기록할까요?
              나중에 돌아와 바꿀 수 있어요.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                autoFocus
                type="button"
                onClick={() => {
                  choose({ status: "skipped" });
                  skipRef.current?.focus();
                }}
                className={`min-h-11 rounded-lg bg-[var(--hb-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--hb-on-primary)] hover:bg-[var(--hb-primary-hover)] ${focusStyle}`}
              >
                건너뛰기 확인
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmSkip(false);
                  skipRef.current?.focus();
                }}
                className={`min-h-11 rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-[var(--ivory-100)] ${focusStyle}`}
              >
                다시 답하기
              </button>
            </div>
          </div>
        )}
      </div>

      <p aria-live="polite" aria-atomic="true" className="mt-5 min-h-6 text-center text-xs leading-6 text-[var(--hb-text-body)]">
        {selectedLabel ? `선택한 답: ${selectedLabel}` : "내 답을 고른 뒤 다음으로 넘어가세요."}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className={`min-h-12 rounded-xl px-5 py-3 text-sm font-semibold text-[var(--hb-text-body)] hover:bg-[var(--ivory-100)] ${focusStyle}`}
        >
          이전
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!nextEnabled || confirmSkip}
          className={`min-h-12 flex-1 rounded-xl bg-[var(--hb-primary)] px-6 py-3 text-base font-semibold text-[var(--hb-on-primary)] transition-colors hover:bg-[var(--hb-primary-hover)] disabled:cursor-not-allowed disabled:bg-[var(--ivory-200)] disabled:text-[var(--taupe-500)] motion-reduce:transition-none ${focusStyle}`}
        >
          {index + 1 === total ? "답 정리하기" : "다음"}
        </button>
      </div>
    </section>
  );
}

export function QuestionPanel(props: QuestionPanelProps) {
  return <QuestionView key={props.item.id} {...props} />;
}

export default QuestionPanel;
