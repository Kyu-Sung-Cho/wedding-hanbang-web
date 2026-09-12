import Link from "next/link";

import { headerAuth, headerNav } from "./landingContent";
import MobileLandingMenu from "./MobileLandingMenu";
import TrackedLandingLink from "./TrackedLandingLink";
import { shell } from "./notebook";

/**
 * 헤더.
 *
 * 종이 위에 얹힌 띠로 둔다. 이전 헤더는 짙은 유칼립투스 바탕(#243832)이었는데,
 * 그러면 페이지 맨 위가 노트가 아니라 앱 크롬으로 읽힌다.
 *
 * 내비 항목은 `landingContent.headerNav` 가 정본이고 본문 섹션 순서와 같아야 한다.
 * 항목이 본문에 없는 앵커를 가리키면 눌러도 아무 일이 안 일어난다 — 실제로 있었다.
 */
const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2";

export default function LandingHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-[var(--color-paper-edge)] bg-[var(--color-paper-sheet)]/95 pt-[env(safe-area-inset-top)] backdrop-blur">
      <div className={`${shell} flex min-h-[68px] items-center justify-between gap-5 py-3 lg:min-h-[98px] lg:py-[26px]`}>
        <Link
          href="/landing"
          className={`landing-display inline-flex min-h-11 shrink-0 items-center whitespace-nowrap text-[17px] text-[var(--color-paper-ink)] lg:text-[21px] ${focusRing}`}
        >
          웨딩한방
        </Link>

        <nav className="hidden items-center gap-[38px] lg:flex" aria-label="랜딩페이지 주요 메뉴">
          {headerNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`inline-flex min-h-11 items-center text-[15px] font-normal text-[var(--color-paper-ink-soft)] transition-colors duration-200 hover:text-[var(--color-paper-ink)] motion-reduce:transition-none ${focusRing}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          {/* 가입·로그인은 좁은 화면에서 메뉴 안에 있다(MobileLandingMenu).
              넓은 화면에는 메뉴가 없으므로 여기서 내놓는다 — 없으면 데스크톱에서만
              가입 경로가 사라진다. */}
          <Link
            href={headerAuth.logIn.href}
            className={`hidden min-h-11 items-center px-3 text-[14px] font-medium text-[var(--color-paper-ink-soft)] transition-colors duration-200 hover:text-[var(--color-paper-ink)] motion-reduce:transition-none lg:inline-flex ${focusRing}`}
          >
            {headerAuth.logIn.label}
          </Link>
          {/* 2026-08-28: 정본 시안(`docs/landing/NotebookBest.html`)의 헤더는
              오른쪽 끝 버튼이 "시작하기" 다. 그전에는 "스무 장면 답해보기" 가 하드코딩돼
              있었는데, 시안에 없는 행동이고 카피 정본을 읽지도 않았다. */}
          <TrackedLandingLink
            href={headerAuth.signUp.href}
            source="landing_header"
            className={`hidden min-h-11 items-center rounded-[8px] bg-[var(--hb-action)] px-[26px] text-[15px] font-semibold text-[var(--color-paper-card)] transition-colors duration-200 hover:bg-[var(--hb-action-hover)] motion-reduce:transition-none sm:inline-flex ${focusRing}`}
          >
            {headerAuth.signUp.label}
          </TrackedLandingLink>
          <MobileLandingMenu items={headerNav} />
        </div>
      </div>
    </header>
  );
}
