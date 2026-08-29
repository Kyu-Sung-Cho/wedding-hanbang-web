import { landingContent } from "./landingContent";
import { NoteCard, Section, bodyText, noteText, ruled } from "./notebook";

/**
 * "우리 둘한테 뭐가 달라지냐면" — **커플이 함께 쓰는 대화**를 보여 준다.
 *
 * ## 이게 제품 계약의 한가운데다
 *
 * CLAUDE.md: "결혼 준비의 고민을 아모라와 처음부터 끝까지 이야기하고". 그 "이야기"는
 * 한 사람의 것이 아니라 두 사람의 것이다. 2026-08-29 개편에서 이 섹션을 없앴더니
 * 랜딩이 **혼자 쓰는 도구**처럼 읽혔다 — 같은 날 파운더 지적으로 되살렸다.
 *
 * ## 대화 세 줄은 샘플이고, 그걸 카드 안에서 말한다
 *
 * 이름·금액은 지어낸 것이다. 고지를 카드 **안에** 둔다 — 바깥 작은 글씨로 빼면
 * 카드만 캡처해 공유했을 때 그 사실이 떨어져 나간다.
 *
 * ## 순서를 바꾸지 마라
 *
 * 바로 다음에 `PrivateLaneSection`("그럼 내가 쓴 게 다 가나요?")이 와야 한다.
 * 여기서 "두 사람 대화가 한 덩어리"라고 말한 직후에 사람들이 곧바로 하는 걱정이
 * 그것이고, 받아 주지 않으면 이 섹션이 불안으로 끝난다.
 */
export default function OneRoomSection() {
  const { oneRoom } = landingContent;

  return (
    <Section id="oneroom" eyebrow={oneRoom.eyebrow} title={oneRoom.title}>
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
        <div>
          <p className={bodyText}>{oneRoom.body}</p>
          <p className={`mt-6 ${noteText}`}>{oneRoom.turnsLead}</p>
        </div>

        <NoteCard tilt={0.5}>
          <ul className="space-y-5">
            {oneRoom.turns.map((turn) => (
              <li key={turn.who}>
                <p className="landing-hand text-[14px] text-[var(--color-paper-ink-faint)]">
                  {turn.who}
                </p>
                <p className={`mt-1 ${ruled} text-[var(--color-paper-ink)]`}>
                  {turn.say}
                </p>
              </li>
            ))}
          </ul>
          {/* 샘플이라는 고지는 **카드 안**에 둔다 — 카드만 캡처돼 돌아다녀도 붙어 간다. */}
          <p className="mt-6 text-[14px] leading-[1.7] text-[var(--color-paper-ink-faint)]">
            {oneRoom.note}
          </p>
        </NoteCard>
      </div>
    </Section>
  );
}
