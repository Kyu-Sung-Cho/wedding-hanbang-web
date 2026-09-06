import { Sparkles } from "lucide-react";

import TrackedLandingLink from "./TrackedLandingLink";

import { landingContent } from "./landingContent";
import { band, bodyText, eyebrowText, noteText, shell } from "./notebook";

/**
 * ④ 둘의 의견이 다를 때 — **편을 들지 않는다.**
 *
 * 2026-09-03 시안: 왼쪽에 카피·버튼·사진 자리, 오른쪽에 신부/신랑/아모라 대화 카드.
 *
 * ## 이 섹션이 파는 것은 기능이 아니다
 *
 * "편을 들지 않는다"는 못 하는 게 아니라 **선택**이고, 그게 이 제품이 범용 챗봇과
 * 갈리는 자리다. 그래서 대화 카드가 셋이다 — 두 사람이 각자 말하고, 아모라가 어느
 * 쪽 손도 들지 않은 채 둘 다 지킬 선을 찾는 장면이 한 화면에 있어야 한다.
 *
 * `note` 는 AI 고지와 샘플 표시를 함께 진다. 아모라가 말하는 카드에는 매번 붙는다.
 */
export default function NoSideSection() {
  const { noSide } = landingContent;

  return (
    <section
      id="noside"
      className={`${band} border-y border-[var(--color-paper-edge)] bg-[var(--color-ivory-warm)]`}
      aria-labelledby="noside-title"
    >
      <div className={`${shell} grid gap-y-5 lg:grid-cols-2 lg:gap-x-[72px] lg:gap-y-0`}>
        <div className="min-w-0 lg:col-start-1 lg:row-start-1 lg:self-end">
          <p className="mb-[10px] lg:mb-3">
            <span className={eyebrowText}>
              {noSide.eyebrow}
            </span>
          </p>

          <h2 id="noside-title" className="landing-display text-[24px] leading-[1.48] text-[var(--color-paper-ink)] lg:text-[31px] lg:leading-[1.42]">
            {noSide.title.split("\n").map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h2>

        </div>

        <div className="min-w-0 rounded-[16px] border border-[var(--color-paper-edge)] bg-[var(--color-paper-card)] p-[18px] shadow-raised lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center lg:rounded-[18px] lg:p-6">
          {noSide.turns.map((turn, index) => {
            const isAmora = turn.who === "아모라";
            return (
              <div key={turn.who} className="mt-[13px] first:mt-0 lg:mt-4">
                <p className={`mb-[6px] flex items-center gap-[6px] text-[11px] lg:mb-[7px] lg:gap-[7px] lg:text-[11.5px] ${isAmora ? "font-semibold text-[var(--color-rose-700)]" : "text-[var(--color-paper-ink-faint)]"}`}>
                  {isAmora ? <Sparkles aria-hidden className="size-[14px]" strokeWidth={1.7} /> : null}
                  {turn.who}
                </p>
                <p className={`rounded-[13px] px-[14px] py-3 text-[13.5px] leading-[1.7] text-[var(--color-paper-ink)] lg:rounded-[15px] lg:px-[17px] lg:py-[14px] lg:text-[14.5px] ${
                  isAmora
                    ? "rounded-bl-[4px] bg-[var(--color-sage-pale)] lg:rounded-bl-[5px]"
                    : index === 0
                      ? "rounded-bl-[4px] bg-[var(--color-rose-pale)] lg:rounded-bl-[5px]"
                      : "rounded-br-[4px] bg-[var(--color-surface-low)] lg:rounded-br-[5px]"
                }`}>
                  {turn.say}
                </p>
              </div>
            );
          })}
          <p className={`mt-4 ${noteText}`}>{noSide.note}</p>
        </div>

        <div className="min-w-0 lg:col-start-1 lg:row-start-2 lg:self-start lg:pt-4">
          <p className={bodyText}>{noSide.body}</p>

          <p className="mt-[22px] lg:mt-7">
            <TrackedLandingLink
              source="landing_noside_scenes"
              href={noSide.cta.href}
              className="inline-flex min-h-[52px] w-full items-center justify-center rounded-[11px] border-[1.5px] border-[var(--color-paper-ink)] px-6 text-center text-[15.5px] font-semibold text-[var(--color-paper-ink)] transition-colors duration-200 hover:bg-[var(--color-ivory-200)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none lg:min-h-11 lg:w-auto lg:rounded-[8px] lg:text-[15px]"
            >
              {noSide.cta.label}
            </TrackedLandingLink>
          </p>

          {/* 사진 자리. 사진이 들어오기 전에는 제작 안내문을 방문자에게 내보내지 않는다
              (landingContent.noSide.photo.visible). 출시 전에 실제 사진으로 바꾼다. */}
          {noSide.photo.visible ? (
            <div className="mt-[30px] hidden min-h-[210px] flex-col items-center justify-center rounded-[16px] border border-dashed border-[var(--color-paper-outline)] bg-[var(--color-ivory-blush)] px-6 py-5 text-center lg:flex">
              <p className="text-[14px] font-semibold text-[var(--color-paper-ink-soft)]">
                {noSide.photo.title}
              </p>
              {noSide.photo.captions.map((caption) => (
                <p key={caption} className={`mt-2 ${noteText}`}>
                  {caption}
                </p>
              ))}
            </div>
          ) : null}
        </div>

      </div>
    </section>
  );
}
