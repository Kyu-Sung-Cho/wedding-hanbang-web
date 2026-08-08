import type { Metadata } from "next";
import Link from "next/link";

import StartHereClient from "@/components/community/StartHereClient";
import { CONTACT } from "@/lib/constants/contact";

export const metadata: Metadata = {
  title: "결혼 준비 지금 뭐부터? — 날짜가 없어도 시작하는 첫 순서",
  description:
    "날짜가 있으면 지금 볼 준비 세 가지를, 아직 없으면 둘이 먼저 맞출 기준을 정리해 드려요. 로그인 없이 시작할 수 있고, 입력한 날짜는 이 화면에서 서버로 보내지 않습니다.",
  alternates: { canonical: "/start-here" },
  openGraph: {
    title: "결혼 준비 지금 뭐부터? — 날짜가 없어도 시작하는 첫 순서",
    description: "날짜가 있으면 지금 볼 세 가지를, 없으면 둘이 먼저 맞출 기준을 정리해 드려요.",
    url: "/start-here",
    type: "website",
  },
};

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8F6662] focus-visible:ring-offset-4";

// 첫 가치 확인에만 집중하도록 커뮤니티 내비게이션과 플로팅 런처가 없는 독립 공개 화면을 쓴다.
export default function StartHerePage() {
  return (
    <div className="min-h-screen bg-[#FBF8F2] text-[#243832]">
      <a
        href="#start-here-main"
        className="sr-only z-[100] bg-white px-4 py-3 font-semibold text-[#243832] focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        본문으로 바로가기
      </a>

      <header className="sticky top-0 z-50 border-b border-[#243832]/10 bg-[#FBF8F2]/96 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-[1240px] items-center justify-between gap-5 px-5 sm:h-16 sm:px-8 lg:px-10">
          <Link
            href="/landing"
            className={`inline-flex min-h-11 items-center text-[20px] font-semibold tracking-[-0.02em] ${focusRing}`}
          >
            웨딩한방
          </Link>
          <nav className="flex items-center gap-2 sm:gap-5" aria-label="첫 준비 보조 메뉴">
            <Link
              href="/landing"
              className={`hidden min-h-11 items-center text-[13px] font-semibold text-[#4E6A62] transition-colors hover:text-[#8F6662] sm:inline-flex ${focusRing}`}
            >
              서비스 소개
            </Link>
            <Link
              href="/login"
              className={`inline-flex min-h-11 items-center rounded-full border border-[#243832]/16 px-4 text-[13px] font-semibold text-[#243832] transition-colors hover:border-[#8F6662] hover:text-[#8F6662] ${focusRing}`}
            >
              로그인
            </Link>
          </nav>
        </div>
      </header>

      <main id="start-here-main">
        <StartHereClient />
      </main>

      <footer className="border-t border-[#243832]/10 bg-white">
        <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-5 px-5 py-8 text-[12px] leading-6 text-[#4E6A62] sm:px-8 md:flex-row md:items-center md:justify-between lg:px-10">
          <p>
            © 2026 Wedding Hanbang · 문의{" "}
            <a
              href={`mailto:${CONTACT.email}`}
              className={`inline-flex min-h-11 items-center font-semibold underline decoration-[#243832]/20 underline-offset-4 hover:text-[#8F6662] ${focusRing}`}
            >
              {CONTACT.email}
            </a>
          </p>
          <nav className="flex flex-wrap gap-x-5 gap-y-1" aria-label="정책 메뉴">
            {[
              ["이용약관", "/terms"],
              ["개인정보처리방침", "/privacy"],
              ["AI 서비스 정책", "/ai-policy"],
            ].map(([label, href]) => (
              <Link
                key={href}
                href={href}
                className={`inline-flex min-h-11 min-w-11 items-center justify-center font-semibold underline decoration-[#243832]/20 underline-offset-4 hover:text-[#8F6662] ${focusRing}`}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
