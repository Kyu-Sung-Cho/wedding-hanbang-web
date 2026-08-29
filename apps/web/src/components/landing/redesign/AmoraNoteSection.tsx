import { landingContent } from "./landingContent";
import { noteText, shell } from "./notebook";

/**
 * 아모라가 무엇을 하는지 **한 장면으로** 보여 준다.
 *
 * 정본 시안 `docs/landing/NotebookBest.html` 의 첫 섹션 아래쪽 카드다.
 * 설명하는 문장 대신 실제 대화 한 토막을 노트에 적어 둔 모양으로 보여 준다 —
 * "아모라는 대화를 정리하는 AI" 라는 말보다 이 카드 하나가 빠르다.
 *
 * ## 왜 히어로 바로 아래인가
 *
 * 시안에서 이 카드는 히어로와 **같은 섹션 안**에 있다. 첫 화면을 스크롤하면
 * 바로 이어지는 자리다. 제품을 설명하기 전에 먼저 보여 준다.
 *
 * ## 샘플이라고 카드 안에서 밝힌다
 *
 * 지금 이 화면에서 아모라에게 실제로 물어볼 수는 없다 — 비로그인 체험이
 * 2026-08-27에 닫혔다(`lib/demoTrial.ts`). 그래서 날짜와 답변이 기능을 보여주기
 * 위한 샘플이라는 것을 **카드 안에서** 말한다. 바깥 작은 글씨로 빼면 카드만 캡처됐을 때
 * 그 사실이 떨어져 나간다.
 */
export default function AmoraNoteSection() {
  const { amoraNote } = landingContent;

  return (
    <section className="pb-16 sm:pb-24" aria-labelledby="amora-note-title">
      <div className={shell}>
        {/* 제목은 화면에 안 나간다 — 이 카드는 히어로의 이어지는 장면이고,
            섹션 랜드마크에는 이름이 있어야 한다. */}
        <h2 id="amora-note-title" className="sr-only">
          아모라가 답하는 모습
        </h2>

        <div className="landing-note px-6 py-8 sm:px-10 sm:py-10">
          {/* ⚠️ 여기 `landing-pen`(파란 펜 밑줄)이 있었다. 이 랜딩에서 밑줄은
              **"누를 수 있다"** 는 뜻인데(globals.css 의 `border-bottom`), 이 줄은
              링크가 아니다. 정본 시안의 같은 문장(NotebookBest.html:1348)도
              `<p class="hand" style="…color:#35638A">` 로 **밑줄이 없다** — 파란
              손글씨는 색과 서체가 이미 지고 있다. `inline-block` 은 밑줄 폭을
              글자에 맞추려던 것이라 함께 뺐다(시안도 블록 `<p>` 다). */}
          <p className="landing-hand mb-6 text-[22px] text-[var(--color-paper-pen)]">
            {amoraNote.ask}
          </p>

          <p className="text-[16px] leading-8 text-[var(--color-paper-ink-soft)]">
            {amoraNote.answerLead}{" "}
            <span className="landing-circle font-medium">{amoraNote.answerMark}</span>
            {amoraNote.answerTail}
          </p>

          <p className="mt-6 text-[16px] leading-8 text-[var(--color-paper-ink-soft)]">
            {amoraNote.checklistLead}
          </p>

          <ul className="mt-2">
            {amoraNote.checklist.map((item) => (
              <li
                key={item}
                className="flex items-start gap-3 text-[16px] leading-8 text-[var(--color-paper-ink-soft)]"
              >
                {/* 빨간 펜 체크. 장식이라 보조기기에서 숨긴다. */}
                <span
                  aria-hidden
                  className="mt-[6px] shrink-0 text-[14px] text-[var(--color-paper-mark)]"
                >
                  ✓
                </span>
                <span>{item}</span>
              </li>
            ))}
          </ul>

          <p className={`mt-8 ${noteText}`}>{amoraNote.note}</p>
        </div>
      </div>
    </section>
  );
}
