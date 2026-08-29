import { landingContent } from "./landingContent";
import { Section, bodyText, noteText, ruled } from "./notebook";

/**
 * "그럼 내가 쓴 게 다 가나요?" 에 답한다.
 *
 * ## 반드시 `OneRoomSection` 바로 다음이다
 *
 * 앞 섹션이 "두 사람 대화가 한 덩어리"라고 말한다. 그 문장을 읽은 사람이 곧바로 하는
 * 걱정이 이것이고, 여기서 받아 주지 않으면 앞 섹션이 **불안으로 끝난다.**
 * `mvpDirection.test.ts` 가 이 순서를 고정한다 — 2026-08-29에 두 섹션을 통째로
 * 없애면서 그 가드까지 지웠다가, 같은 날 파운더 지적으로 둘 다 되살렸다.
 *
 * ## 이건 마케팅 문장이 아니다
 *
 * 실재하는 구분이다. `visibility: "shared" | "bride_private" | "groom_private"`
 * (`lib/ai/amoraBoundedContinuity.ts`)이고, 화면 문구도 "함께 보는 대화"·"나만 보는
 * 상담" 으로 웹·모바일 양쪽에 살아 있다. 기능이 없어지면 이 섹션을 먼저 지워라.
 */
export default function PrivateLaneSection() {
  const { privateLane } = landingContent;

  return (
    <Section id="private" eyebrow={privateLane.eyebrow} title={privateLane.title} tinted>
      <div className="mt-8 grid gap-5 sm:grid-cols-2 sm:gap-7">
        {privateLane.lanes.map((lane) => (
          <div key={lane.name} className="landing-note px-6 py-7">
            <p className="landing-hand text-[18px] text-[var(--color-paper-mark)]">
              {lane.name}
            </p>
            <p className={`mt-3 ${ruled}`}>
              {lane.detail}
            </p>
          </div>
        ))}
      </div>

      <p className={`mt-8 max-w-[60ch] ${bodyText}`}>{privateLane.body}</p>
      <p className={`mt-5 max-w-[60ch] ${noteText}`}>{privateLane.note}</p>
    </Section>
  );
}
