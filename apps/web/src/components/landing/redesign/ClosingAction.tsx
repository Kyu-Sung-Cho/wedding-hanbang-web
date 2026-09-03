import TrackedLandingLink from "./TrackedLandingLink";

import { landingContent } from "./landingContent";
import { bandBottom, noteTextOnInk, sectionTitleOnInk, shell, TitleLines } from "./notebook";

/**
 * 마무리.
 *
 * 2026-09-03 시안(`(웨딩한방) 랜딩페이지 디자인 예시.pdf`)의 마지막 두 화면 중 아래쪽.
 * 경계 섹션과 **같은 어두운 띠** 안에 있고, 그 위에 가는 선 하나로 나뉜다.
 * 그래서 여기서 배경을 다시 칠하지 않고 위 섹션이 연 색을 이어받는다.
 *
 * 제목은 손글씨가 아니라 본문 서체다 — 시안이 그렇고, 어두운 바탕에서 손글씨(Gaegu)는
 * 획이 가늘어 같은 크기에서도 눈에 띄게 흐려진다.
 *
 * ## 버튼이 히어로와 같아야 한다
 *
 * 첫 화면과 마무리가 다른 행동을 부르면 페이지 전체가 무엇을 시키려는 건지 흐려진다.
 * 시안도 두 자리에 같은 버튼("아모라와 준비 시작하기")을 둔다.
 */
export default function ClosingAction() {
  const { closing } = landingContent;

  return (
    <section
      className={`${bandBottom} bg-[var(--color-paper-ink)] text-center`}
      aria-labelledby="closing-title"
    >
      <div className={shell}>
        {/* 경계 섹션과 이 섹션을 가르는 가는 선. 시안에 있는 유일한 구분이다. */}
        <hr className="mb-14 border-0 border-t border-[var(--color-paper-on-ink-rule)] sm:mb-[76px]" />

        <h2 id="closing-title" className={sectionTitleOnInk}>
          <TitleLines value={closing.title} />
        </h2>

        <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <TrackedLandingLink
            source="landing_closing_primary"
            href={closing.primary.href}
            className="inline-flex min-h-[54px] items-center justify-center rounded-[6px] bg-[var(--color-paper-on-ink)] px-7 text-[16px] font-semibold text-[var(--color-paper-ink)] transition-colors duration-200 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-on-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-paper-ink)] motion-reduce:transition-none"
          >
            {closing.primary.label}
          </TrackedLandingLink>
          {/* 시안에서 둘째 행동은 테두리 버튼이 아니라 글자 링크다 — 어두운 바탕에서
              버튼 둘을 나란히 두면 무엇을 먼저 눌러야 하는지가 흐려진다. */}
          <TrackedLandingLink
            source="landing_closing_signup"
            href={closing.secondary.href}
            className="inline-flex min-h-11 items-center justify-center px-2 text-[16px] font-medium text-[var(--color-paper-on-ink-soft)] transition-colors duration-200 hover:text-[var(--color-paper-on-ink)] motion-reduce:transition-none"
          >
            {closing.secondary.label}
          </TrackedLandingLink>
        </div>

        <p className="mt-6">
          <TrackedLandingLink
            source="landing_closing_login"
            href={closing.tertiary.href}
            className="inline-flex min-h-11 items-center text-[14px] font-medium text-[var(--color-paper-on-ink-faint)] underline underline-offset-4 transition-colors duration-200 hover:text-[var(--color-paper-on-ink)] motion-reduce:transition-none"
          >
            {closing.tertiary.label}
          </TrackedLandingLink>
        </p>

        {/* `{closing.note}` 를 **한 줄로** 적는다 — `landingDesignSystem.test.ts` 가
            `<p …>{closing.note}</p>` 라는 모양으로 조건 문단의 존재를 판정한다. */}
        <p className={`mx-auto mt-8 max-w-[58ch] ${noteTextOnInk}`}>{closing.note}</p>
      </div>
    </section>
  );
}
