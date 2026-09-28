import Link from "next/link";
import type { ReactNode } from "react";

export const providerFocus = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2";
export const providerInput = `min-h-11 w-full rounded-[6px] border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)] px-3 py-2.5 text-sm text-[var(--hb-text-strong)] disabled:opacity-60 ${providerFocus}`;
export const providerPanel = "rounded-lg border border-[var(--hb-hairline)] bg-[var(--hb-surface-raised)] p-5 sm:p-6";
export const providerLabel = "mb-2 block text-sm font-semibold text-[var(--hb-text-strong)]";

type ProviderShellProps = {
  children: ReactNode;
  active?: "business" | "discover" | "provider";
};

export default function ProviderShell({ children, active }: ProviderShellProps) {
  return (
    <div className="min-h-screen bg-[var(--hb-surface-page)] text-[var(--hb-text-body)]">
      <a href="#provider-content" className={`sr-only focus:not-sr-only focus:absolute focus:z-50 focus:bg-white focus:p-3 ${providerFocus}`}>본문으로 이동</a>
      <header className="border-b border-[var(--hb-hairline)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-5 gap-y-1 px-5 py-3 sm:px-8">
          <Link href="/landing" className={`inline-flex min-h-11 items-center text-lg font-semibold text-[var(--hb-text-strong)] ${providerFocus}`}>웨딩한방</Link>
          <nav aria-label="서비스·공간 메뉴" className="flex flex-wrap gap-x-4">
            {[
              { key: "discover", href: "/discover", label: "서비스·공간 찾기" },
              { key: "business", href: "/business", label: "함께하기" },
              { key: "provider", href: "/provider", label: "제공자 센터" },
            ].map((item) => (
              <Link key={item.key} href={item.href} prefetch={false} aria-current={active === item.key ? "page" : undefined} className={`inline-flex min-h-11 items-center border-b-2 text-[13px] ${active === item.key ? "border-[var(--hb-action)] font-semibold text-[var(--hb-text-strong)]" : "border-transparent text-[var(--hb-text-muted)]"} ${providerFocus}`}>{item.label}</Link>
            ))}
          </nav>
        </div>
      </header>
      <main id="provider-content" className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-12">{children}</main>
      <footer className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 border-t border-[var(--hb-hairline)] px-5 py-6 text-xs text-[var(--hb-text-muted)] sm:px-8">
        <span>웨딩한방</span>
        <Link href="/terms" className={`inline-flex min-h-11 items-center underline underline-offset-4 ${providerFocus}`}>이용약관</Link>
        <Link href="/privacy" className={`inline-flex min-h-11 items-center underline underline-offset-4 ${providerFocus}`}>개인정보 처리방침</Link>
        <Link href="/business/inquiry" prefetch={false} className={`inline-flex min-h-11 items-center underline underline-offset-4 ${providerFocus}`}>협업·비즈니스 문의</Link>
      </footer>
    </div>
  );
}

export function ProviderHeading({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="mb-7 border-b border-[var(--hb-hairline)] pb-6">
      {eyebrow ? <p className="mb-3 text-xs font-semibold tracking-[0.08em] text-[var(--hb-text-muted)]">{eyebrow}</p> : null}
      <h1 className="text-[25px] font-medium tracking-tight text-[var(--hb-text-strong)] sm:text-[28px]">{title}</h1>
      {children ? <div className="mt-3 max-w-3xl text-sm leading-7">{children}</div> : null}
    </header>
  );
}
