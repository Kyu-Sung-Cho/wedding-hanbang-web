import { landingContent } from "./landingContent";
import { NoteCard, Section, bodyText, noteText, ruled } from "./notebook";

/**
 * ⑤ 확인한 것만 남는다.
 *
 * ## 글자 그대로 있어야 하는 두 조각
 *
 * `publicClaims.test.ts` 의 "keeps the AI, sample, and storage disclosures on the
 * screen" 이 문자열로 대조한다. 줄 번호는 금방 썩으니 테스트 이름으로 가리킨다.
 *
 *   `landingContent.confirm.body` 안에 → "확인한 것만 준비 기록에 반영"
 *   이 파일이 그리는 문장에    → "확인을 누르기 전까지 예산 화면은 그대로예요."
 *
 * ⚠️ 2026-08-29까지 이 자리에 **지금 어디에도 없는 두 문장**이 적혀 있었고,
 * "글자 그대로 있어야 한다"고 지시하고 있었다:
 *
 *   "한 번에 한 가지 변경을 제안하고, 확인한 변경만 준비 기록에 반영해요"
 *   "확인 버튼을 누르기 전까지 예산·할 일·일정에 반영되지 않아요"
 *
 * 둘 다 옛 카피다. 되살리면 **오히려 테스트가 깨진다** — 앞엣것은 2026-08-28에
 * "확인한 변경만" → "확인한 것만" 으로 다듬어졌고(`publicClaims.test.ts` 가 새 문구를
 * 고정한다), 뒤엣것은 "확인 버튼을 누르기 전까지" 라서 네 검사가 요구하는
 * "확인을 누르기 전까지" 를 포함하지 못한다. 인용한 줄 번호(104-110)도 틀렸다 —
 * 거기는 타입 선언이다. 머리말을 계약서로 읽고 폐기된 문구를 되살리는 사고가
 * 이 저장소에서 이미 났었다.
 *
 * ## 두 사람 승인은 없어졌다
 *
 * 2026-08-23 파운더 결정으로 두 번째 사람의 승인이 사라졌다. 한 사람이 확인하면
 * 바로 반영되고 상대에게 알림이 간다. **"두 분이 각각 확인해야 반영돼요" 는 이제
 * 거짓이다** — 옛 카피에서 옮겨 적지 마라.
 * 없어진 것은 두 번째 승인이지 확인 자체가 아니다.
 */
export default function ConfirmSection() {
  const { confirm } = landingContent;

  return (
    <Section id="confirm" eyebrow={confirm.eyebrow} title={confirm.title} tinted>
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
        <div>
          <p className={bodyText}>{confirm.body}</p>
          <p className={`mt-5 ${bodyText}`}>{confirm.body2}</p>
          <p className={`mt-6 ${noteText}`}>{confirm.note}</p>
        </div>

        <NoteCard tilt={-0.7}>
          <p className="landing-hand text-[14px] text-[var(--color-paper-ink-faint)]">
            {confirm.sample.saidLabel}
          </p>
          <p className={`mt-1 ${ruled} text-[var(--color-paper-ink)]`}>
            {confirm.sample.said}
          </p>

          <div className="mt-6 rounded-[6px] border border-dashed border-[var(--color-paper-edge)] bg-[var(--color-paper-sheet)] px-5 py-5">
            <p className="landing-hand text-[14px] text-[var(--color-paper-mark)]">
              {confirm.sample.proposeLabel}
            </p>
            <p className={`mt-1 font-medium ${ruled} text-[var(--color-paper-ink)]`}>
              {confirm.sample.proposeLead}
              <span className="landing-circle font-medium">{confirm.sample.proposeMark}</span>
              {confirm.sample.proposeTail}
            </p>
            {/* 진짜 버튼이 아니다. 눌리지 않는 그림이라는 걸 보조기기에도 알려야 한다. */}
            <div className="mt-4 flex gap-2" aria-hidden="true">
              <span className="inline-flex min-h-9 items-center rounded-[6px] bg-[var(--color-paper-ink)] px-4 text-[14px] font-semibold text-[var(--color-paper-card)]">
                {confirm.sample.confirm}
              </span>
              <span className="inline-flex min-h-9 items-center rounded-[6px] border border-[var(--color-paper-edge)] px-4 text-[14px] font-semibold text-[var(--color-paper-ink-soft)]">
                {confirm.sample.later}
              </span>
            </div>
          </div>

          <p className="mt-5 text-[14px] leading-[1.7] text-[var(--color-paper-ink-faint)]">
            확인을 누르기 전까지 예산 화면은 그대로예요.
          </p>
          {/* 이름·금액이 샘플이라는 고지. **카드 안에** 둔다 — 바깥으로 빼면 카드만
              캡처해 공유했을 때 그 사실이 떨어져 나간다.

              2026-08-29 까지 이 줄이 카피(`confirm.sampleNote`)에만 있고 그리는 자리가
              없었다. 정본 시안에는 카드 아래에 있는 문장이다. 테스트가 잡아 줬다. */}
          <p className="mt-2 text-[14px] leading-[1.7] text-[var(--color-paper-ink-faint)]">
            {confirm.sampleNote}
          </p>
        </NoteCard>
      </div>
    </Section>
  );
}
