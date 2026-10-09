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
 * 제목과 본문은 공통 Pretendard를 쓰고 크기와 굵기로 구분한다.
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
        <hr className="mb-9 border-0 border-t border-[var(--color-paper-on-ink-rule)] lg:mb-[58px]" />

        <h2 id="closing-title" className={sectionTitleOnInk}>
          <TitleLines value={closing.title} />
        </h2>

        <p className="mx-auto mt-4 max-w-[600px] text-[15px] leading-[1.75] text-[var(--color-paper-on-ink-soft)] lg:text-[17px]">{closing.body}</p>
        <ol aria-label="아모라 시작 순서" className="mx-auto mt-7 grid max-w-[860px] gap-3 text-left lg:grid-cols-3 lg:gap-6">
          {closing.steps.map((step, index) => (
            <li key={step} className="flex items-start gap-3 border-t border-[var(--color-paper-on-ink-rule)] pt-3 text-[14px] leading-[1.7] text-[var(--color-paper-on-ink-soft)]">
              <span aria-hidden="true" className="text-[var(--color-paper-on-ink-faint)]">0{index + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>

        <div className="mt-[30px] flex flex-col items-stretch justify-center gap-3 lg:flex-row lg:items-center lg:gap-[18px]">
          <TrackedLandingLink
            source="landing_closing_primary"
            href={closing.primary.href}
            prefetch={false}
            className="inline-flex min-h-[54px] items-center justify-center rounded-[11px] bg-[var(--color-paper-on-ink)] px-7 py-3 text-center text-[16px] font-semibold text-[var(--color-paper-ink)] transition-colors duration-200 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-on-ink)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-paper-ink)] motion-reduce:transition-none lg:rounded-[9px]"
          >
            {closing.primary.label}
          </TrackedLandingLink>
        </div>


        {/* `{closing.note}` 를 **한 줄로** 적는다 — `landingDesignSystem.test.ts` 가
            `<p …>{closing.note}</p>` 라는 모양으로 조건 문단의 존재를 판정한다. */}
        <p className={`mx-auto mt-8 max-w-[58ch] ${noteTextOnInk}`}>{closing.note}</p>
      </div>
    </section>
  );
}
