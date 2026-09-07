import Link from "next/link";

import { landingContent } from "./landingContent";
import { shell } from "./notebook";

/**
 * 푸터.
 *
 * 링크를 **로그인 없이 열리는 것 / 계정이 필요한 것 / 정책** 셋으로 나눈다. 처음 온 사람이
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
    // 2026-08-28: 정본 시안으로 되돌리면서 푸터 열이 카피 정본으로 옮겨졌다.
    // 목록을 여기서 손으로 적으면 카피와 갈린다.
    ...footer.columns.map((column) => ({ label: column.heading, items: column.links })),
  ];

  return (
    <footer className="border-t border-[var(--color-paper-edge)] bg-[var(--color-paper-sheet)] py-[38px]">
      <div className={shell}>
        <div className="grid gap-5 lg:grid-cols-[240px_1fr] lg:gap-x-12">
          <div className="lg:row-span-3">
            <p className="landing-display text-[19px] text-[var(--color-paper-ink)]">웨딩한방</p>
            <p className="mt-2 text-[12px] leading-[1.75] text-[var(--color-paper-ink-faint)]">
              {footer.tagline}
            </p>
          </div>

          {groups.map((group) => (
            <nav key={group.label} aria-label={group.label} className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <p className="min-w-[80px] text-[12px] font-bold text-[var(--color-paper-ink-faint)]">
                {group.label}
              </p>
              <ul className="flex flex-wrap gap-x-5">
                {group.items.map((item) => (
                  <li key={`${group.label}-${item.href}-${item.label}`}>
                    <Link
                      href={item.href}
                      className="inline-flex min-h-11 items-center text-[12px] leading-[1.6] text-[var(--color-paper-ink-soft)] transition-colors duration-200 hover:text-[var(--color-paper-pen)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <p className="mt-7 border-t border-[var(--color-paper-divider)] pt-5 text-[12px] leading-[1.85] text-[var(--color-paper-ink-faint)]">
          {footer.notice}
        </p>
        <p className="mt-4 text-[12px] text-[var(--color-paper-ink-faint)]">{footer.copyright}</p>
      </div>
    </footer>
  );
}
