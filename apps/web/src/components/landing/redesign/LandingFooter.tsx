import Link from "next/link";

import { landingContent } from "./landingContent";

/**
 * 첫 화면 아래의 조용한 바닥글.
 *
 * 2026-11-17 파운더 디자인 아티팩트(원문: 이 디자인 완전 같아야해)로 랜딩이 시작 화면 한 장이
 * 됐다. 아티팩트에 없는 것은 첫 화면에 얹지 않고, 법·신뢰 때문에 화면에 있어야 하는 문장만
 * 여기로 모았다 — 하지 않는 것 넷(AI 답변 고지 포함), 요금·가입 조건, 개인정보 고지,
 * 가격 출처, 정책 링크. 문장은 옛 섹션의 글자 그대로다(`landingContent.ts`).
 *
 * 링크는 **가입 없이 열리는 것 / 계정이 필요한 것 / 정책** 셋으로 나눈다. 처음 온 사람이
 * 링크를 눌렀다가 로그인 벽을 만나는 게 이 제품의 오래된 실패였다.
 *
 * 가격 출처 고지의 지역 편차 문장을 빼면 안 된다. 공시한 업체만 싣기 때문에 지역별로 수가
 * 크게 다르고, 그걸 안 적으면 사용자가 "우리 지역엔 없네" 를 우리 잘못으로 읽는다.
 *
 * 글자 색은 아티팩트의 작은 글자 색(#6B6570)이고 바탕(#FBFAF8)에서 5:1 을 넘는다.
 */
const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-focus-ring)] focus-visible:ring-offset-2";
const linkClassName = `inline-flex min-h-11 items-center text-[13px] leading-[1.6] text-inv-body underline-offset-4 transition-colors duration-200 hover:text-inv-ink hover:underline motion-reduce:transition-none ${focusRing}`;

export default function LandingFooter() {
  const { boundaries, notices, footer } = landingContent;

  return (
    <footer className="border-t border-inv-divider bg-inv-paper font-inv-sans text-inv-body">
      <div className="mx-auto w-full max-w-[960px] px-5 pb-10 pt-12 md:px-8 md:pb-14 md:pt-16">
        <section aria-labelledby="landing-boundaries-title">
          <h2
            id="landing-boundaries-title"
            className="m-0 font-inv-serif text-[19px] font-normal leading-[1.5] text-inv-ink"
          >
            {boundaries.title}
          </h2>
          <ul className="mt-5 grid gap-x-10 gap-y-4 md:grid-cols-2">
            {boundaries.items.map((item) => (
              <li key={item.title}>
                <p className="m-0 text-[14px] font-medium leading-[1.6] text-inv-ink">{item.title}</p>
                <p className="m-0 mt-1 text-[13px] leading-[1.7] text-inv-muted">{item.note}</p>
              </li>
            ))}
          </ul>
          <p className="m-0 mt-3">
            <Link href={boundaries.policyLink.href} className={linkClassName}>
              {boundaries.policyLink.label}
            </Link>
          </p>
        </section>

        <ul className="mt-8 grid gap-2 border-t border-inv-divider pt-6 text-[13px] leading-[1.7] text-inv-muted">
          <li>{notices.pricing}</li>
          <li>{notices.signup}</li>
          <li>{notices.privacy}</li>
        </ul>

        <div className="mt-8 grid gap-6 border-t border-inv-divider pt-6 md:grid-cols-[220px_minmax(0,1fr)] md:gap-x-10">
          <div>
            <p className="m-0 font-inv-serif text-[17px] leading-[1.5] text-inv-ink">웨딩한방</p>
            <p className="m-0 mt-1.5 text-[12px] leading-[1.7] text-inv-muted">{footer.tagline}</p>
          </div>
          <div className="grid gap-2">
            {footer.columns.map((column) => (
              <nav
                key={column.heading}
                aria-label={column.heading}
                className="flex flex-wrap items-center gap-x-5"
              >
                <p className="m-0 min-w-[84px] text-[12px] font-medium text-inv-ink">{column.heading}</p>
                <ul className="flex flex-wrap gap-x-5">
                  {column.links.map((item) => (
                    <li key={`${column.heading}-${item.href}`}>
                      <Link href={item.href} prefetch={false} className={linkClassName}>
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            ))}
          </div>
        </div>

        <p className="m-0 mt-8 border-t border-inv-divider pt-5 text-[12px] leading-[1.8] text-inv-muted">
          {footer.notice}
        </p>
        <p className="m-0 mt-3 text-[12px] text-inv-muted">{footer.copyright}</p>
      </div>
    </footer>
  );
}
