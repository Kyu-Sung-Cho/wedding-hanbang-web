import { hasWebSignupConsentAccess } from "@/lib/auth/signupConsentAccess";
import { Suspense } from "react";
import Link from "next/link";
import { Mail, ShieldCheck } from "lucide-react";
import ConsentReturnGate from "@/components/auth/ConsentReturnGate";
import CommunityNav from "@/components/community/CommunityNav";
import CommunityAuthInitializer from "@/components/community/CommunityAuthInitializer";
import CommunityAmoraLauncher from "@/components/community/CommunityAmoraLauncher";
import { ToastContainer } from "@/components/community/Toast";
import Logo from "@/components/ui/Logo";
import { CONTACT } from "@/lib/constants/contact";
import { isWeddingCourtEnabled } from "@/lib/features/weddingLaunchFlags";
import { WEDDING_BASE_PATH, weddingLinkProps, weddingPath } from "@/lib/weddingPaths";
import { createClient } from "@/lib/supabase/server";

/**
 * 로그인한 사람인지 **요청마다** 봐야 하므로 정적으로 미리 만들 수 없다.
 *
 * 이 선언이 없으면 Next 가 이 라우트를 프리렌더하려 든다. 그때
 * `createClient()` 안의 `cookies()` 가 "이 라우트는 동적" 신호를 던지는데,
 * 그 함수의 `catch {}` 가 그것을 삼키고 익명 클라이언트로 넘어간다
 * (`lib/supabase/server.ts`). Supabase 환경변수가 있는 곳(운영·로컬)에서는
 * 조용히 통과하지만 **없는 곳(Vercel Preview)에서는 빌드가 통째로 죽는다.**
 *
 *     Error occurred prerendering page "/community/budget"
 *     Error: Your project's URL and Key are required to create a Supabase client!
 *
 * 2026-08-28 13:13 부터 프리뷰가 전부 이렇게 실패했고, 운영은 값이 있어서
 * 멀쩡해 보였다. 같은 그룹의 `community/page.tsx` 와 `post/[id]/page.tsx` 는
 * 이미 이 선언을 갖고 있다.
 */
export const dynamic = "force-dynamic";

export default async function CommunityLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // 동의 관문은 `(app)` 그룹에만 있었다. 커뮤니티는 그 밖이라, 동의 기록이 없는
  // 계정이 주소만 치고 들어와 **글을 쓸 수 있었다** — 서버도 막지 않는다
  // (동의를 요구하는 API 는 `/api/onboarding` 하나뿐이다).
  //
  // 해당 인구가 좁지 않다. 동의 수집은 2026-08-22 에 들어왔고
  // (`SIGNUP_CONSENT_INTRODUCED_AT`), 그 전에 만들어진 계정은 **전부** 기록이
  // 없다. 새로 로그인하면 `postAuthLanding` 이 잡지만, 이미 세션을 들고 있는
  // 사람은 그 길을 지나지 않는다.
  //
  // ⚠️ **비로그인은 절대 막지 않는다.** 커뮤니티 읽기는 로그인 없이 열려 있고,
  // 이 저장소에는 로그아웃일 때 늘 나는 `getUser()` 오류를 "확인 실패"로 읽어
  // 커뮤니티 세 곳이 비로그인을 차단한 이력이 있다. 그래서 오류를 보지 않고
  // **사람이 확실히 있을 때만** 판단한다 — 오류도 로그아웃도 `user` 가 `null`
  // 이라 그대로 통과한다. `AuthenticatedAppShell` 과 같은 모양이다.
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user && !hasWebSignupConsentAccess(user)) {
    // layout은 원래 주소를 알 수 없다. 브라우저에서 복귀 주소만 읽되,
    // 동의 전에는 커뮤니티 내용이나 초기화 컴포넌트를 렌더하지 않는다.
    return <ConsentReturnGate />;
  }

  const weddingCourtEnabled = isWeddingCourtEnabled();

  return (
    <div className="hanbang-community-theme flex min-h-screen flex-col bg-[var(--hb-surface-page)]">
      <CommunityAuthInitializer />
      <Suspense fallback={<div className="h-[76px] bg-[var(--hb-surface-page)]" />}>
        <CommunityNav weddingCourtEnabled={weddingCourtEnabled} />
      </Suspense>
      <ToastContainer />

      <main className="flex-1">{children}</main>

      <CommunityFooter />
      <CommunityAmoraLauncher />
    </div>
  );
}

