import type { Metadata } from "next";
import Link from "next/link";

// 없는 주소로 들어와도 막다른 길이 되지 않게 — 다음 갈 곳을 바로 준다.
export const metadata: Metadata = {
  title: "페이지를 찾을 수 없어요 | 웨딩한방",
  robots: { index: false, follow: false },
};

const NEXT_STEPS = [
  { href: "/price", label: "공시 가격 보기", desc: "업체가 공개한 기본가와 추가금" },
  { href: "/wedding/community/quote-check", label: "견적서 확인하기", desc: "빠진 항목 3분 점검 · 로그인 없이" },
  { href: "/wedding", label: "커뮤니티 둘러보기", desc: "먼저 준비한 사람들의 기록" },
];

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--hb-surface-page)] px-5 py-16 text-[var(--hb-text-strong)]">
      <div className="w-full max-w-md">
        <p className="text-sm font-bold text-[#8F6662]">404</p>
        <h1 className="mt-2 text-2xl font-bold tracking-normal">찾으시는 페이지가 없어요</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--hb-text-strong)]/70">
          주소가 바뀌었거나 삭제된 페이지일 수 있어요. 아래에서 이어서 준비해 보세요.
        </p>
        <ul className="mt-6 space-y-2">
          {NEXT_STEPS.map((step) => (
            <li key={step.href}>
              <Link
                href={step.href}
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
