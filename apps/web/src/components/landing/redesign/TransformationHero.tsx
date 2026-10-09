import { ArrowRight } from "lucide-react";

import AppPreviewCard from "./AppPreviewCard";
import TrackedLandingLink from "./TrackedLandingLink";

import { landingContent } from "./landingContent";
import { noteText, shell } from "./notebook";

/** 승인된 시각 규격 안에서 준비의 도움·공동 관리·첫 행동을 설명한다. */
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
          className="landing-display text-balance text-[30px] leading-[1.42] tracking-[-0.01em] text-[var(--color-paper-ink)] lg:text-[clamp(2.25rem,3.48vw,3.125rem)] lg:leading-[1.34]">
          {hero.title.split("\n").map((line) => {
            // 현재 주메시지의 강조어만 기존 로즈브라운 토큰으로 칠한다.
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

        <p className="mt-[14px] max-w-[470px] text-[15px] leading-[1.74] text-[var(--color-paper-ink-soft)] lg:mt-[18px] lg:text-[17.5px] lg:leading-[1.76]">{hero.body}</p>

        <div className="mt-[22px] flex flex-col items-stretch gap-1 lg:mt-8 lg:items-start lg:gap-2">
            <TrackedLandingLink
              source="landing_hero_primary"
              href={hero.primary.href}
              prefetch={false}
              className="inline-flex min-h-[54px] items-center justify-center rounded-[11px] bg-[var(--hb-action)] px-5 py-3 text-center text-[16px] font-semibold text-[var(--color-paper-card)] transition-colors duration-200 hover:bg-[var(--hb-action-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none lg:rounded-[9px] lg:px-6"
            >
              {hero.primary.label}
            </TrackedLandingLink>
            <TrackedLandingLink
              source="landing_hero_secondary"
              href={hero.secondary.href}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-[6px] px-2 text-[14px] font-medium text-[var(--color-paper-pen)] underline-offset-4 transition-colors duration-200 hover:text-[var(--color-paper-pen-deep)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none lg:justify-start"
            >
              {hero.secondary.label}
              <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
            </TrackedLandingLink>
          </div>

          <p className={`relative mt-2 max-w-[470px] lg:text-left ${noteText}`}>{hero.note}</p>
        </div>

        {/* 앱 화면 미리보기. 좁은 화면에서는 첫 행동(버튼·안내문) 뒤로 내려간다 —
            소스 순서가 곧 그 순서다. */}
        <AppPreviewCard />
      </div>
    </section>
  );
}
