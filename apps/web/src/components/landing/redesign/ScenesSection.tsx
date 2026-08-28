import Link from "next/link";

import { landingContent } from "./landingContent";
import { NoteCard, Section, bodyText, noteText, quoteText, ruled } from "./notebook";

/**
 * ① 갈린 자리부터 본다.
 *
 * 후크를 말로만 설명하지 않고 **장면 하나를 그대로 보여준다**. 처음 온 사람이
 * "아 이런 걸 묻는구나" 를 읽는 데 3초면 되고, 그다음 버튼이 자연스러워진다.
 *
 * 여기 인용한 장면은 실제 문항이다. 문항을 고치면 이 문장도 같이 고쳐야 한다 —
 * `landingAvailableNow.test.ts` 가 라이브 문항 수(스무 장면)를 대조한다.
 *
 * "성격을 맞히거나 궁합 점수를 매기지 않아요" 는 빼면 안 된다. CLAUDE.md 가
 * 궁합 점수·관계 예측을 금지하고, 사용자는 이 화면을 그런 검사로 읽기 쉽다.
 */
export default function ScenesSection() {
  const { scenes } = landingContent;

  return (
    <Section id="scenes" eyebrow={scenes.eyebrow} title={scenes.title} tinted>
      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)] lg:items-center">
        <NoteCard tilt={-0.5}>
          <p className="landing-hand text-[16px] text-[var(--color-paper-pen)]">장면 07</p>
          <p className={`mt-2 ${quoteText} text-[var(--color-paper-ink)]`}>
            {scenes.sample.split("\n").map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </p>
          <ul className="mt-6 space-y-2">
            {[
              "그래도 여기서 하고 싶다. 다른 데서 줄이자.",
              "300만원이면 다른 데 쓰는 게 낫다.",
            ].map((choice) => (
              <li
                key={choice}
                className={`rounded-[6px] border border-[var(--color-paper-edge)] bg-[var(--color-paper-tint)] px-4 py-2 ${ruled}`}
              >
                {choice}
              </li>
            ))}
          </ul>
        </NoteCard>

        <div>
          <p className={bodyText}>{scenes.body}</p>
          <Link
            href="/wedding-code"
            className="mt-6 inline-flex min-h-12 items-center justify-center rounded-[6px] bg-[var(--color-paper-ink)] px-7 text-[16px] font-semibold text-[var(--color-paper-card)] transition-colors duration-200 hover:bg-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none"
          >
            스무 장면 답해보기
          </Link>
          <p className={`mt-5 ${noteText}`}>{scenes.note}</p>
        </div>
      </div>
    </Section>
  );
}
