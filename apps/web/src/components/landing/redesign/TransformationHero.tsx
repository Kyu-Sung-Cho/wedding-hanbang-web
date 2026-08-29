import TrackedLandingLink from "./TrackedLandingLink";

import { landingContent } from "./landingContent";
import { bodyText, noteText, shell } from "./notebook";

/**
 * 첫 화면.
 *
 * 정본 시안 `docs/landing/NotebookBest.html` 그대로다.
 *
 * ## 후크가 "노트" 인 이유
 *
 * 결혼 준비의 실제 고통은 기능이 없는 게 아니라 **어디에 뭘 적어뒀는지 모르는 것**이다.
 * 카톡·메모·엑셀·업체 문자에 흩어져 있고, 가격과 조건은 업체마다 다른 말로 적혀 있다.
 * 그래서 첫 문장이 "결혼 준비 노트, 같이 정리해요." 이고, 바로 아래에서 그 노트를
 * 실제로 펼쳐 보여 준다(`AmoraNoteSection`).
 *
 * ## 버튼이 시안과 다른 이유
 *
 * 시안의 첫 버튼은 "가입 없이 물어보기" 였다. 그 경로 — 비로그인 아모라 체험 — 는
 * **시안을 만든 같은 날(2026-08-27) 파운더가 닫았다**(`lib/demoTrial.ts`).
 * 라이브 `/price` 를 실측해 버튼이 화면에 0개인 것을 확인했다. 없는 문을 첫 버튼으로
 * 걸면 처음 온 사람이 바로 막힌다. 시안이 이미 갖고 있던 둘째 버튼을 첫째로 올렸다.
 *
 * ## 첫 화면 규칙
 *
 * 도구 이름(예산·일정·체크리스트)을 첫 화면에 늘어놓지 않는다 — 85개 시안을 재 보니
 * 장면 낱말 대 도구 낱말 비가 평균 0.47 이었고 1.0 을 넘긴 시안이 없었다.
 * 도구 이름은 ⑤ 확인 섹션이 진다. `landingHeroExperience.test.ts` 가 글자로 막는다.
 */
export default function TransformationHero() {
  const { hero } = landingContent;

  return (
    <section
      className="relative overflow-hidden pb-16 pt-10 sm:pt-14"
      aria-labelledby="hero-title"
    >
      {/* 꽃은 여기서 그리지 않는다. 정본 시안은 다섯 자리에 놓고, 그 배치는
          페이지 전체를 덮는 `LandingBloomLayer` 가 진다. */}
      <div className={`${shell} relative`}>
        <p className="mb-7">
          <span className="landing-tape landing-hand">{hero.tape}</span>
        </p>

        <h1
          id="hero-title"
          className="max-w-[16ch] text-balance text-[clamp(2.2rem,7vw,3.9rem)] font-semibold leading-[1.14] tracking-[-0.045em] text-[var(--color-paper-ink)]">
          {hero.title.split("\n").map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h1>

        <p className={`mt-7 max-w-[46ch] ${bodyText}`}>{hero.body}</p>

        <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
          <TrackedLandingLink
            source="landing_hero_primary"
            href={hero.primary.href}
            className="inline-flex min-h-[54px] items-center justify-center rounded-[6px] bg-[var(--color-paper-ink)] px-7 text-[16px] font-semibold text-[var(--color-paper-card)] transition-colors duration-200 hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            {hero.primary.label}
          </TrackedLandingLink>
          <TrackedLandingLink
            source="landing_hero_secondary"
            href={hero.secondary.href}
            className="inline-flex min-h-[54px] items-center justify-center rounded-[6px] border border-[var(--color-paper-outline)] px-6 text-[16px] font-semibold text-[var(--color-paper-ink)] transition-colors duration-200 hover:border-[var(--color-paper-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            {hero.secondary.label}
          </TrackedLandingLink>
        </div>

        <p className={`relative mt-6 max-w-[46ch] ${noteText}`}>{hero.note}</p>
      </div>
    </section>
  );
}
