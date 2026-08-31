import TrackedLandingLink from "./TrackedLandingLink";

import { landingContent } from "./landingContent";
import { NoteCard, Section, bodyText, noteText, ruled } from "./notebook";

/**
 * 스무 장면이 **어떤 모양인지 보여 준다.**
 *
 * ## 왜 되살렸나
 *
 * 이 섹션은 2026-08-29 시안 개편에서 사라졌다가 같은 날 되돌아왔다. 없앤 뒤의 랜딩은
 * 스무 장면을 "각자 답하면 나란히 놓아드려요" 한 줄로만 말했다 — 그건 무엇을 하는지
 * 알려주지만 **어떤 느낌인지는 알려주지 않는다.** 운영 랜딩(`hanbang.ai/landing`)이
 * 이 자리에 장면 카드를 두고 있었고, 파운더가 그쪽과 비슷해야 한다고 지적했다.
 *
 * ## 카드가 진짜처럼 보이되 진짜인 척하지 않는다
 *
 * 선택지는 눌리지 않는다 — 여기서 답하는 게 아니라 **어떻게 생겼는지 보는** 자리다.
 * 그래서 `aria-hidden` 으로 보조기기에서 숨기고, 진짜 행동은 아래 버튼 하나뿐이다.
 * 눌리는 것처럼 그려 두고 아무 일도 안 일어나면 그게 이 저장소가 "고장났다고 읽는
 * 실패" 라고 부르는 것이다.
 */
export default function ScenesSection() {
  const { scenes } = landingContent;

  return (
    <Section id="scenes" eyebrow={scenes.eyebrow} title={scenes.title}>
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start">
        <NoteCard tilt={-0.6}>
          {/* 상황은 파란 펜 손글씨로 — 사람이 노트에 적어 둔 것처럼. */}
          <p className="landing-hand text-[22px] leading-[1.6] text-[var(--color-paper-pen)]">
            {scenes.situation}
          </p>
          <p className={`mt-5 font-medium ${ruled} text-[var(--color-paper-ink)]`}>
            {scenes.question}
          </p>

          {/* ⚠️ 여기 `aria-hidden` 이 있었다. "눌리지 않는 그림이니 보조기기엔 알리지
              말자" 는 생각이었는데, **선택지 넷이 이 카드의 내용 전부**다. 숨기면
              스크린리더 사용자는 상황과 질문만 듣고 답이 없는 채로 넘어간다 —
              이 섹션을 되살린 이유("설명보다 장면 하나가 빠르다")가 그들에게만
              사라진다(WCAG 1.3.1). 개편 전 같은 컴포넌트에는 이 속성이 없었다.
              목록에 이름을 줘서 **예시라는 것**을 말하되 내용은 읽히게 한다 —
              `CommunitySection` 의 `<ul aria-label="분기별 동기방">` 과 같은 방법이다. */}
          <ul className="mt-4 space-y-2" aria-label="이 장면의 선택지 예시">
            {scenes.choices.map((choice) => (
              <li
                key={choice}
                className="rounded-[6px] bg-[var(--color-paper-tint)] px-4 py-3 text-[16px] leading-[1.6] text-[var(--color-paper-ink-soft)]"
              >
                {choice}
              </li>
            ))}
          </ul>
        </NoteCard>

        <div>
          <p className={bodyText}>{scenes.body}</p>
          <div className="mt-7">
            <TrackedLandingLink
              source="landing_scenes_cta"
              href={scenes.cta.href}
              className="inline-flex min-h-12 items-center justify-center rounded-[6px] bg-[var(--color-paper-ink)] px-6 text-[16px] font-semibold text-[var(--color-paper-card)] transition-colors duration-200 hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none"
            >
              {scenes.cta.label}
            </TrackedLandingLink>
          </div>
          <p className={`mt-6 max-w-[46ch] ${noteText}`}>{scenes.note}</p>
        </div>
      </div>
    </Section>
  );
}
