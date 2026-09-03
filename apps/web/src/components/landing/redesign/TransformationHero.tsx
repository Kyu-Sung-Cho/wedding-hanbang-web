import AppPreviewCard from "./AppPreviewCard";
import TrackedLandingLink from "./TrackedLandingLink";

import { landingContent } from "./landingContent";
import { bodyText, noteText, shell } from "./notebook";

/**
 * 첫 화면.
 *
 * 표면 언어는 정본 시안 `docs/landing/NotebookBest.html`, 카피는 2026-09-03 시안
 * `(웨딩한방) 랜딩페이지 디자인 예시.pdf` 를 따른다.
 *
 * ## 후크가 "둘의 기준" 인 이유
 *
 * 이전 후크는 "결혼 준비 노트, 같이 정리해요." 였다 — 흩어진 기록을 모아 준다는
 * 말이고, **도구의 효용**이다. 2026-09-03 시안은 한 칸 앞을 짚는다:
 * "결혼 준비, 뭐부터 할지보다 / **우리 둘이** 뭘 원하는지부터."
 * 할 일을 몰라서 막히는 게 아니라 둘의 기준이 없어서 막힌다는 것이고, 제품 계약이
 * 말하는 축(관계 → 결정 → 기록)과 같은 순서다.
 *
 * `우리 둘이` 만 로즈브라운으로 칠한다. 강조 범위는 `landingContent.hero.titleAccent`
 * 가 정하고, 색은 시안 픽셀과 같은 기존 토큰 `--color-rose-600` 을 쓴다(래스터 실측값과
 * 파랑 1 차이 = 래스터화 오차). **새 색을 만들지 않는다.**
 *
 * ## H1 크기와 폭
 *
 * 최대값 3.9rem → 3.45rem, `max-w-[16ch]` 제거(2026-09-03). 시안의 H1 첫 줄
 * ("결혼 준비, 뭐부터 할지보다")은 547px 이고 Paperlogy 600·자간 -0.045em 에서 55px 이
 * 546px 이다. 잉크 높이로 재면 45px 이 나오는데 시안 서체가 우리보다 좁아 생기는 차이라,
 * **줄이 어디서 끊기는지를 정하는 폭**을 기준으로 삼았다.
 *
 * 폭 제한(`max-w-[16ch]`)은 줄바꿈이 카피의 개행으로 이미 정해져 있어 할 일이 없었고,
 * 2단이 되면서 오히려 시안에 없는 줄바꿈을 만들었다 — 첫 줄이 넷으로 쪼개졌다.
 *
 * ## 버튼
 *
 * 시안 그대로다. 첫 버튼이 가입이고("아모라와 준비 시작하기"), 버튼 밑 작은 글씨가
 * "결제 없이 계정 생성"이다. 로그인 없이 열리는 문은 둘째 버튼이 진다.
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
      <div className={`${shell} relative grid items-center gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)] lg:gap-14`}>
        <div>
        <p className="mb-7">
          <span className="landing-tape landing-hand">{hero.tape}</span>
        </p>

        <h1
          id="hero-title"
          className="text-balance text-[clamp(2.2rem,7vw,3.45rem)] font-semibold leading-[1.14] tracking-[-0.045em] text-[var(--color-paper-ink)]">
          {hero.title.split("\n").map((line) => {
            // 시안은 둘째 줄의 `우리 둘이` 만 로즈브라운으로 칠한다.
            // 시안 픽셀을 재니 #8F6563 이고 이는 기존 토큰 `--color-rose-600`(#8F6662)와
            // 같은 색이다(파랑 1 차이 = 래스터화 오차). 새 색을 만들지 않는다.
            // 강조어가 그 줄에 없으면 통째로 잉크색 — 문장을 바꿔도 조용히 깨지지 않는다.
            const at = hero.titleAccent ? line.indexOf(hero.titleAccent) : -1;
            if (at < 0) {
              return (
                <span key={line} className="block">
                  {line}
                </span>
              );
            }
            return (
              <span key={line} className="block">
                {line.slice(0, at)}
                <span className="text-[var(--color-rose-600)]">{hero.titleAccent}</span>
                {line.slice(at + (hero.titleAccent?.length ?? 0))}
              </span>
            );
          })}
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

        {/* 앱 화면 미리보기. 좁은 화면에서는 첫 행동(버튼·안내문) 뒤로 내려간다 —
            소스 순서가 곧 그 순서다. */}
        <AppPreviewCard />
      </div>
    </section>
  );
}
