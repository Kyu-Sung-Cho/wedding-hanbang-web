import Link from "next/link";

import { BookOpen, CalendarCheck, ClipboardCheck, LayoutDashboard, Settings, Users, Wallet } from "lucide-react";
import AmoraMark from "@/components/ui/AmoraMark";
import { LogoMark } from "@/components/ui/Logo";
import { weddingLinkProps } from "@/lib/weddingPaths";
import AmoraBottomNav from "@/components/app/amora/AmoraBottomNav";
import HiddenInsideMobileApp from "@/components/common/HiddenInsideMobileApp";

// 공개 읽기 화면은 인증 상태를 요청하거나 사용자·일정·알림을 가정하지 않는다.
const SERVICE_LINKS = [
  { href: "/lounge", label: "웨딩 라운지", icon: LayoutDashboard },
  { href: "/chat", label: "아모라", icon: AmoraMark },
  { href: "/checklist", label: "웨딩 체크리스트", icon: ClipboardCheck },
  { href: "/schedule", label: "일정", icon: CalendarCheck },
  { href: "/budget", label: "예산", icon: Wallet },
  { href: "/community", label: "커뮤니티", icon: Users },
  { href: "/manners", label: "예절 가이드", icon: BookOpen },
  { href: "/settings", label: "설정", icon: Settings },
] as const;

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
    <div className="planning-workspace min-h-screen bg-[var(--amora-bg)] text-[var(--amora-soft)] [&_a:focus-visible]:outline-2 [&_a:focus-visible]:outline-offset-2 [&_a:focus-visible]:outline-[var(--hb-focus-ring)]">
      <a href="#manners-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[10px] focus:bg-white focus:p-3">본문으로 바로가기</a>
      <aside className="fixed inset-y-0 left-0 hidden w-[220px] flex-col border-r border-[var(--amora-line)] bg-white pt-[22px] md:flex">
        {/* 앱 사이드바(`components/app/Sidebar.tsx`)와 같은 머리 — 로고는 라운지로 간다. */}
        <Link {...weddingLinkProps("/lounge")} prefetch={false} aria-label="웨딩한방 홈으로 이동" className="planning-display mx-6 flex min-h-[54px] items-start pt-[6px] text-[17px] text-[var(--amora-ink)]">
          <span className="flex items-center gap-2"><LogoMark />웨딩한방</span>
        </Link>
        <nav aria-label="서비스 메뉴" className="flex-1 overflow-y-auto px-[14px]">
          <ul className="space-y-1">
            {SERVICE_LINKS.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <Link {...weddingLinkProps(href)} prefetch={false} aria-current={href === "/manners" ? "location" : undefined} className={`flex min-h-11 items-center gap-[11px] rounded-[9px] px-3 py-2.5 text-[14.5px] ${href === "/manners" ? "bg-[var(--amora-selected-bg)] font-semibold text-[var(--amora-selected-text)]" : "hover:bg-[var(--amora-warm)]"}`}>
                  <Icon aria-hidden className="size-4 shrink-0" />{label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mx-5 mb-6 border-t border-[var(--amora-line)] pt-4 text-[12px] leading-[1.7] text-[var(--amora-muted)]">
          <p>지역·집안마다 다른 관행을<br />출처와 함께 읽는 안내예요.</p>
          <Link href="/start-here" prefetch={false} className="mt-1 inline-flex min-h-11 items-center font-medium text-[var(--amora-accent)]">처음 오셨나요?</Link>
        </div>
      </aside>
      <div className="flex min-h-screen min-w-0 flex-col md:ml-[220px]">
      <main id="manners-main" className="min-w-0 flex-1">{children}</main>

      {/*
        앱 웹뷰에서는 바닥글과 아래 메뉴를 내린다. 아래 메뉴 다섯은 전부 로그인 필요 경로라
        앱 웹뷰(세션 없음)에서는 웹 로그인 화면이 되고, 앱의 아래 탭과 두 겹으로 쌓였다.
        브라우저에서는 그대로다.
      */}
      <HiddenInsideMobileApp>
      <footer className="border-t border-[var(--amora-line)] pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-0">
        <div className="mx-auto w-full max-w-[1220px] px-[18px] py-6 md:px-9 xl:px-16">
          <p className="text-[13px] font-medium text-[var(--amora-muted)]">
            결혼 준비, 아모라와 처음부터 끝까지.
          </p>
          <nav aria-label="공개 안내" className="mt-2 flex flex-wrap gap-x-5 text-[12.5px] text-[var(--amora-accent)]">
            {HEADER_LINKS.map(link => <Link key={link.href} href={link.href} prefetch={false} className="inline-flex min-h-11 items-center">{link.label}</Link>)}
          </nav>
          <nav aria-label="정책" className="flex flex-wrap gap-x-4 text-[12px] text-[var(--amora-muted)]">
            {POLICY_LINKS.map((link) => (
              <Link key={link.href} href={link.href} prefetch={false} className="inline-flex min-h-11 items-center">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </footer>
      </HiddenInsideMobileApp>
      </div>
      <HiddenInsideMobileApp>
        <AmoraBottomNav active={null} />
      </HiddenInsideMobileApp>
    </div>
  );
}