function FooterBrand() {
  return (
    <Link {...weddingLinkProps()} className="inline-flex items-center whitespace-nowrap" aria-label="웨딩한방 홈으로 이동">
      <Logo size="md" variant="white" />
    </Link>
  );
}

function CommunityFooter() {
  return (
    <footer className="bg-[var(--hb-primary)] text-white">
      <div className="mx-auto grid w-full max-w-[1320px] gap-9 px-4 py-8 sm:px-6 md:grid-cols-[1.2fr_0.78fr_0.78fr_0.86fr_0.9fr_1.35fr] lg:px-8">
        <div>
          <FooterBrand />
          <p className="mt-3 text-[13px] font-medium text-white">
            결혼 준비, 아모라와 처음부터 끝까지.
          </p>
          {/* Instagram·YouTube·Kakao 아이콘은 제거했다. 계정이 없는데 아이콘만 있었고
              셋 다 /wedding으로 돌아왔다 — 있는 척하는 링크는 신뢰를 깎는다.
              실제 계정이 생기면 그때 실제 주소로 다시 넣는다. */}
        </div>

        <FooterColumn
          title="둘러보기"
          items={[
            { label: "후기·질문", href: weddingPath("/community#community-feed") },
            // "가격·후기"를 뺐다. `category=tour_review` 공개 글이 0건이라 구조적으로
            // 항상 빈 화면이었다(라이브 확인). 게다가 그 검색어가 아래 피드까지 덮어서,
            // "아래 최신 글은 계속 볼 수 있어요"라고 말한 뒤 아래도 비어 있었다.
            // 같은 파일 위쪽 주석의 원칙 그대로다: 있는 척하는 링크는 신뢰를 깎는다.
            // 커뮤니티 글은 바로 위 "후기·질문"이 이미 덮는다.
            { label: "동기방", href: weddingPath("/community/cohort") },
            { label: "글쓰기", href: weddingPath("/community/post/write") },
            { label: "북마크", href: weddingPath("/community/my/bookmarks") },
          ]}
        />
        <FooterColumn
          title="준비 도구"
          items={[
            { label: "웨딩 라운지", href: weddingPath("/lounge") },
            { label: "아모라 상담", href: weddingPath("/chat") },
            { label: "예산", href: weddingPath("/budget") },
            { label: "일정", href: weddingPath("/schedule") },
          ]}
        />
        <FooterColumn
          title="정책"
          items={[
            { label: "이용약관", href: "/terms" },
            { label: "개인정보처리방침", href: "/privacy" },
            { label: "AI 정책", href: "/ai-policy" },
          ]}
        />

        <div>
          <h3 className="mb-3 text-[14px] font-semibold text-white">연락</h3>
          <div className="space-y-1 text-[13px] font-medium text-white">
            <p>{CONTACT.email}</p>
            <p>{CONTACT.hours}</p>
            <p>({CONTACT.lunch})</p>
          </div>
        </div>

        <div className="rounded-[6px] border border-white/16 p-5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-white" />
            <h3 className="text-[14px] font-semibold text-white">안전한 AI 안내</h3>
          </div>
          <p className="text-[12px] font-medium leading-[1.7] text-white">
            개인정보와 AI 생성 안내를 투명하게 고지하고 안전한 결혼 준비를 돕습니다.
          </p>
          <Link
            {...weddingLinkProps("/lounge")}
            className="mt-4 inline-flex min-h-11 items-center rounded-[6px] border border-white/70 px-4 text-[12px] font-semibold text-white transition-colors hover:bg-[var(--hb-primary-hover)]"
          >
            웨딩 라운지로 이동
            <Mail className="ml-2 h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1320px] border-t border-white/10 px-4 py-4 text-center text-[12px] text-white sm:px-6 lg:px-8">
        © 2026 Wedding Hanbang. All rights reserved.
      </div>
    </footer>
  );
}

function FooterColumn({ title, items }: { title: string; items: Array<{ label: string; href: string }> }) {
  return (
    <div>
      <h3 className="mb-3 text-[14px] font-semibold text-white">{title}</h3>
      <div className="flex flex-col gap-2">
        {items.map((item) => {
          const linkProps = item.href === WEDDING_BASE_PATH || item.href.startsWith(`${WEDDING_BASE_PATH}/`)
            ? weddingLinkProps(item.href)
            : { href: item.href };

          return (
            <Link
              key={item.label}
              {...linkProps}
              className="inline-flex min-h-11 items-center text-[13px] font-medium text-white underline-offset-4 hover:underline"
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
