"use client";

import { useEffect, useRef } from "react";
import Button from "@/components/ui/Button";

export interface IntroPanelProps {
  onStart: () => void;
  onResume?: () => void;
  savedAnswered?: number;
  total: number;
  invite?: boolean;
  storageNotice?: string;
}

const focusStyle =
  "whitespace-normal! focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ivory-50)]";

export function IntroPanel({
  onStart,
  onResume,
  savedAnswered = 0,
  total,
  invite = false,
  storageNotice,
}: IntroPanelProps) {
  const savedCount = Math.min(Math.max(savedAnswered, 0), total);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true;
    window.scrollTo({ top: 0, left: 0, behavior: reduceMotion ? "instant" : "smooth" });
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section className="mx-auto w-full max-w-5xl px-5 pb-14 pt-6 font-[family-name:var(--font-pretendard)] text-[var(--hb-text-strong)] sm:px-8 sm:pb-20 sm:pt-10">
      <p className="text-xs font-semibold tracking-[0.18em] text-[var(--hb-text-body)]">
        WEDDING CODE
      </p>

      <div className="mt-7 grid gap-10 lg:grid-cols-[1.25fr_0.8fr] lg:items-start lg:gap-16">
        <div>
          {invite && (
            <p className="mb-4 text-sm font-medium text-[var(--hb-selected-text)]">
              파트너가 함께 읽을 준비 이야기에 초대했어요.
            </p>
          )}
          <h1 ref={headingRef} tabIndex={-1} className="text-[clamp(2.1rem,5.5vw,3.7rem)] font-semibold leading-[1.22] tracking-[-0.055em] outline-none [word-break:keep-all]">
            결혼을 준비하는
            <br />
            나의 언어를 찾아요.
          </h1>
          <p className="mt-6 max-w-lg text-base leading-[1.85] text-[var(--hb-text-body)] [word-break:keep-all] sm:text-lg">
            어디에 더 쓰고 싶은지, 어떻게 함께 준비하고 싶은지.
            익숙한 준비 장면에 답하며 내 기준을 조금 더 구체적으로 만나보세요.
          </p>
          <p className="mt-4 max-w-lg text-sm leading-7 text-[var(--hb-text-body)] [word-break:keep-all]">
            답을 네 주제로 읽는 자기 탐색 놀이예요. 지금의 답에 따라 결과가 달라질 수 있어요.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:max-w-md">
            {onResume ? (
              <>
                <Button variant="primary"
                  type="button"
                  onClick={onResume}
                  className={`min-h-14 rounded-xl bg-[var(--hb-primary)] px-6 py-4 text-base font-semibold text-[var(--hb-on-primary)] transition-colors hover:bg-[var(--hb-primary-hover)] motion-reduce:transition-none ${focusStyle}`}
                >
                  이어서 답하기
                  <span className="ml-2 text-sm font-normal tabular-nums">
                    {savedCount}/{total}
                  </span>
                </Button>
                <Button variant="ghost"
                  type="button"
                  onClick={onStart}
                  className={`min-h-11 rounded-xl px-6 py-3 text-sm font-medium text-[var(--hb-text-body)] underline decoration-[var(--taupe-500)] underline-offset-4 hover:bg-[var(--ivory-100)] ${focusStyle}`}
                >
                  처음부터 새로 답하기
                </Button>
              </>
            ) : (
              <Button variant="primary"
                type="button"
                onClick={onStart}
                className={`min-h-14 rounded-xl bg-[var(--hb-primary)] px-6 py-4 text-base font-semibold text-[var(--hb-on-primary)] transition-colors hover:bg-[var(--hb-primary-hover)] motion-reduce:transition-none ${focusStyle}`}
              >
                {invite ? "내 답 남기기" : "나의 준비 언어 찾기"}
              </Button>
            )}
            <p className="text-center text-xs leading-6 text-[var(--hb-text-body)]">
              {total}개의 짧은 문장 · 한 문장씩 · 답은 다시 바꿀 수 있어요
            </p>
          </div>
          {storageNotice && (
            <p className="mt-4 max-w-lg text-xs leading-6 text-[var(--hb-text-body)] [word-break:keep-all]">
              {storageNotice}
            </p>
          )}
        </div>

        <aside className="border-t border-[var(--hb-summary-line)] bg-[var(--hb-summary-surface)] px-6 py-7 text-[var(--hb-summary-ink)] sm:px-8 sm:py-8 lg:mt-2" aria-label="결과에서 읽는 네 가지 주제">
          <p className="text-xs font-semibold tracking-[0.14em] text-[var(--hb-summary-label)]">
            네 글자에 담는 준비 이야기
          </p>
          <ol className="mt-6 divide-y divide-[var(--hb-summary-line)]">
            {[
              ["01", "지출", "추가 예산을 어디에 쓰고 싶은지"],
              ["02", "준비", "후보를 어떻게 살펴보고 추릴지"],
              ["03", "가족", "협의 전에 무엇을 확인하고 정리할지"],
              ["04", "도움", "어떤 반응과 도움을 받고 싶은지"],
            ].map(([number, title, description]) => (
              <li key={number} className="grid grid-cols-[1.8rem_1fr] gap-3 py-4 first:pt-0">
                <span className="pt-0.5 text-xs font-medium tabular-nums text-[var(--hb-summary-label)]">
                  {number}
                </span>
                <div>
                  <p className="text-lg font-semibold tracking-[-0.03em]">{title}</p>
                  <p className="mt-1 text-sm leading-6 text-[var(--hb-summary-label)] [word-break:keep-all]">
                    {description}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-sm leading-7 [word-break:keep-all]">
            네 주제의 두 가지 응답 방향을 묶으면 16개의 조합.
            각 조합에는 형용사와 동물로 만든 네 글자 놀이 별명이 붙어요.
          </p>
          <p className="mt-3 text-sm leading-7 text-[var(--hb-summary-label)] [word-break:keep-all]">
            결과에서 각자의 답을 읽고, 파트너에게 부탁하고 싶은 말도 찾아보세요.
          </p>
        </aside>
      </div>

      <div className="mt-10 border-t border-[var(--hb-hairline)] pt-5 sm:mt-14">
        <p className="text-sm leading-7 text-[var(--hb-text-body)] [word-break:keep-all]">
          한 문장마다 1~5로 답해요. 서로 다른 바람이 함께 있어도 괜찮아요.
          아직 모르거나 내 상황에 해당하지 않으면 따로 표시할 수 있어요.
        </p>
      </div>
    </section>
  );
}

export default IntroPanel;
