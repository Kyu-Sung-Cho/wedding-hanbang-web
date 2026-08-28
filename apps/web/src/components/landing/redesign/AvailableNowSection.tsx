import Link from "next/link";

import TrackedLandingLink from "./TrackedLandingLink";

import { landingContent } from "./landingContent";
import { band, noteText, sectionTitle, shell } from "./notebook";

/**
 * 로그인 없이 지금 되는 것 세 가지.
 *
 * 정본 시안 `웨딩한방-랜딩시안/NotebookBest.html` 의 `#now` 섹션이다.
 * 카드마다 테이프에 번호(01·02·03)를 붙여 순서가 아니라 **목록**임을 보인다.
 *
 * ## 카드 아래 작은 글씨가 본문이다
 *
 * 세 카드의 `note` 는 장식이 아니라 **계약**이다. 특히 02 의 "점수도 궁합도 매기지
 * 않아요" 는 CLAUDE.md 가 요구하는 고지다(WeddingCode 는 검증된 궁합 검사가 아니다).
 * 지우면 화면이 금지된 약속을 하게 된다.
 *
 * ## 여기 있는 것만 적는다
 *
 * 시안은 카드 아래에 "아모라 대화도 로그인 없이 열려 있어요" 라고 적었다. 비로그인
 * 아모라 체험은 2026-08-27에 닫혔으므로 그 줄에서 아모라를 뺐다. 남은 둘 — 공시
 * 가격·위약금 원문과 커뮤니티 — 은 오늘 실제로 로그인 없이 열린다.
 */
export default function AvailableNowSection() {
  const { availableNow } = landingContent;

  return (
    <section
      id="now"
      className={`${band} bg-[var(--color-paper-tint)]`}
      aria-labelledby="now-title"
    >
      <div className={shell}>
        <p className="mb-4">
          <span className="landing-hand text-[19px] text-[var(--color-paper-pen)]">
            {availableNow.eyebrow}
          </span>
        </p>

        <h2 id="now-title" className={sectionTitle}>
          {availableNow.title}
        </h2>

        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:gap-6">
          {availableNow.cards.map((card) => (
            <TrackedLandingLink
              key={card.no}
              source="landing_now_card"
              href={card.href}
              className="landing-note block px-6 py-7 transition-colors duration-200 hover:border-[var(--color-paper-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none"
            >
              <span className="landing-tape landing-hand mb-5 inline-block">{card.no}</span>
              <span className="block text-[17px] font-semibold text-[var(--color-paper-ink)]">
                {card.title}
              </span>
              {/* 줄 간격 32px — 카드 줄무늬 위에 글이 얹히게. */}
              <span className="mt-3 block text-[16px] leading-8 text-[var(--color-paper-ink-soft)]">
                {card.body}
              </span>
              <span className={`mt-5 block ${noteText}`}>{card.note}</span>
            </TrackedLandingLink>
          ))}
        </div>

        <p className={`mt-8 ${noteText}`}>
          {availableNow.footLead}
          {availableNow.footLinks.map((link, index) => (
            <span key={link.href}>
              {index > 0 ? "과 " : ""}
              <Link
                href={link.href}
                className="landing-pen font-medium text-[var(--color-paper-ink)]"
              >
                {link.label}
              </Link>
              {index === 0 ? " " : ""}
            </span>
          ))}
          {availableNow.footTail}
        </p>
      </div>
    </section>
  );
}
