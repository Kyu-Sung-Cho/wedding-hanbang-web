import TrackedLandingLink from "./TrackedLandingLink";

import { landingContent } from "./landingContent";
import { band, noteText, sectionTitle, shell } from "./notebook";

/**
 * 공시 위약금 비교. **설명하지 않고 두 업체의 원문을 나란히 놓는다.**
 *
 * 정본 시안 `웨딩한방-랜딩시안/NotebookBest.html` 의 둘째 섹션이다.
 *
 * ## 왜 이 섹션이 랜딩에서 제일 센가
 *
 * "가격을 투명하게 봅니다" 는 누구나 쓰는 말이다. 같은 업종 두 곳의 취소 위약금이
 * **얼마나 다른지**를 원문 그대로 옆에 놓으면 설명이 필요 없다. 한쪽은 단계별 정액이고
 * 다른 쪽은 마지막 일주일에 결제금액 100% 다 — 계약 전에 이걸 본 사람과 못 본 사람은
 * 다른 결정을 한다.
 *
 * ## 요약하지 않는다
 *
 * 카드마다 "공시 원문 · 요약하거나 해석하지 않았습니다" 를 붙인다. 이건 겸양이 아니라
 * **제품 계약**이다(CLAUDE.md: 품질·적정성을 점수·등급으로 판정하지 않는다).
 * 값을 다듬는 순간 우리가 판정한 것이 된다.
 */
export default function PriceCompareSection() {
  const { priceCompare } = landingContent;

  return (
    <section id="price" className={band} aria-labelledby="price-title">
      <div className={shell}>
        <p className="mb-4">
          <span className="landing-hand text-[19px] text-[var(--color-paper-mark)]">
            {priceCompare.eyebrow}
          </span>
        </p>

        <h2 id="price-title" className={sectionTitle}>
          {priceCompare.title.split("\n").map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h2>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 sm:gap-7">
          {priceCompare.cards.map((card) => (
            <div key={card.vendor} className="landing-note px-6 py-7">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[16px] font-semibold text-[var(--color-paper-ink)]">
                  {card.vendor}
                </p>
                <p className="text-[13px] text-[var(--color-paper-ink-faint)]">{card.source}</p>
              </div>

              {/* 줄 간격 32px 에 맞춘다 — 안 맞추면 줄무늬가 종이가 아니라 배경 무늬가 된다. */}
              <p className="mt-6 text-[16px] leading-8 text-[var(--color-paper-ink-soft)]">
                {card.heading}
              </p>
              <ul>
                {card.rows.map((row) => (
                  <li
                    key={row}
                    className="text-[16px] leading-8 text-[var(--color-paper-ink-soft)]"
                  >
                    {row}
                  </li>
                ))}
              </ul>

              <p className={`mt-6 ${noteText}`}>{card.note}</p>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-8 sm:flex-row sm:items-start sm:gap-12">
          <div className="flex gap-10">
            {priceCompare.stats.map((stat) => (
              <div key={stat.label}>
                <p className="landing-hand text-[38px] leading-none text-[var(--color-paper-ink)]">
                  {stat.value}
                  <span className="ml-1 text-[20px]">{stat.unit}</span>
                </p>
                <p className={`mt-2 ${noteText}`}>{stat.label}</p>
              </div>
            ))}
          </div>
          <p className={`max-w-[52ch] ${noteText}`}>{priceCompare.note}</p>
        </div>

        <div className="mt-9">
          <TrackedLandingLink
            source="landing_price_cta"
            href={priceCompare.cta.href}
            className="inline-flex min-h-12 items-center justify-center rounded-[6px] bg-[var(--color-paper-ink)] px-7 text-[16px] font-semibold text-[var(--color-paper-card)] transition-colors duration-200 hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            {priceCompare.cta.label}
          </TrackedLandingLink>
        </div>
      </div>
    </section>
  );
}
