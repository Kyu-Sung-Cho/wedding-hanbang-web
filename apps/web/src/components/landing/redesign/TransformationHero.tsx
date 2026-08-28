import TrackedLandingLink from "./TrackedLandingLink";

import { BouquetCorner } from "./LandingBloom";
import { landingContent } from "./landingContent";
import { bodyText, noteText, shell } from "./notebook";

/**
 * 첫 화면.
 *
 * ## 후크가 왜 AI 가 아닌가
 *
 * 이 제품에서 제일 센 것은 아모라의 성능이 아니라 **아모라가 두 사람의 대화를
 * 한 덩어리로 읽는다는 구조**다(`api/chat/route.ts:1889`). 그런데 그건 설명해야
 * 알아듣는 이야기라 첫 화면에 못 쓴다.
 *
 * 첫 화면은 처음 온 사람이 자기 얘기라고 느끼는 문장이어야 하고, 그게
 * "둘의 기준이 다른 걸 몰라서" 다. 그리고 그 문장을 **로그인 없이 바로 만져 볼 수
 * 있다** — 웨딩코드는 supabase 0 · fetch 0 · getUser 0 이고 답이 URL 해시에 실린다.
 * 비로그인 아모라 체험이 #245 로 닫힌 지금, 만질 수 있는 후크는 이것뿐이다.
 *
 * ## 첫 화면 규칙
 *
 * H1 에 장면 낱말이 들어가야 한다(`싸우다`). 도구 이름(예산·일정·체크리스트)을
 * 첫 화면에 늘어놓지 않는다 — 85개 시안을 재 보니 장면 낱말 대 도구 낱말 비가
 * 평균 0.47 이었고, 1.0 을 넘긴 시안이 하나도 없었다.
 */
export default function TransformationHero() {
  const { hero } = landingContent;

  return (
    <section
      className="relative overflow-hidden pb-60 pt-12 sm:pt-16 lg:pb-20"
      // 랜드마크에 이름이 없으면 스크린리더 목록에 "section" 으로만 뜬다.
      // `Section` 을 쓰는 섹션들은 자동으로 받는데 히어로는 자기 마크업이라 빠져 있었다.
      aria-labelledby="hero-title"
    >
      {/* 부케는 첫 화면에 하나만 둔다 — 여러 개 두면 종이가 아니라 벽지가 된다.
          자리가 화면 폭에 따라 다르다. 글 오른쪽에 자리가 남는 폭에서만 위쪽 모서리에
          두고, 좁은 폭에서는 본문이 끝난 **아래**로 내린다.

          경계는 `lg`(1024px)다. 처음엔 `sm`(640px)으로 뒀는데, 768px 실측에서 부케가
          H1 을 293x171px 만큼 덮었다 — H1 이 두세 줄로 길어지는데 부케가 차지하는
          430px 을 뺀 폭이 모자란다. 1280px 에서만 겹침이 0이었다. */}
      <BouquetCorner className="pointer-events-none absolute -bottom-6 -right-24 h-[260px] w-[215px] opacity-70 lg:bottom-auto lg:-right-6 lg:-top-10 lg:h-[520px] lg:w-[430px] lg:opacity-[0.72]" />

      <div className={`${shell} relative`}>
        <p className="landing-hand mb-5 text-[20px] text-[var(--color-paper-pen)]">
          웨딩한방
        </p>

        <h1
          id="hero-title"
          className="max-w-[19ch] text-balance text-[clamp(2rem,6.4vw,3.6rem)] font-semibold leading-[1.16] tracking-[-0.045em] text-[var(--color-paper-ink)]">
          결혼 준비에서 싸우는 건
          <br />
          가격 때문이 아니라,
          <br />
          <span className="landing-pen">둘의 기준이 다른 걸</span> 몰라서예요.
        </h1>

        <p className={`mt-7 max-w-[46ch] ${bodyText}`}>{hero.body}</p>

        <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
          <TrackedLandingLink
            source="landing_hero_primary"
            href={hero.primary.href}
            className="inline-flex min-h-12 items-center justify-center rounded-[6px] bg-[var(--color-paper-ink)] px-7 text-[16px] font-semibold text-[var(--color-paper-card)] transition-colors duration-200 hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            {hero.primary.label}
          </TrackedLandingLink>
          <TrackedLandingLink
            source="landing_hero_secondary"
            href={hero.secondary.href}
            className="inline-flex min-h-12 items-center justify-center rounded-[6px] border border-[var(--color-paper-outline)] px-7 text-[16px] font-semibold text-[var(--color-paper-ink-soft)] transition-colors duration-200 hover:border-[var(--color-paper-ink)] hover:text-[var(--color-paper-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            {hero.secondary.label}
          </TrackedLandingLink>
        </div>

        <p className={`relative mt-5 max-w-[42ch] ${noteText}`}>{hero.note}</p>
      </div>
    </section>
  );
}
