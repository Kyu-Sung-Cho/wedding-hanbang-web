import type { Metadata } from "next";
import Link from "next/link";

import ConsentReturnGate from "@/components/auth/ConsentReturnGate";
import HiddenInsideMobileApp from "@/components/common/HiddenInsideMobileApp";
import Logo from "@/components/ui/Logo";
import { hasWebSignupConsentAccess } from "@/lib/auth/signupConsentAccess";
import { CONTACT } from "@/lib/constants/contact";
import { isPreviewStubMode } from "@/lib/previewStub";
import { createClient } from "@/lib/supabase/server";

// 클라이언트 페이지라 여기(서버 레이아웃)에서 메타데이터 제공 — 검색 결과·링크 미리보기용
export const metadata: Metadata = {
  title: "웨딩 견적 확인 질문 체크리스트 | 웨딩한방",
  description:
    "사용자가 고른 항목 상태를 바탕으로 견적서에서 다시 확인할 내용과 계약 전 업체에 물어볼 질문을 정리합니다. 가격 적정성이나 법적 판단을 대신하지 않습니다.",
  alternates: { canonical: "/wedding/quote-check" },
  openGraph: {
    title: "웨딩 견적 확인 질문 체크리스트",
    description: "포함 여부 확인 항목과 계약 전 질문을 정리하는 체크리스트.",
    url: "/wedding/quote-check",
    siteName: "웨딩한방",
    locale: "ko_KR",
    type: "website",
    images: [{ url: "/images/og-image.png", width: 1200, height: 630, alt: "웨딩한방 견적 체크리스트" }],
  },
};

/**
 * 로그인한 사람이 가입 동의를 마쳤는지 **요청마다** 봐야 하므로 미리 만들 수 없다.
 *
 * 2026-11-22 커뮤니티를 닫으면서 이 도구를 `(community)` 묶음에서 옮겼다. 동의 관문은
 * 그 묶음의 레이아웃(`app/(community)/layout.tsx`)에만 있었으니 같은 관문을 여기에 그대로 둔다.
 * 동의 기록이 없는 계정(2026-08-22 동의 수집 전에 만든 계정 전부)이 주소만 치고 들어와
 * 도구를 쓰지 않게 하려는 것이다.
 */
export const dynamic = "force-dynamic";

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

/**
 * ⚠️ **비로그인은 막지 않는다.** 이 도구는 로그인 없이 쓰는 공개 도구다. 로그아웃이면
 * `getUser()` 가 늘 "세션 없음" 오류를 내는데, 그 오류를 "확인 실패"로 읽어 비로그인을 막은
 * 이력이 있다. 그래서 오류를 보지 않고 **사람이 확실히 있을 때만** 판단한다 — 오류도
 * 로그아웃도 `user` 가 `null` 이라 그대로 통과한다. `(community)/layout.tsx` 와 같은 모양이다.
 *
 * 미리보기 배포는 Supabase 값이 없게 설계돼 있어서(`NEXT_PUBLIC_PREVIEW_STUB_MODE`) 거기서
 * 클라이언트를 만들면 요청마다 500 이 난다. 그때는 관문을 건너뛴다(이 저장소의 기존 방식).
 */
async function needsSignupConsent(): Promise<boolean> {
  if (isPreviewStubMode()) return false;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return Boolean(user && !hasWebSignupConsentAccess(user));
}

export default async function QuoteCheckLayout({ children }: { children: React.ReactNode }) {
  if (await needsSignupConsent()) {
    // layout은 원래 주소를 알 수 없다. 브라우저에서 복귀 주소만 읽되,
    // 동의 전에는 도구 화면을 렌더하지 않는다.
    return <ConsentReturnGate />;
  }

  return (
    <div className="flex min-h-screen flex-col bg-[var(--hb-surface-page)]">
      {/*
        앱 웹뷰에서는 공개 머리·바닥글을 내린다. 앱 머리가 이미 있고, 여기 링크는 앱 사용자에게
        필요 없는 공개 안내다. 브라우저에서는 그대로다(`app/price/layout.tsx` 와 같은 방식).
      */}
      <HiddenInsideMobileApp>
        <header className="border-b border-[var(--hb-primary)]/10 bg-[var(--hb-surface-page)]">
          <div className="mx-auto flex w-full max-w-[1240px] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
            {/* `/wedding` 은 로그인했으면 라운지, 아니면 랜딩으로 보낸다. */}
            <Link
              href="/wedding"
              prefetch={false}
              className="inline-flex shrink-0 items-center"
              aria-label="웨딩한방 홈으로 이동"
            >
              <Logo size="sm" />
            </Link>
            <nav aria-label="주요 메뉴" className="flex items-center gap-4 text-[13px] font-semibold text-[var(--hb-text-strong)] sm:gap-5 sm:text-sm">
              {HEADER_LINKS.map((link) => (
                <Link key={link.href} href={link.href} prefetch={false} className="hover:text-[#8F5150]">
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
      </HiddenInsideMobileApp>

      <main className="flex-1">{children}</main>

      <HiddenInsideMobileApp>
        <footer className="mt-12 bg-[var(--hb-primary)] text-white">
          <div className="mx-auto grid w-full max-w-[1240px] gap-8 px-4 py-9 sm:grid-cols-3 sm:px-6">
            <div>
              <Link href="/wedding" prefetch={false} className="inline-flex items-center" aria-label="웨딩한방 홈으로 이동">
                <Logo size="sm" variant="white" />
              </Link>
              <p className="mt-3 text-[13px] font-medium leading-6 text-[var(--hb-on-primary)]">
                결혼 준비, 아모라와 처음부터 끝까지.
              </p>
            </div>

            <div>
              <h2 className="mb-3 text-[14px] font-semibold text-white">정책</h2>
              <div className="flex flex-col gap-2">
                {POLICY_LINKS.map((link) => (
                  <Link key={link.href} href={link.href} prefetch={false} className="text-[13px] font-medium text-[var(--hb-on-primary)] underline-offset-4 hover:underline">
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>

            <div>
              <h2 className="mb-3 text-[14px] font-semibold text-white">연락</h2>
              <div className="space-y-1 text-[13px] font-medium text-[var(--hb-on-primary)]">
                <p>{CONTACT.email}</p>
                <p>{CONTACT.hours}</p>
                <p>({CONTACT.lunch})</p>
              </div>
            </div>
          </div>
          <div className="mx-auto w-full max-w-[1240px] border-t border-white/10 px-4 py-4 text-[12px] leading-6 text-[var(--hb-on-primary)] sm:px-6">
            <p>© 2026 Wedding Hanbang. All rights reserved.</p>
          </div>
        </footer>
      </HiddenInsideMobileApp>
    </div>
  );
}
