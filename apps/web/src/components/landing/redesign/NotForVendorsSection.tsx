import Link from "next/link";

import { landingContent, notDoing } from "./landingContent";
import { Section, bodyText, noteText } from "./notebook";

/**
 * ⑥ 업체 편이 아니다.
 *
 * ## 왜 "안 하는 것" 이 앞에 오나
 *
 * 이 제품이 코드에 투자한 곳이 거기다 — 안전 2,318줄 · 범위 판정 669줄 ·
 * 중재 제안 213줄 · 말투 계약 99줄. 도구 정의·실행기 2,538줄보다 많다.
 * 하지 않기로 한 것이 제품의 실체이므로 방어적 면책이 아니라 **신뢰 축**으로 쓴다.
 *
 * ## 공시 가격이 왜 여기 한 줄인가
 *
 * 한국소비자원 참가격은 **공개 자료**다. 누구나 볼 수 있고 우리가 옮겨 놓았을 뿐이라
 * 자산이 아니다. 여기서는 "우리가 업체 편이 아니라는 증거"로만 쓴다 —
 * 판정하지 않는다는 태도가 값이지 데이터가 값이 아니다.
 * 이전 랜딩은 이걸 첫 화면에 뒀고, 그건 우리가 못 이기는 축이다.
 */
export default function NotForVendorsSection() {
  const { notForVendors } = landingContent;

  return (
    <Section id="trust" eyebrow={notForVendors.eyebrow} title={notForVendors.title}>
      <p className={`mt-7 max-w-[54ch] ${bodyText}`}>{notForVendors.body}</p>

      <ul className="mt-8 divide-y divide-[var(--color-paper-divider)] border-y border-[var(--color-paper-divider)]">
        {notDoing.map((item) => (
          <li key={item.title} className="py-5">
            <p className="text-[16px] font-semibold leading-[1.6] text-[var(--color-paper-ink)]">
              {item.title}
            </p>
            <p className="mt-1.5 text-[14px] leading-[1.75] text-[var(--color-paper-ink-faint)]">
              {item.note}
            </p>
          </li>
        ))}
      </ul>

      {/* 공시 가격 — 곁블록. 본문 위계로 올리지 않는다. */}
      <aside className="mt-8 border-l-2 border-[var(--color-paper-pen)] py-1 pl-5">
        <p className="text-[16px] leading-[1.8] text-[var(--color-paper-ink-soft)]">
          {notForVendors.priceAside}
        </p>
        <Link
          href="/price"
          className="mt-3 inline-flex min-h-11 items-center text-[14px] font-semibold text-[var(--color-paper-pen)] underline underline-offset-4 transition-colors duration-200 hover:text-[var(--color-paper-pen-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none"
        >
          공시 가격 보기
        </Link>
      </aside>

      <p className={`mt-8 max-w-[60ch] ${noteText}`}>{notForVendors.aiNotice}</p>
      <Link
        href={notForVendors.policyLink.href}
        className="mt-3 inline-flex min-h-11 items-center text-[14px] font-semibold text-[var(--color-paper-pen)] underline underline-offset-4 transition-colors duration-200 hover:text-[var(--color-paper-pen-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none"
      >
        {notForVendors.policyLink.label}
      </Link>
    </Section>
  );
}
