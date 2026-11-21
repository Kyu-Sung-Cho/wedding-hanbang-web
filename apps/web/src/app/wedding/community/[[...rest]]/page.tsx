import type { Metadata } from "next";
import Link from "next/link";

import { CONTACT } from "@/lib/constants/contact";

/**
 * 커뮤니티 '닫았어요' 화면.
 *
 * 2026-11-16 파운더 결정(D-81)으로 커뮤니티를 닫는다. 2026-11-21 에 웹 스위치
 * (`COMMUNITY_RUNTIME_MODE=disabled`)로 새 글·댓글과 로그인한 사람의 글 보기를 막았고,
 * 이 화면이 남은 틈(로그아웃 방문자의 피드와 글 화면)을 닫는다.
 *
 * - `/wedding/community` 아래 모든 주소를 받는다. 옛 `/community/**` 는 `next.config.ts` 가
 *   여기로 보낸다. 견적 확인과 옛 앱 화면 셋(아모라·예산·일정)은 그보다 먼저 다른 곳으로 간다.
 * - **글 본문을 그리지 않는다.** 서버에서 글을 읽지도 않는다. 글 본문 정화기의 구멍(밑줄 태그)이
 *   남아 있어도 이 화면에서는 닿지 않는다.
 * - 검색에서 빠지게 한다. 글 주소가 검색 결과에 남아 있어도 이 화면만 보인다.
 */
export const metadata: Metadata = {
  title: "커뮤니티를 닫았어요 | 웨딩한방",
  robots: { index: false, follow: false },
};

const NEXT_STEPS = [
  { href: "/wedding/chat", label: "아모라에게 물어보기", desc: "결혼 준비 고민을 함께 정리해요" },
  { href: "/wedding/quote-check", label: "견적서 확인하기", desc: "로그인 없이 빠진 항목을 점검해요" },
  { href: "/start-here", label: "지금 뭐부터 할지 보기", desc: "날짜가 없어도 첫 순서를 알려 드려요" },
] as const;

export default function CommunityClosedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--hb-surface-page)] px-5 py-16 text-[var(--hb-text-strong)]">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-bold tracking-normal">커뮤니티를 닫았어요</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--hb-text-strong)]/70">
          새 글과 댓글은 더 받지 않고, 올라온 글도 이제 볼 수 없어요.
        </p>
        <p className="mt-2 text-sm leading-6 text-[var(--hb-text-strong)]/70">
          남기신 글이나 사진에 대해 물어볼 게 있으면{" "}
          <a
            href={`mailto:${CONTACT.email}`}
            className="font-semibold text-[var(--hb-text-strong)] underline underline-offset-4"
          >
            {CONTACT.email}
          </a>
          로 메일 주세요.
        </p>
        <ul className="mt-6 space-y-2">
          {NEXT_STEPS.map((step) => (
            <li key={step.href}>
              <Link
                href={step.href}
                prefetch={false}
                className="block rounded-[6px] border border-[var(--color-paper-outline)] bg-white px-5 py-4 transition-colors hover:border-[var(--hb-primary)]/45 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#B89785]"
              >
                <span className="block text-sm font-bold text-[var(--hb-text-strong)]">{step.label}</span>
                <span className="mt-1 block text-sm leading-6 text-[var(--hb-text-muted)]">{step.desc}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
