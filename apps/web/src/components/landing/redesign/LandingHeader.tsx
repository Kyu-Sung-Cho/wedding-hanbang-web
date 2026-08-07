import Link from "next/link";

import { primaryActionSm } from "./landingType";
import MobileLandingMenu from "./MobileLandingMenu";
import TrackedLandingLink from "./TrackedLandingLink";

const shell = "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";

const navItems = [
  { label: "어떻게 정리되나요", href: "#how-it-works" },
  { label: "함께·나만 보기", href: "#privacy" },
  { label: "신뢰 기준", href: "#trust" },
  { label: "시작 조건·비용", href: "#start-conditions" },
] as const;

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2D3C8] focus-visible:ring-offset-4 focus-visible:ring-offset-[#243832]";

export default function LandingHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/12 bg-[#243832]/96 pt-[env(safe-area-inset-top)] text-white backdrop-blur">
      <div className={`${shell} flex h-14 items-center justify-between gap-5 lg:h-16`}>
        <Link
          href="/landing"
          className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap text-[20px] font-semibold tracking-[-0.02em] ${focusRing}`}
        >
          웨딩한방
        </Link>

        <nav className="hidden items-center gap-5 lg:flex xl:gap-8" aria-label="랜딩페이지 주요 메뉴">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`inline-flex min-h-11 items-center text-[14px] font-medium text-white/74 transition-colors duration-200 hover:text-white ${focusRing}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <MobileLandingMenu items={navItems} />

          <Link
            href="/login"
            className={`hidden min-h-11 items-center px-2 text-[14px] font-semibold text-white/72 transition-colors duration-200 hover:text-white sm:inline-flex ${focusRing}`}
          >
            로그인
          </Link>
          <TrackedLandingLink
            href="/start-here"
            source="landing_header"
            className={`${primaryActionSm} shrink-0 justify-center whitespace-nowrap ${focusRing}`}
          >
            <span className="sm:hidden">시작하기</span>
            <span className="hidden sm:inline">아모라와 시작하기</span>
          </TrackedLandingLink>
        </div>
      </div>
    </header>
  );
}
