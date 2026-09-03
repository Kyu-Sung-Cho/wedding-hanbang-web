import TrackedLandingLink from "./TrackedLandingLink";

import { landingContent } from "./landingContent";
import { band, bodyText, eyebrowText, noteText, sectionTitle, shell } from "./notebook";

/**
 * ④ 둘의 의견이 다를 때 — **편을 들지 않는다.**
 *
 * 2026-09-03 시안: 왼쪽에 카피·버튼·사진 자리, 오른쪽에 신부/신랑/아모라 대화 카드.
 *
 * ## 이 섹션이 파는 것은 기능이 아니다
 *
 * "편을 들지 않는다"는 못 하는 게 아니라 **선택**이고, 그게 이 제품이 범용 챗봇과
 * 갈리는 자리다. 그래서 대화 카드가 셋이다 — 두 사람이 각자 말하고, 아모라가 어느
 * 쪽 손도 들지 않은 채 둘 다 지킬 선을 찾는 장면이 한 화면에 있어야 한다.
 *
 * `note` 는 AI 고지와 샘플 표시를 함께 진다. 아모라가 말하는 카드에는 매번 붙는다.
 */
export default function NoSideSection() {
  const { noSide } = landingContent;

  return (
    <section
      id="noside"
      className={`${band} bg-[var(--color-paper-tint)]`}
      aria-labelledby="noside-title"
    >
      <div className={`${shell} grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-14`}>
        <div>
          <p className="mb-5">
            <span className={eyebrowText}>
              {noSide.eyebrow}
            </span>
          </p>

          <h2 id="noside-title" className={sectionTitle}>
            {noSide.title.split("\n").map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h2>

          <p className={`mt-7 max-w-[46ch] ${bodyText}`}>{noSide.body}</p>

          <p className="mt-8">
            <TrackedLandingLink
              source="landing_noside_scenes"
              href={noSide.cta.href}
              className="inline-flex min-h-[54px] items-center justify-center rounded-[6px] border border-[var(--color-paper-outline)] px-6 text-[16px] font-semibold text-[var(--color-paper-ink)] transition-colors duration-200 hover:border-[var(--color-paper-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none"
            >
              {noSide.cta.label}
            </TrackedLandingLink>
          </p>

          {/* 사진 자리. 지금은 사진이 없으니 무엇을 넣어야 하는지 화면이 스스로 말한다.
              출시 전에 실제 사진으로 바꾼다. */}
          <div className="mt-9 rounded-[12px] border border-dashed border-[var(--color-paper-outline)] px-6 py-10 text-center">
            <p className="text-[14px] font-semibold text-[var(--color-paper-ink-soft)]">
              {noSide.photo.title}
            </p>
            {noSide.photo.captions.map((caption) => (
              <p key={caption} className={`mt-2 ${noteText}`}>
                {caption}
              </p>
            ))}
          </div>
        </div>

        <div className="rounded-[12px] border border-[var(--color-paper-edge)] bg-[var(--color-paper-card)] px-6 py-7 shadow-raised sm:px-7">
          {noSide.turns.map((turn) => (
            <div key={turn.who} className="mt-5 first:mt-0">
              <p className="text-[12px] font-medium text-[var(--color-paper-ink-faint)]">
                {turn.who}
              </p>
              <p className="mt-2 rounded-[12px] bg-[var(--color-paper-tint)] px-5 py-4 text-[16px] leading-[1.7] text-[var(--color-paper-ink)]">
                {turn.say}
              </p>
            </div>
          ))}
          <p className={`mt-5 ${noteText}`}>{noSide.note}</p>
        </div>
      </div>
    </section>
  );
}
