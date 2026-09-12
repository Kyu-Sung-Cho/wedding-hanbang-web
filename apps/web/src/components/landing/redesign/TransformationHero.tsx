import AppPreviewCard from "./AppPreviewCard";
import TrackedLandingLink from "./TrackedLandingLink";

import { landingContent } from "./landingContent";
import { noteText, shell } from "./notebook";

/** 승인된 종이 표면·서체·크기를 유지하고, 첫 화면에서 AI와 기록 목적지를 설명한다. */
export default function TransformationHero() {
  const { hero } = landingContent;

  return (
    <section
      className="relative overflow-hidden pb-[34px] pt-6 lg:pb-[76px] lg:pt-20"
      aria-labelledby="hero-title"
    >
      {/* 꽃은 여기서 그리지 않는다. 정본 시안은 다섯 자리에 놓고, 그 배치는
          페이지 전체를 덮는 `LandingBloomLayer` 가 진다. */}
      <div className={`${shell} relative grid items-start gap-[30px] lg:grid-cols-2 lg:gap-16`}>
        <div>
        <p className="mb-4 lg:mb-6">
          <span className="landing-tape landing-hand">{hero.tape}</span>
        </p>

        <h1
          id="hero-title"
          className="landing-display text-[30px] leading-[1.42] tracking-[-0.01em] text-[var(--color-paper-ink)] lg:text-[clamp(2.25rem,3.48vw,3.125rem)] lg:leading-[1.34]">
          {hero.title.split("\n").map((line) => {
            // 현재 주메시지의 강조어만 기존 로즈브라운 토큰으로 칠한다.
            // 시안 픽셀을 재니 #8F6563 이고 이는 기존 토큰 `--color-rose-600`(#8F6662)와
            // 같은 색이다(파랑 1 차이 = 래스터화 오차). 새 색을 만들지 않는다.
            // 강조어가 그 줄에 없으면 통째로 잉크색 — 문장을 바꿔도 조용히 깨지지 않는다.
            const at = hero.titleAccent ? line.indexOf(hero.titleAccent) : -1;
            if (at < 0) {
              return (
                <span key={line} className="block">
                  {line.includes(", ") ? <>
                    {line.slice(0, line.indexOf(", ") + 1)}
                    <br className="lg:hidden" />
                    <span className="hidden lg:inline"> </span>
                    {line.slice(line.indexOf(", ") + 2)}
                  </> : line}
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

        <p className="mt-[14px] max-w-[470px] text-[15px] leading-[1.74] text-[var(--color-paper-ink-soft)] lg:mt-[18px] lg:text-[17.5px] lg:leading-[1.76]">{hero.body}</p>

        <div className="mt-[22px] flex flex-col gap-1 lg:mt-8 lg:flex-row lg:items-center lg:gap-[14px]">
          <TrackedLandingLink
            source="landing_hero_primary"
            href={hero.primary.href}
            className="inline-flex min-h-[54px] items-center justify-center whitespace-nowrap rounded-[11px] bg-[var(--hb-action)] px-5 text-[16px] font-semibold text-[var(--color-paper-card)] transition-colors duration-200 hover:bg-[var(--hb-action-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none lg:rounded-[9px] lg:px-6"
          >
            {hero.primary.label}
          </TrackedLandingLink>
          <TrackedLandingLink
            source="landing_hero_secondary"
            href={hero.secondary.href}
            className="inline-flex min-h-12 items-center justify-center whitespace-nowrap rounded-[9px] px-5 text-[14.5px] font-semibold text-[var(--color-paper-pen)] transition-colors duration-200 hover:text-[var(--color-paper-pen-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none lg:min-h-[54px] lg:border lg:border-[var(--color-paper-ink)] lg:text-[16px] lg:text-[var(--color-paper-ink)]"
          >
            {hero.secondary.label}
          </TrackedLandingLink>
        </div>

        <p className={`relative mt-2 max-w-[470px] text-center lg:mt-[14px] lg:text-left ${noteText}`}>{hero.note}</p>
        </div>

        {/* 앱 화면 미리보기. 좁은 화면에서는 첫 행동(버튼·안내문) 뒤로 내려간다 —
            소스 순서가 곧 그 순서다. */}
        <AppPreviewCard />
      </div>
    </section>
  );
}
