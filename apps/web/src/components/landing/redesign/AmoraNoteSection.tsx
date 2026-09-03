import { landingContent } from "./landingContent";
import { band, bodyText, eyebrowText, noteText, sectionTitle, shell } from "./notebook";

/**
 * ③ 막막한 그대로 말해도 돼요 — 아모라가 **처음 말하는 자리**.
 *
 * 2026-09-03 시안: 왼쪽에 카피와 자리(레인) 카드 둘, 오른쪽에 대화 카드 한 장.
 * 없어진 두 섹션의 몫이 여기로 들어왔다 — `PrivateLaneSection`(함께 보는 자리 /
 * 나만 보는 자리)과 `OneRoomSection`(앞 대화를 기억한다는 캡션).
 *
 * ## 고지가 카드 **안**에 있어야 하는 이유
 *
 * `amoraNote.note` 는 AI 기본법 고지 + 샘플 표시 + 저장 안 함을 함께 진다. 이 카드는
 * 캡처돼 돌아다니기 쉬운 모양이고, 라벨을 카드 바깥 작은 글씨로 빼면 그 순간
 * **연출된 대화가 진짜 대화로 읽힌다.** 그래서 대화 카드 마지막 자식으로 둔다.
 *
 * `privacyNote`(대화 저장·배우자 비노출)는 없어진 `privateLane.note` 가 지던 고지다.
 * 자리 카드 바로 아래에 둔다 — 그 고지가 설명하는 것이 두 자리의 차이이기 때문이다.
 */
export default function AmoraNoteSection() {
  const { amoraNote } = landingContent;

  return (
    <section id="amora" className={band} aria-labelledby="amora-title">
      <div className={`${shell} grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)] lg:gap-14`}>
        <div>
          <p className="mb-5">
            <span className={eyebrowText}>
              {amoraNote.eyebrow}
            </span>
          </p>

          <h2 id="amora-title" className={sectionTitle}>
            {amoraNote.title.split("\n").map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </h2>

          <p className={`mt-7 max-w-[46ch] ${bodyText}`}>{amoraNote.body}</p>

          <ul className="mt-9 grid gap-4 sm:grid-cols-2">
            {amoraNote.lanes.map((lane) => (
              <li
                key={lane.name}
                // 시안은 "나만 보는" 쪽만 점선으로 그린다 — 선의 모양이 곧
                // "이건 닫혀 있다"는 뜻이다. 색이 아니라 형태로 말한다.
                className={`rounded-[12px] px-5 py-5 ${
                  lane.shared
                    ? "border border-[var(--color-paper-edge)] bg-[var(--color-paper-card)]"
                    : "border border-dashed border-[var(--color-paper-outline)]"
                }`}
              >
                <p className="text-[16px] font-semibold text-[var(--color-paper-ink)]">
                  {lane.name}
                </p>
                <p className={`mt-2 ${noteText}`}>{lane.detail}</p>
              </li>
            ))}
          </ul>

          <p className={`mt-5 ${noteText}`}>{amoraNote.laneNote}</p>
          <p className={`mt-2 ${noteText}`}>{amoraNote.privacyNote}</p>
        </div>

        <div className="rounded-[12px] border border-[var(--color-paper-edge)] bg-[var(--color-paper-card)] px-6 py-7 shadow-raised sm:px-7">
          <p className="text-[12px] font-medium text-[var(--color-paper-ink-faint)]">
            {amoraNote.chat.meLabel}
          </p>
          <p className="mt-2 rounded-[12px] bg-[var(--color-paper-tint)] px-5 py-4 text-[16px] leading-[1.7] text-[var(--color-paper-ink)]">
            {amoraNote.chat.me}
          </p>

          <p className="mt-5 flex items-center gap-2 text-[12px] font-medium text-[var(--color-paper-ink-faint)]">
            <span aria-hidden>☆</span>
            <span>{amoraNote.chat.amoraLabel}</span>
          </p>
          <p className="mt-2 rounded-[12px] bg-[var(--color-paper-rule)] px-5 py-4 text-[16px] leading-[1.7] text-[var(--color-paper-ink)]">
            {amoraNote.chat.amora}
          </p>

          {/* 칩은 **그림이다.** 누를 수 있는 것처럼 보이지만 이 화면에서는 아무 일도
              일어나지 않는다(비로그인 아모라 체험이 닫혀 있다). 보조기기가 진짜
              버튼으로 읽지 않도록 aria-hidden 으로 묶는다. */}
          <div aria-hidden className="mt-5 flex flex-wrap gap-3">
            {amoraNote.chat.chips.map((chip) => (
              <span
                key={chip}
                className="inline-flex items-center rounded-[6px] border border-[var(--color-paper-outline)] px-4 py-2 text-[14px] font-semibold text-[var(--color-paper-ink)]"
              >
                {chip}
              </span>
            ))}
          </div>

          <p className={`mt-5 ${noteText}`}>{amoraNote.chat.caption}</p>
          <p className={`mt-4 ${noteText}`}>{amoraNote.note}</p>
        </div>
      </div>
    </section>
  );
}
