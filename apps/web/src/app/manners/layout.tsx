import Link from "next/link";

import { LayoutDashboard } from "lucide-react";
import AmoraMark from "@/components/ui/AmoraMark";
import { LogoMark } from "@/components/ui/Logo";
import AmoraBottomNav from "@/components/app/amora/AmoraBottomNav";
import {
  SIDEBAR_ITEM_CLASS,
  SIDEBAR_ITEM_IDLE_CLASS,
  SIDEBAR_LIST_CLASS,
  SIDEBAR_WIDTH_CLASS,
} from "@/components/app/sidebarStyles";
import HiddenInsideMobileApp from "@/components/common/HiddenInsideMobileApp";
import FullPageLinkInsideMobileApp from "@/components/common/FullPageLinkInsideMobileApp";
import MannersChrome from "@/components/manners/MannersChrome";

// 이 서버 레이아웃과 아래 공개 사이드바는 인증 상태를 요청하지 않고 사용자·일정·알림을
// 가정하지 않는다. 로그인 세션 쿠키가 있는 브라우저에서만 `MannersChrome` 이 hydration 뒤에
// `/api/auth/me` 로 로그인 여부를 확인하고, 로그인한 사람에게 앱 사이드바·상단 바를 얹는다.
// 쿠키가 없는 방문자에게는 요청이 없다.
//
// 앱 사이드바와 같은 메뉴다(2026-11-13 파운더 결정: 메인은 웨딩 라운지와 아모라 둘). 예절 가이드도
// 메뉴에서 빠지고 라운지와 아모라가 연다. 로그인 전 방문자에게 로그인 뒤 화면과 다른 메뉴를 보이면
// 로그인하는 순간 메뉴가 바뀌어 보인다. 설정은 로그인한 사람의 사용자 자리에만 있다.
const SERVICE_LINKS = [
  { href: "/lounge", label: "웨딩 라운지", icon: LayoutDashboard },
  { href: "/chat", label: "아모라", icon: AmoraMark },
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
      {/* 로그인한 사람의 사이드바(z-50)가 이 링크 자리를 덮으므로 그보다 위(z-100)에서 보인다. */}
      <a href="#manners-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-[10px] focus:bg-white focus:p-3">본문으로 바로가기</a>
      <MannersChrome publicAside={
      <aside className={`fixed inset-y-0 left-0 hidden ${SIDEBAR_WIDTH_CLASS} flex-col border-r border-[var(--amora-line)] bg-white pt-[22px] md:flex`}>
        {/*
          앱 사이드바(`components/app/Sidebar.tsx`)와 같은 머리 — 로고는 라운지로 간다.
          항목의 크기·굵기·간격은 앱 사이드바와 같은 값(`sidebarStyles.ts`)을 쓴다.
          넓은 안드로이드 기기의 앱 웹뷰에서도 보이는 자리라, 로고와 메뉴는 앱 웹뷰에서 문서째
          옮긴다. 그래야 앱이 받아 라운지 탭·체크리스트 같은 네이티브 화면으로 넘긴다
          (`FullPageLinkInsideMobileApp`). 예절 가이드 공개 항목도 같이 쓴다 —
          앱 웹뷰에서 그 화면을 한 번 새로 읽을 뿐이다.
        */}
        <FullPageLinkInsideMobileApp path="/lounge" aria-label="웨딩한방 홈으로 이동" className="planning-display mx-6 flex min-h-[54px] items-start pt-[6px] text-[17px] text-[var(--amora-ink)]">
          <span className="flex items-center gap-2"><LogoMark />웨딩한방</span>
        </FullPageLinkInsideMobileApp>
        <nav aria-label="서비스 메뉴" className="flex-1 overflow-y-auto px-[14px]">
          <ul className={SIDEBAR_LIST_CLASS}>
            {SERVICE_LINKS.map(({ href, label, icon: Icon }) => (
              <li key={href}>
                <FullPageLinkInsideMobileApp path={href} className={`${SIDEBAR_ITEM_CLASS} ${SIDEBAR_ITEM_IDLE_CLASS}`}>
                  <Icon aria-hidden className="size-4 shrink-0" />{label}
                </FullPageLinkInsideMobileApp>
              </li>
            ))}
          </ul>
        </nav>
        <div className="mx-5 mb-6 border-t border-[var(--amora-line)] pt-4 text-[12px] leading-[1.7] text-[var(--amora-muted)]">
          <p>지역·집안마다 다른 관행을<br />출처와 함께 읽는 안내예요.</p>
          <Link href="/start-here" prefetch={false} className="mt-1 inline-flex min-h-11 items-center font-medium text-[var(--amora-accent)]">처음 오셨나요?</Link>
        </div>
      </aside>
      }>
      <main id="manners-main" className="min-w-0 flex-1">{children}</main>

      {/*
        앱 웹뷰에서는 바닥글과 아래 메뉴를 내린다. 아래 메뉴 둘은 전부 로그인 필요 경로라
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
      </MannersChrome>
      <HiddenInsideMobileApp>
        <AmoraBottomNav active={null} />
      </HiddenInsideMobileApp>
    </div>
  );
}
