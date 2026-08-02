import Link from "next/link";
import { Menu } from "lucide-react";

import TrackedLandingLink from "./TrackedLandingLink";

const shell = "mx-auto w-full max-w-[1240px] px-5 sm:px-8 lg:px-10";

const navItems = [
  { label: "어떻게 정리되나요", href: "#how-it-works" },
  { label: "함께 보기·나만 보기", href: "#privacy" },
  { label: "안심하고 쓰는 이유", href: "#trust" },
] as const;

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#E2D3C8] focus-visible:ring-offset-4 focus-visible:ring-offset-[#243832]";

export default function LandingHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-white/10 bg-[#243832]/96 pt-[env(safe-area-inset-top)] text-white backdrop-blur">
      <div className={`${shell} flex h-14 items-center justify-between gap-5 md:h-16`}>
        <Link
          href="/landing"
          className={`inline-flex min-h-11 items-center text-[20px] font-semibold tracking-[-0.02em] ${focusRing}`}
        >
          웨딩한방
        </Link>

        <nav className="hidden items-center gap-8 md:flex" aria-label="랜딩페이지 주요 메뉴">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`inline-flex min-h-11 items-center text-[14px] font-medium text-white/74 transition-colors hover:text-white ${focusRing}`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <details className="relative md:hidden">
            <summary
              aria-label="주요 메뉴 열기"
              title="메뉴"
              className={`flex h-11 w-11 cursor-pointer list-none items-center justify-center [&::-webkit-details-marker]:hidden ${focusRing}`}
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
            </summary>
            <nav
              aria-label="모바일 주요 메뉴"
              className="absolute right-0 top-12 flex w-56 flex-col border border-white/14 bg-[#243832] p-2 shadow-[0_20px_50px_rgba(0,0,0,0.35)]"
            >
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex min-h-11 items-center px-4 py-3 text-[14px] font-semibold text-white/78 transition-colors hover:bg-white/8 hover:text-white ${focusRing}`}
                >
                  {item.label}
                </Link>
              ))}
              <Link
                href="/login"
                className={`flex min-h-11 items-center border-t border-white/12 px-4 py-3 text-[14px] font-semibold text-white/78 transition-colors hover:bg-white/8 hover:text-white ${focusRing}`}
              >
                로그인
              </Link>
            </nav>
          </details>

          <Link
            href="/login"
            className={`hidden min-h-11 items-center px-2 text-[14px] font-semibold text-white/72 transition-colors hover:text-white sm:inline-flex ${focusRing}`}
          >
            로그인
          </Link>
          <TrackedLandingLink
            href="/start-here"
            source="landing_header"
            className={`inline-flex min-h-11 items-center rounded-full bg-[#8F6662] px-4 text-[14px] font-semibold text-white transition-colors hover:bg-[#7D5753] sm:px-5 ${focusRing}`}
          >
            내 준비 순서 보기
          </TrackedLandingLink>
        </div>
      </div>
    </header>
  );
}
