import TrackedLandingLink from "./TrackedLandingLink";

import { landingContent } from "./landingContent";
import { band, bodyText, noteText, sectionTitle, shell } from "./notebook";

/**
 * 커뮤니티 — 제품 계약의 **둘째 축**.
 *
 * CLAUDE.md 제품 계약: "…비슷한 시기에 준비하는 사람들의 기록을 함께 보며…"
 *
 * ## 왜 이 섹션이 필요했나
 *
 * 2026-08-28 랜딩에 커뮤니티가 **아예 없었다.** 대신 공시 위약금 비교(부가 기능)가
 * 메인 자리를 차지하고 있었다. 파운더 지적으로 바로잡는다 — 메인 기능 넷
 * (아모라 · 커뮤니티 · 예산·할 일·일정 · 파트너 알림)이 먼저다.
 *
 * ## 동기방이 이 축의 실체다
 *
 * 일반 게시판은 어디에나 있다. 여기서 다른 것은 **결혼식 분기로 방이 나뉜다**는 것이다
 * (`app/(community)/community/cohort`). 지금 내가 막힌 자리를 두 달 먼저 지난 사람이
 * 같은 방에 있다. 그래서 분기 이름을 실제로 화면에 내놓는다 — "동기방이 있어요" 라고만
 * 하면 무슨 말인지 알 수 없다.
 */
export default function CommunitySection() {
  const { community } = landingContent;

  return (
    <section id="community" className={band} aria-labelledby="community-title">
      <div className={shell}>
        <p className="mb-4">
          <span className="landing-hand text-[19px] text-[var(--color-paper-pen)]">
            {community.eyebrow}
          </span>
        </p>

        <h2 id="community-title" className={sectionTitle}>
          {community.title.split("\n").map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h2>

        <p className={`mt-7 max-w-[48ch] ${bodyText}`}>{community.body}</p>

        <div className="mt-9 grid gap-5 lg:grid-cols-2 lg:gap-7">
          {/* 동기방 — 분기 이름을 실제로 보여 준다. */}
          <div className="landing-note px-6 py-7">
            {/* 줄마다 붙는 "동기방" 라벨은 `aria-hidden` 이다 — 넷을 다 읽으면
                "2026년 1분기 동기방, 2026년 2분기 동기방…" 으로 같은 말이 네 번
                되풀이된다. 대신 목록 자체에 이름을 줘서 한 번만 말하게 한다. */}
            <ul aria-label="분기별 동기방">
              {community.cohorts.map((cohort) => (
                <li
                  key={cohort}
                  className="flex items-center justify-between text-[16px] leading-8 text-[var(--color-paper-ink-soft)]"
                >
                  <span>{cohort}</span>
                  <span
                    aria-hidden
                    className="text-[14px] text-[var(--color-paper-ink-faint)]"
                  >
                    동기방
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* 오가는 이야기 — 실제 카테고리다. */}
          <div className="landing-note px-6 py-7">
            <p className="text-[16px] leading-8 text-[var(--color-paper-ink-soft)]">
              {community.topicsLead}
            </p>
            <ul>
              {community.topics.map((topic) => (
                <li
                  key={topic}
                  className="text-[16px] leading-8 text-[var(--color-paper-ink-soft)]"
                >
                  {/* ⚠️ 여기 `landing-pen` 이 붙어 있었다. 그건 **파란 펜 밑줄**이고
                      이 랜딩에서 밑줄은 "누를 수 있다"는 뜻이다 — 정본 시안도 `.pen` 을
                      실제 링크에만 썼고, `landingDesignSystem.test.ts` 는 그 조합을
                      "홀로 서는 링크의 레시피"로 못 박는다. 카테고리 이름은 링크가
                      아니라서 눌러도 아무 일이 없다. 강조는 굵기와 색으로만 한다. */}
                  <span className="font-medium text-[var(--color-paper-ink)]">
                    {topic}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <p className={`mt-7 ${noteText}`}>{community.note}</p>

        <div className="mt-8">
          <TrackedLandingLink
            source="landing_community_cta"
            href={community.cta.href}
            className="inline-flex min-h-12 items-center justify-center rounded-[6px] border border-[var(--color-paper-outline)] px-6 text-[16px] font-semibold text-[var(--color-paper-ink)] transition-colors duration-200 hover:border-[var(--color-paper-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            {community.cta.label}
          </TrackedLandingLink>
        </div>
      </div>
    </section>
  );
}
