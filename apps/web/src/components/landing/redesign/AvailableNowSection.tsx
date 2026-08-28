import Link from "next/link";

import { availableNow, landingContent } from "./landingContent";
import { NoteCard, Section, bodyText, noteText } from "./notebook";

/**
 * ⑦ 로그인 없이 지금 되는 것.
 *
 * 위 섹션들이 대부분 계정이 필요한 구간을 설명하므로, 여기서 **가입 없이 오늘
 * 쓸 수 있는 것**을 세워야 처음 온 사람이 빈손으로 나가지 않는다.
 *
 * ⚠️ 개수를 손으로 적지 마라. `availableNow.length` 에서 계산한다 —
 * 카드 수와 어긋난 진술이 랜딩 최상단에서 1초 만에 반증된 적이 있다.
 *
 * 개수는 **제목이 아니라 본문**에 넣는다. 제목에 끼워 넣으려고 "이만큼"을
 * "6가지"로 치환했더니 "6가지은 지금"이 나왔다 — 한국어 조사는 앞 글자의
 * 받침을 따라가므로 숫자를 문자열로 갈아 끼우면 틀린다. 여기서는 뒤에
 * "는"이 오는 자리에만 넣어 그 함정을 구조적으로 피한다.
 *
 * `landingAvailableNow.test.ts` 가 이 목록의 문구에서 금지어를 검사한다.
 * "후기" 는 금지어다 — 커뮤니티 글은 후기가 아니라 질문과 답변이다.
 */
export default function AvailableNowSection() {
  const { availableNow: copy } = landingContent;

  return (
    <Section
      id="now"
      eyebrow={copy.eyebrow}
      title={copy.title}
      tinted
    >
      <p className={`mt-6 max-w-[52ch] ${bodyText}`}>
        아래 {availableNow.length}가지는 {copy.body}
      </p>

      <ul className="mt-9 grid gap-5 sm:grid-cols-2">
        {availableNow.map((item, index) => (
          <li key={item.cta.href}>
            <NoteCard className="flex h-full flex-col" tilt={index % 2 === 0 ? -0.4 : 0.4}>
              <p className="landing-hand text-[18px] leading-[1.4] text-[var(--color-paper-ink)]">
                {item.title}
              </p>
              <p className="mt-3 text-[16px] leading-[1.75] text-[var(--color-paper-ink-soft)]">
                {item.body}
              </p>
              <p className="mt-3 text-[14px] leading-[1.7] text-[var(--color-paper-ink-faint)]">
                {item.note}
              </p>
              <Link
                href={item.cta.href}
                className="mt-auto inline-flex min-h-11 items-center pt-5 text-[14px] font-semibold text-[var(--color-paper-pen)] underline underline-offset-4 transition-colors duration-200 hover:text-[var(--color-paper-pen-deep)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-paper-pen)] focus-visible:ring-offset-2 motion-reduce:transition-none"
              >
                {item.cta.label}
              </Link>
            </NoteCard>
          </li>
        ))}
      </ul>

      <p className={`mt-7 ${noteText}`}>
        계정을 만들면 예산·할 일·일정이 열려요. 지금은 결제를 요청하지 않아요.
      </p>
    </Section>
  );
}
