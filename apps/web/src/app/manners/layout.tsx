import Link from "next/link";

import Logo from "@/components/ui/Logo";
import { weddingLinkProps } from "@/lib/weddingPaths";

// `/price`와 같은 이유로 루트 레이아웃만 쓰지 않는다 — 검색 유입이 들어오는 공개
// 표면인데 로고·이동 경로·정책 링크가 없으면 사용자가 여기서 막힌다.
// 클라이언트 JS는 0으로 둔다. 읽는 화면이라 상호작용이 필요 없다.

const HEADER_LINKS = [
  { href: "/start-here", label: "지금 뭐부터?" },
  { href: "/wedding/manners", label: "결혼 예절" },
  { href: "/price", label: "공시 가격" },
  { href: "/demo", label: "아모라 소개" },
] as const;

const POLICY_LINKS = [
  { href: "/terms", label: "이용약관" },
  { href: "/privacy", label: "개인정보처리방침" },
  { href: "/ai-policy", label: "AI 정책" },
] as const;

export default function MannersLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[#fffdf8]">
      <header className="border-b border-[var(--hb-primary)]/10 bg-[#fffdf8]">
        <div className="mx-auto flex w-full max-w-[1320px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
          <Link
            {...weddingLinkProps()}
            prefetch={false}
            className="inline-flex shrink-0 items-center"
            aria-label="웨딩한방 홈으로 이동"
          >
            <Logo size="sm" />
          </Link>
          <nav
            aria-label="주요 메뉴"
            className="flex items-center gap-4 text-[13px] font-semibold text-[var(--hb-text-strong)] sm:gap-5 sm:text-sm"
          >
            {HEADER_LINKS.map((link) => (
              <Link key={link.href} href={link.href} prefetch={false} className="hover:text-[#8F5150]">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-[var(--hb-primary)]/10 bg-[#fffdf8]">
        <div className="mx-auto w-full max-w-[1320px] px-4 py-6 sm:px-6 lg:px-8">
          <p className="text-[13px] font-medium text-[var(--hb-text-strong)]/70">
            결혼 준비, 아모라와 처음부터 끝까지.
          </p>
          <nav aria-label="정책" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[var(--hb-text-muted)]">
            {POLICY_LINKS.map((link) => (
              <Link key={link.href} href={link.href} prefetch={false} className="hover:text-[#8F5150]">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
    </div>
  );
}
