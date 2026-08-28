import TrackedLandingLink from "./TrackedLandingLink";

import { landingContent } from "./landingContent";
import { band, noteText, shell } from "./notebook";

/**
 * 마무리.
 *
 * 정본 시안 `웨딩한방-랜딩시안/NotebookBest.html` 의 마지막 섹션이다.
 * 한 줄을 손글씨로 크게 쓰고 행동 둘만 남긴다 — 여기까지 읽은 사람에게
 * 설명을 더 얹지 않는다.
 *
 * ## 버튼이 히어로와 같아야 한다
 *
 * 첫 화면과 마무리가 다른 행동을 부르면 페이지 전체가 무엇을 시키려는 건지 흐려진다.
 * 시안의 첫 버튼("가입 없이 물어보기")은 경로가 닫혀 있어(2026-08-27) 히어로와 같은
 * 행동으로 맞췄다.
 */
export default function ClosingAction() {
  const { closing } = landingContent;

  return (
    <section className={`${band} text-center`} aria-labelledby="closing-title">
      <div className={shell}>
        <h2
          id="closing-title"
          className="landing-hand text-[clamp(1.9rem,5.4vw,2.9rem)] leading-[1.3] text-[var(--color-paper-ink)]"
        >
          {closing.title}
        </h2>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <TrackedLandingLink
            source="landing_closing_primary"
            href={closing.primary.href}
            className="inline-flex min-h-[54px] items-center justify-center rounded-[6px] bg-[var(--color-paper-ink)] px-7 text-[16px] font-semibold text-[var(--color-paper-card)] transition-colors duration-200 hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            {closing.primary.label}
          </TrackedLandingLink>
          <TrackedLandingLink
            source="landing_closing_signup"
            href={closing.secondary.href}
            className="inline-flex min-h-[54px] items-center justify-center rounded-[6px] border border-[var(--color-paper-outline)] px-6 text-[16px] font-semibold text-[var(--color-paper-ink)] transition-colors duration-200 hover:border-[var(--color-paper-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            {closing.secondary.label}
          </TrackedLandingLink>
        </div>

        <p className="mt-6">
          <TrackedLandingLink
            source="landing_closing_login"
            href={closing.tertiary.href}
            className="landing-pen text-[15px] font-medium text-[var(--color-paper-ink)]"
          >
            {closing.tertiary.label}
          </TrackedLandingLink>
        </p>

        <p className={`mx-auto mt-8 max-w-[58ch] ${noteText}`}>{closing.note}</p>
      </div>
    </section>
  );
}
