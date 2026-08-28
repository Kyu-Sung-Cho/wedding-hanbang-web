import Link from "next/link";

import { footerLinks, landingContent } from "./landingContent";
import { shell } from "./notebook";

/**
 * 푸터.
 *
 * 링크를 **로그인 없이 열리는 것 / 계정 베타 / 정책** 셋으로 나눈다. 처음 온 사람이
 * 링크를 눌렀다가 로그인 벽을 만나는 게 이 제품의 오래된 실패였다.
 *
 * 가격 출처 고지는 여기 한 번만 둔다 — 공시 가격이 본문에서 곁블록으로 내려갔으니
 * 출처·기준일·한계도 같이 내려온다. 지역 편차 문장을 빼면 안 된다.
 * 공시한 업체만 싣기 때문에 지역별로 수가 크게 다르고, 그걸 안 적으면
 * 사용자가 "우리 지역엔 없네" 를 우리 잘못으로 읽는다.
 */
export default function LandingFooter() {
  const { footer } = landingContent;

  const groups = [
    { label: "로그인 없이", items: footerLinks.open },
    { label: "계정 베타", items: footerLinks.beta },
    { label: "정책·문의", items: footerLinks.policy },
  ];

  return (
    <footer className="border-t border-[var(--color-paper-edge)] bg-[var(--color-paper-card)] py-14">
      <div className={shell}>
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.1fr)_repeat(3,minmax(0,1fr))]">
          <div>
            <p className="landing-hand text-[24px] text-[var(--color-paper-ink)]">웨딩한방</p>
            <p className="mt-3 max-w-[24ch] text-[14px] leading-[1.75] text-[var(--color-paper-ink-faint)]">
              {footer.tagline}
            </p>
          </div>

          {groups.map((group) => (
            <nav key={group.label} aria-label={group.label}>
              <p className="text-[12px] font-bold tracking-[0.04em] text-[var(--color-paper-ink-faint)]">
                {group.label}
              </p>
              <ul className="mt-4 space-y-1">
                {group.items.map((item) => (
                  <li key={`${group.label}-${item.href}-${item.label}`}>
                    <Link
                      href={item.href}
                      className="inline-flex min-h-10 items-center text-[14px] leading-[1.6] text-[var(--color-paper-ink-soft)] transition-colors duration-200 hover:text-[var(--color-paper-pen)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <p className="mt-12 border-t border-[var(--color-paper-divider)] pt-6 text-[12px] leading-[1.85] text-[var(--color-paper-ink-faint)]">
          {footer.notice}
        </p>
        <p className="mt-4 text-[12px] text-[var(--color-paper-ink-faint)]">{footer.copyright}</p>
      </div>
    </footer>
  );
}
