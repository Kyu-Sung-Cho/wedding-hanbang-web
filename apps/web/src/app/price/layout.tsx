import Link from "next/link";

import Logo from "@/components/ui/Logo";
import { CONTACT } from "@/lib/constants/contact";
import { weddingLinkProps } from "@/lib/weddingPaths";

// 공시 가격 표면은 검색 유입이 가장 많은 입구인데도 루트 레이아웃만 써서
// 로고·이동 경로·정책 링크가 하나도 없었다(2026-07-25 모바일 실측). 이미 무거운
// 페이지라 커뮤니티 레이아웃을 통째로 얹지 않고, 클라이언트 JS가 0인
// 서버 전용 헤더·푸터만 둔다.

const HEADER_LINKS = [
  { href: "/start-here", label: "지금 뭐부터?" },
  { href: "/wedding/manners", label: "결혼 예절" },
  { href: "/wedding/etiquette", label: "예절 25편" },
  { href: "/price", label: "공시 가격" },
  { href: "/demo", label: "아모라 체험" },
] as const;

const POLICY_LINKS = [
  { href: "/terms", label: "이용약관" },
  { href: "/privacy", label: "개인정보처리방침" },
  { href: "/ai-policy", label: "AI 정책" },
] as const;

export default function PriceLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[#fffdf8]">
      <header className="border-b border-[#243832]/10 bg-[#fffdf8]">
        <div className="mx-auto flex w-full max-w-[1320px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6 lg:px-8">
          <Link
            {...weddingLinkProps()}
            prefetch={false}
            className="inline-flex shrink-0 items-center"
            aria-label="웨딩한방 홈으로 이동"
          >
            <Logo size="sm" />
          </Link>
          <nav aria-label="주요 메뉴" className="flex items-center gap-4 text-[13px] font-semibold text-[#243832] sm:gap-5 sm:text-sm">
            {HEADER_LINKS.map((link) => (
              <Link key={link.href} href={link.href} prefetch={false} className="hover:text-[#8F5150]">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="mt-12 bg-[linear-gradient(135deg,#183832_0%,#2f5f55_58%,#12302b_100%)] text-white">
        <div className="mx-auto grid w-full max-w-[1320px] gap-8 px-4 py-9 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
          <div className="sm:col-span-2 lg:col-span-1">
            <Link {...weddingLinkProps()} prefetch={false} className="inline-flex items-center" aria-label="웨딩한방 홈으로 이동">
              <Logo size="sm" variant="white" />
            </Link>
            <p className="mt-3 text-[13px] font-medium leading-6 text-white/70">
              결혼 준비, 아모라와 처음부터 끝까지.
            </p>
          </div>

          <div>
            <h2 className="mb-3 text-[14px] font-semibold text-white">둘러보기</h2>
            <div className="flex flex-col gap-2">
              {HEADER_LINKS.map((link) => (
                <Link key={link.href} href={link.href} prefetch={false} className="text-[13px] font-medium text-white/65 hover:text-[#f2e8c8]">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-[14px] font-semibold text-white">정책</h2>
            <div className="flex flex-col gap-2">
              {POLICY_LINKS.map((link) => (
                <Link key={link.href} href={link.href} prefetch={false} className="text-[13px] font-medium text-white/65 hover:text-[#f2e8c8]">
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-[14px] font-semibold text-white">연락</h2>
            <div className="space-y-1 text-[13px] font-medium text-white/70">
              <p>{CONTACT.email}</p>
              <p>{CONTACT.hours}</p>
              <p>({CONTACT.lunch})</p>
            </div>
          </div>
        </div>
        <div className="mx-auto w-full max-w-[1320px] border-t border-white/10 px-4 py-4 text-[12px] leading-6 text-white/55 sm:px-6 lg:px-8">
          <p>
            가격 출처: 한국소비자원 참가격 공시 자료. 공시 기준이라 계약 시점·조건에 따라 실제 금액이 달라질 수 있으니 계약 전 업체에 직접 확인하세요.
          </p>
          <p className="mt-2">© 2026 Wedding Hanbang. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
