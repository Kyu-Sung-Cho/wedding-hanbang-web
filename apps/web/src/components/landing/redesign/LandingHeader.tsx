import Link from "next/link";

import { headerNav } from "./landingContent";
import LandingAccountActions from "./LandingAccountActions";
import LandingSession from "./LandingSession";
import MobileLandingMenu from "./MobileLandingMenu";
import TrackedLandingLink from "./TrackedLandingLink";
import { shell } from "./notebook";

/**
 * 헤더.
 *
 * 종이 위에 얹힌 띠로 둔다. 이전 헤더는 짙은 유칼립투스 바탕(#243832)이었는데,
 * 그러면 페이지 맨 위가 노트가 아니라 앱 크롬으로 읽힌다.
 *
 * 내비 항목은 `landingContent.headerNav` 가 정본이다. 본문 앵커는 섹션 순서를 따른다.
 * 항목이 본문에 없는 앵커를 가리키면 눌러도 아무 일이 안 일어난다 — 실제로 있었다.
 */
const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2";
const navigationLinkClassName = `inline-flex min-h-11 items-center text-[15px] font-normal text-[var(--color-paper-ink-soft)] transition-colors duration-200 hover:text-[var(--color-paper-ink)] motion-reduce:transition-none ${focusRing}`;

export default function LandingHeader() {
  return (
    <LandingSession>
      <header className="sticky top-0 z-50 border-b border-[var(--color-paper-edge)] bg-[var(--color-paper-sheet)]/95 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className={`${shell} flex min-h-[68px] items-center justify-between gap-5 py-3 lg:min-h-[98px] lg:py-[26px]`}>
          <Link
            href="/landing"
            className={`landing-display inline-flex min-h-11 shrink-0 items-center whitespace-nowrap text-[17px] text-[var(--color-paper-ink)] lg:text-[21px] ${focusRing}`}
          >
            웨딩한방
          </Link>

          <nav className="hidden items-center gap-6 lg:flex" aria-label="랜딩페이지 주요 메뉴">
            {headerNav.map((item) => item.href.startsWith("#") ? (
              <Link
                key={item.href}
                href={item.href}
                className={navigationLinkClassName}
              >
                {item.label}
              </Link>
            ) : (
              <TrackedLandingLink key={item.href} href={item.href} source="landing_header" className={navigationLinkClassName}>
                {item.label}
              </TrackedLandingLink>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <LandingAccountActions variant="desktop" />
            <MobileLandingMenu items={headerNav} />
          </div>
        </div>
      </header>
    </LandingSession>
  );
}
