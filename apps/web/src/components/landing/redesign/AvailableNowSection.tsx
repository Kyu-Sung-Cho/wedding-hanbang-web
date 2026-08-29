import Link from "next/link";

import TrackedLandingLink from "./TrackedLandingLink";

import { landingContent } from "./landingContent";
import { band, noteText, sectionTitle, shell } from "./notebook";

/**
 * 로그인 없이 지금 되는 것 네 가지.
 *
 * 정본 시안 `docs/landing/NotebookBest.html` 의 `#now` 섹션이다.
 * 카드마다 테이프에 번호(01~04)를 붙여 순서가 아니라 **목록**임을 보인다.
 *
 * ⚠️ 시안의 `#now` 는 `.g3` 에 카드 셋이었고 주석도 "세 가지" 였다. 공시 가격이
 * 전용 섹션에서 이 안의 카드로 내려오며(파운더 결정) **넷**이 됐는데 수량 서술만
 * 셋으로 남아 있었다. 그래서 그리드도 시안의 3열이 아니라 2열이다.
 *
 * ## 카드 아래 작은 글씨가 본문이다
 *
 * 네 카드의 `note` 는 장식이 아니라 **계약**이다. 특히 02 의 "점수도 궁합도 매기지
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

        {/* ⚠️ 여기 `lg:grid-cols-3` 이 있었다. 카드는 **넷**이라 lg 에서 네 번째가
            혼자 줄을 찼다. 2열로 두면 2×2 로 떨어진다. `lg:grid-cols-4` 는 쓰지
            마라 — shell 폭(max-w 1080 · px-8)에서 카드당 약 236px 이라 각 카드의
            `note` 고지문이 6~8줄로 늘어진다. 그 고지문은 장식이 아니라 계약이다. */}
        <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:gap-6">
          {availableNow.cards.map((card) => (
            <TrackedLandingLink
              key={card.no}
              source="landing_now_card"
              href={card.href}
              className="landing-note block px-6 py-7 transition-colors duration-200 hover:border-[var(--color-paper-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none"
            >
              <span className="landing-tape landing-hand mb-5 inline-block">{card.no}</span>
              <span className="block text-[18px] font-semibold text-[var(--color-paper-ink)]">
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
              {/* ⚠️ 여기 `{index === 0 ? " " : ""}` 가 있었다. 링크 뒤에 공백을 넣으면
                  다음 조각 "과 " 가 앞말에서 떨어져 **"원문 과 커뮤니티 도"** 로 나갔다
                  (2026-08-29 라이브 실측). 한국어 조사는 앞말에 붙는다 — 조각을 이어
                  붙이는 자리에서는 조사 쪽에 공백을 두지 않는다. */}
            </span>
          ))}
          {availableNow.footTail}
        </p>
      </div>
    </section>
  );
}
